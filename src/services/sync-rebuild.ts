import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Decision } from '../domain/entities/decision.js';
import type { Epic } from '../domain/entities/epic.js';
import type { Sprint } from '../domain/entities/sprint.js';
import type { GitPrRef, Task } from '../domain/entities/task.js';
import { ActorKind } from '../domain/enums/actor-kind.js';
import { DecisionStatus } from '../domain/enums/decision-status.js';
import { EpicState } from '../domain/enums/epic-state.js';
import { SprintState } from '../domain/enums/sprint-state.js';
import type { TaskState } from '../domain/enums/task-state.js';
import { parseTaskKey } from '../domain/id-generator.js';
import { parseFrontmatter } from '../storage/markdown/frontmatter.js';
import { MarkdownIo } from '../storage/markdown/markdown-io.js';
import type { ActorRepository } from '../storage/sqlite/repositories/actor-repository.js';
import type {
  DecisionFieldUpdates,
  DecisionRepository,
} from '../storage/sqlite/repositories/decision-repository.js';
import type { DependencyRepository } from '../storage/sqlite/repositories/dependency-repository.js';
import type {
  EpicFieldUpdates,
  EpicRepository,
} from '../storage/sqlite/repositories/epic-repository.js';
import type { LabelRepository } from '../storage/sqlite/repositories/label-repository.js';
import type { MemoryRepository } from '../storage/sqlite/repositories/memory-repository.js';
import type { ObservationRepository } from '../storage/sqlite/repositories/observation-repository.js';
import type { ProjectRepository } from '../storage/sqlite/repositories/project-repository.js';
import type { SkillRepository } from '../storage/sqlite/repositories/skill-repository.js';
import type {
  SprintFieldUpdates,
  SprintRepository,
} from '../storage/sqlite/repositories/sprint-repository.js';
import type {
  TaskFieldUpdates,
  TaskRepository,
} from '../storage/sqlite/repositories/task-repository.js';
import { isoNow } from '../utils/iso-now.js';
import {
  CURATED_MEMORY_SUBFOLDERS,
  listMirrorEntries,
  PRUNE_PROTECTED_FILENAMES,
  SEED_AUTHOR_HANDLE,
  SKILL_DEFAULT_DIR,
} from '../utils/mirror-layout.js';

/**
 * Per-entity tally of a {@link SyncRebuild.run} execution.
 */
export interface RebuildCounts {
  readonly scanned: number;
  readonly upserted: number;
}

/**
 * A task key found mirrored in more than one backlog state directory in a
 * single rebuild. The rebuild refuses to realign the cached row from any of
 * the copies — it cannot know which state is current, and picking by
 * directory order is exactly the silent regression this guard prevents.
 */
export interface MirrorConflict {
  readonly key: string;
  /** The state directories the key was found in, in scan order. */
  readonly states: readonly string[];
}

/**
 * Outcome of a {@link SyncRebuild.run} execution.
 */
export interface RebuildSummary {
  readonly tasksScanned: number;
  readonly tasksUpserted: number;
  readonly epics: RebuildCounts;
  readonly sprints: RebuildCounts;
  readonly decisions: RebuildCounts;
  readonly observations: RebuildCounts;
  readonly memories: RebuildCounts;
  readonly skills: RebuildCounts;
  readonly skipped: readonly { readonly file: string; readonly reason: string }[];
  /**
   * Task keys mirrored in more than one state directory. Their cached rows
   * were left untouched (no state realignment) so a duplicate can never move
   * a task backwards silently. Resolve with `mnema doctor` before re-syncing.
   */
  readonly conflicts: readonly MirrorConflict[];
}

/**
 * Reconstructs the cache tables from the version-controlled markdown:
 * epics and decisions under `roadmap/`, sprints under `sprints/`, and
 * tasks under `backlog/<STATE>/<KEY>.md`.
 *
 * The append-only history (`transitions`, `agent_runs`, `agent_plans`)
 * is **not** rebuilt — that timeline lives in `.audit/*.jsonl` and is
 * the canonical record for the human. `mnema sync` is therefore safe to
 * run on a clean database: it bootstraps the cache from disk without
 * inventing past events.
 *
 * Order matters. Epics and sprints are rebuilt before tasks so a task's
 * `epic_key` / `sprint_key` can be resolved to a freshly-inserted row.
 *
 * Upsert-only: it inserts or realigns a row for every markdown it finds,
 * but never deletes. Removing a `.md` is therefore not a delete signal —
 * the row survives, and `SyncService.rebuildMirrors` re-materialises the
 * file from it. Retiring an entity is a domain action (a task is
 * soft-deleted by `cancel`), not a file deletion.
 *
 * Idempotent: rerunning produces the same final state when the markdown
 * has not changed.
 */
export class SyncRebuild {
  private readonly markdownIo = new MarkdownIo();

  constructor(
    private readonly tasks: TaskRepository,
    private readonly actors: ActorRepository,
    private readonly projects: ProjectRepository,
    private readonly epics: EpicRepository,
    private readonly sprints: SprintRepository,
    private readonly decisions: DecisionRepository,
    private readonly dependencies: DependencyRepository,
    private readonly labels: LabelRepository,
    private readonly observations: ObservationRepository,
    private readonly memories: MemoryRepository,
    private readonly skills: SkillRepository,
    private readonly paths: {
      readonly projectRoot: string;
      readonly backlogDir: string;
      readonly roadmapDir: string;
      readonly sprintsDir: string;
      readonly observationsDir: string;
      readonly memoryDir: string;
      readonly skillsDir: string;
    },
    /**
     * The states declared by the active workflow. A `backlog/<STATE>/`
     * directory whose name is not in this set is skipped rather than
     * upserted: since migration 004 dropped the DB CHECK on
     * `tasks.state`, an arbitrary or hand-created directory would
     * otherwise persist a task in a state no transition can leave —
     * a way to smuggle a task past the workflow gates.
     */
    private readonly validStates: ReadonlySet<string>,
    /**
     * Optional audit writer. When present, a rebuild that realigns an
     * ALREADY-CACHED task's state emits a `sync_realign` event so the
     * change is not invisible to the timeline. The first-insert path (a
     * fresh clone rebuilding every row from disk) deliberately emits
     * nothing — see the class contract on not inventing history. Left
     * optional so existing callers/tests construct the rebuild unchanged.
     */
    private readonly audit: {
      write(input: { kind: string; actor: string; data: Record<string, unknown> }): void;
    } | null = null,
  ) {}

  /**
   * Walks the version-controlled markdown and upserts a row for each
   * entity it finds, then relinks tasks to their epic/sprint.
   *
   * For each markdown:
   * - missing actors are created (handles taken verbatim from the file)
   * - existing rows are touched only when something changed, to keep
   *   `updated_at` truthful
   *
   * SOURCE-OF-TRUTH ASYMMETRY (deliberate): the two entity families treat a
   * hand-edited, already-cached `.md` differently.
   * - The 4 BACKLOG entities (task/epic/sprint/decision) fold a content edit
   *   back into the row on sync (see collect*ContentDrift) — for these the
   *   committed frontmatter is authoritative and editing the file then syncing
   *   is a supported way to change the row.
   * - The 3 KNOWLEDGE entities (memory/skill/observation) are INSERT OR IGNORE:
   *   a rebuild only re-creates a row that is ABSENT (e.g. a fresh clone), and
   *   a hand-edit of a `.md` whose row already exists is intentionally NOT
   *   folded back. Knowledge is mutated only through its `record`/`supersede`
   *   commands (which rewrite the mirror), so the row — not a manual file edit
   *   — is authoritative once cached. This keeps provenance/versioning honest;
   *   it is not a bug that a stray edit to a cached knowledge `.md` is ignored.
   *
   * @param projectKey - Active project key (taken from `mnema.config.json`)
   * @returns Summary describing what was scanned and what changed
   */
  run(projectKey: string): RebuildSummary {
    const empty: RebuildSummary = {
      tasksScanned: 0,
      tasksUpserted: 0,
      epics: { scanned: 0, upserted: 0 },
      sprints: { scanned: 0, upserted: 0 },
      decisions: { scanned: 0, upserted: 0 },
      observations: { scanned: 0, upserted: 0 },
      memories: { scanned: 0, upserted: 0 },
      skills: { scanned: 0, upserted: 0 },
      skipped: [],
      conflicts: [],
    };

    const project = this.projects.findByKey(projectKey);
    if (project === null) {
      return empty;
    }

    const skipped: { file: string; reason: string }[] = [];
    const conflicts: MirrorConflict[] = [];

    // Roadmap first so tasks can resolve their links afterwards.
    const epics = this.rebuildRoadmap(
      project.id,
      project.key,
      this.paths.roadmapDir,
      'epic',
      skipped,
    );
    const sprints = this.rebuildRoadmap(
      project.id,
      project.key,
      this.paths.sprintsDir,
      'sprint',
      skipped,
    );
    const decisions = this.rebuildRoadmap(
      project.id,
      project.key,
      this.paths.roadmapDir,
      'decision',
      skipped,
    );
    // A superseded decision's `superseded_by` points at its successor by
    // key. That successor may be walked after the superseded row (the
    // directory order is not guaranteed), so the link is resolved in a
    // second pass, once every decision row exists.
    this.relinkSupersededDecisions(this.paths.roadmapDir, project.key);
    const tasks = this.rebuildTasks(project.id, project.key, skipped, conflicts);
    // A task's `depends_on` list points at its blockers by key. Those
    // blocker rows may be walked after the dependent (directory order is
    // not guaranteed), so the edges are recreated in a second pass, once
    // every task row exists.
    this.relinkTaskDependencies(project.key);
    // Observations are rebuilt after tasks so a note's `related_task_key`
    // resolves to a freshly-inserted task row.
    const observations = this.rebuildObservations(skipped);
    // Knowledge mirrors (foldered, flat frontmatter). Independent of the
    // backlog graph, so order does not matter. Without these a fresh clone
    // has the .md on disk but no rows, so list/show/search/bootstrap see
    // nothing (the clone-survivability gap).
    const memories = this.rebuildMemories(skipped);
    const skills = this.rebuildSkills(skipped);

    return {
      tasksScanned: tasks.scanned,
      tasksUpserted: tasks.upserted,
      epics,
      sprints,
      decisions,
      observations,
      memories,
      skills,
      skipped,
      conflicts,
    };
  }

  /**
   * Walks `backlog/<STATE>/*.md`, upserts each task, and relinks it to
   * its epic/sprint by the keys recorded in the frontmatter.
   */
  private rebuildTasks(
    projectId: string,
    projectKey: string,
    skipped: { file: string; reason: string }[],
    conflicts: MirrorConflict[],
  ): RebuildCounts {
    const root = path.join(this.paths.projectRoot, this.paths.backlogDir);
    if (!existsSync(root)) return { scanned: 0, upserted: 0 };

    let scanned = 0;
    let upserted = 0;

    // A first pass maps every key to the state directories it is mirrored
    // in. A key found in more than one directory is a conflict: the rebuild
    // must not pick a state for it (directory iteration order is arbitrary,
    // and choosing by it silently regressed DONE tasks to READY/DRAFT in the
    // field). These keys are recorded as conflicts and skipped entirely in
    // the pass below — never upserted from any copy.
    const duplicateKeys = this.collectDuplicateTaskKeys(root, conflicts);

    for (const stateDir of listDirs(root)) {
      const stateRoot = path.join(root, stateDir);

      // The directory name is the task's state. Reject any that the
      // active workflow doesn't declare BEFORE touching the database:
      // persisting an unknown state (the DB CHECK is gone since
      // migration 004) would strand the task in a state with no
      // outbound transition — a gate bypass. Each contained file is
      // recorded as skipped so the reason is visible in the summary.
      if (!this.validStates.has(stateDir)) {
        for (const fileName of listMarkdownFiles(stateRoot)) {
          scanned += 1;
          skipped.push({
            file: path.join(stateRoot, fileName),
            reason: `unknown workflow state '${stateDir}' (not in the active workflow)`,
          });
        }
        continue;
      }

      const stateName = stateDir as TaskState;
      for (const fileName of listMarkdownFiles(stateRoot)) {
        const filePath = path.join(stateRoot, fileName);
        scanned += 1;

        const data = this.markdownIo.read(filePath).mnemaData;
        const key = readString(data, 'key');
        if (key === null) {
          skipped.push({ file: filePath, reason: 'missing mnema.key' });
          continue;
        }

        const expectedKey = fileName.replace(/\.md$/, '');
        if (key !== expectedKey) {
          skipped.push({
            file: filePath,
            reason: `mnema.key (${key}) does not match filename (${expectedKey})`,
          });
          continue;
        }

        const parsedKey = parseTaskKey(key);
        if (parsedKey === null || parsedKey.projectKey !== projectKey) {
          skipped.push({ file: filePath, reason: 'key prefix does not match project' });
          continue;
        }

        // A key mirrored in more than one state directory is ambiguous: the
        // rebuild refuses to realign the cached row from any copy (recorded
        // as a conflict in the first pass). Leaving the row untouched is
        // fail-closed — it never moves a task backwards on a guess.
        if (duplicateKeys.has(key)) {
          continue;
        }

        const reporterId = this.actors.upsert(
          readString(data, 'reporter') ?? 'unknown',
          ActorKind.Human,
        );
        const assigneeHandle = readString(data, 'assignee');
        const assigneeId =
          assigneeHandle !== null ? this.actors.upsert(assigneeHandle, ActorKind.Human) : null;

        // Resolve epic/sprint links by key — the rows exist already
        // because the roadmap was rebuilt first. An unknown key links to
        // nothing rather than failing the whole rebuild.
        const epicKey = readString(data, 'epic_key');
        const epicId = epicKey !== null ? (this.epics.findByKey(epicKey)?.id ?? null) : null;
        const sprintKey = readString(data, 'sprint_key');
        const sprintId =
          sprintKey !== null ? (this.sprints.findByKey(sprintKey)?.id ?? null) : null;

        const existing = this.tasks.findByKey(key);
        let taskId: string;
        if (existing === null) {
          taskId = this.tasks.insert({
            key,
            projectId,
            title: readString(data, 'title') ?? key,
            description: readString(data, 'description'),
            acceptanceCriteria: readStringArray(data, 'acceptance_criteria'),
            state: stateName,
            estimate: readNumber(data, 'estimate'),
            priority: readNumber(data, 'priority') ?? 3,
            assigneeId,
            reporterId,
            epicId,
            sprintId,
            metadata: readRecord(data, 'metadata'),
          }).id;
          upserted += 1;
        } else {
          taskId = existing.id;
          // The committed markdown is authoritative on rebuild: any field
          // that drifted on disk (state, links, or the content columns
          // below) is written back into the cache, and the file counts as
          // one upsert even when only its content changed.
          let changed = false;

          if (existing.state !== stateName) {
            const fromState = existing.state;
            this.tasks.updateState(existing.id, stateName, null);
            changed = true;
            // Realigning an already-cached row's state is a real change to
            // the projection, not a fresh-clone reconstruction — record it
            // so it is not invisible to the timeline. The first-insert path
            // above emits nothing (see the constructor's `audit` contract).
            this.audit?.write({
              kind: 'sync_realign',
              actor: 'system',
              data: { key, from: fromState, to: stateName },
            });
          }

          // Fold the content columns serialiseTask round-trips back onto the
          // row when they diverge from the cache, so a merged edit to a
          // committed task (title, description, acceptance_criteria,
          // estimate, priority, assignee) is no longer silently dropped.
          const contentDrift = collectTaskContentDrift(existing, data, assigneeId);
          if (contentDrift !== null) {
            this.tasks.updateFields(existing.id, contentDrift);
            changed = true;
          }

          // Relink an existing row when its disk link drifted from the cache.
          if (existing.epicId !== epicId) {
            if (epicId !== null) this.epics.addTask(epicId, existing.id);
            else this.epics.removeTask(existing.id);
          }
          if (existing.sprintId !== sprintId) {
            if (sprintId !== null) this.sprints.addTask(sprintId, existing.id);
            else this.sprints.removeTask(existing.id);
          }

          if (changed) upserted += 1;
        }

        // Restore the serialized git link (ADR-49): branch + PR are stable and
        // committed to the markdown, so a fresh clone keeps them across a
        // rebuild. Commits are NOT serialized (volatile) — preserve whatever
        // the cache already holds so a rebuild does not wipe the observer's
        // work, and let `mnema watch --git` re-derive them. setGitLink is a
        // no-op when nothing changed, so an unlinked task stays untouched.
        const gitBranch = readString(data, 'git_branch');
        const gitPr = readGitPr(data);
        if (gitBranch !== null || gitPr !== null) {
          const currentTask = this.tasks.findByKey(key);
          this.tasks.setGitLink(taskId, {
            branch: gitBranch,
            commits: currentTask?.gitCommits ?? [],
            pr: gitPr,
          });
        }

        // Mirror the frontmatter `labels:` list back into the join table.
        // setForTask is a full replace, so it heals drift in both
        // directions (added on disk, or removed) and is idempotent when
        // the markdown is unchanged.
        this.labels.setForTask(taskId, readStringArray(data, 'labels'));
      }
    }

    return { scanned, upserted };
  }

  /**
   * First pass over `backlog/<STATE>/*.md`: finds every task key mirrored in
   * more than one valid state directory and returns the set of such keys,
   * appending a {@link MirrorConflict} for each to `conflicts`.
   *
   * Only copies that the main pass would actually act on are counted — the
   * state directory must be one the active workflow declares, and the
   * frontmatter `key` must match the filename — so an already-skipped file
   * (unknown state, key/filename mismatch) never fabricates a false
   * conflict. A key seen once is not a conflict; the common single-mirror
   * repo yields an empty set and the guard is a no-op.
   */
  private collectDuplicateTaskKeys(root: string, conflicts: MirrorConflict[]): ReadonlySet<string> {
    const statesByKey = new Map<string, string[]>();

    for (const stateDir of listDirs(root)) {
      if (!this.validStates.has(stateDir)) continue;
      const stateRoot = path.join(root, stateDir);

      for (const fileName of listMarkdownFiles(stateRoot)) {
        const data = this.markdownIo.read(path.join(stateRoot, fileName)).mnemaData;
        const key = readString(data, 'key');
        // Mirror the main pass's guards: a key that is absent or disagrees
        // with the filename is skipped there, so it must not count here.
        if (key === null || key !== fileName.replace(/\.md$/, '')) continue;

        const states = statesByKey.get(key);
        if (states === undefined) statesByKey.set(key, [stateDir]);
        else states.push(stateDir);
      }
    }

    const duplicates = new Set<string>();
    for (const [key, states] of statesByKey) {
      if (states.length > 1) {
        duplicates.add(key);
        conflicts.push({ key, states });
      }
    }
    return duplicates;
  }

  /**
   * Walks `observations/<id>.md` and re-imports each note into the cache,
   * preserving its on-disk id / timestamps / archived state. Unlike a task
   * or decision the id is the filename (observations have no human key), and
   * a `related_task_key` is resolved to the freshly-inserted task row. The
   * insert is idempotent by id — a note already present in the cache is left
   * untouched — so a rebuild over a populated database is a no-op.
   */
  private rebuildObservations(skipped: { file: string; reason: string }[]): RebuildCounts {
    const root = path.join(this.paths.projectRoot, this.paths.observationsDir);
    if (!existsSync(root)) return { scanned: 0, upserted: 0 };

    let scanned = 0;
    let upserted = 0;

    for (const fileName of listMarkdownFiles(root)) {
      const filePath = path.join(root, fileName);
      const data = this.markdownIo.read(filePath).mnemaData;

      if (readString(data, 'kind') !== 'observation') continue;
      scanned += 1;

      const id = readString(data, 'id');
      if (id === null) {
        skipped.push({ file: filePath, reason: 'missing mnema.id' });
        continue;
      }
      const expectedId = fileName.replace(/\.md$/, '');
      if (id !== expectedId) {
        skipped.push({
          file: filePath,
          reason: `mnema.id (${id}) does not match filename (${expectedId})`,
        });
        continue;
      }
      const content = readString(data, 'content');
      if (content === null) {
        skipped.push({ file: filePath, reason: 'missing mnema.content' });
        continue;
      }

      // The frontmatter seeds the row on a fresh clone (INSERT OR IGNORE —
      // observations are record-only knowledge, NOT folded back like the
      // backlog entities; see the run() contract). The body is only a
      // readable copy. `related_task_key` resolves to the freshly-inserted
      // task row by its stable key.
      const relatedTaskKey = readString(data, 'related_task_key');
      const relatedTaskId =
        relatedTaskKey !== null ? (this.tasks.findByKey(relatedTaskKey)?.id ?? null) : null;
      const createdBy = this.actors.upsert(
        readString(data, 'created_by') ?? 'unknown',
        ActorKind.Human,
      );

      const inserted = this.observations.insertFromMirror({
        id,
        content,
        topics: readStringArray(data, 'topics'),
        relatedTaskId,
        createdBy,
        at: readString(data, 'at') ?? isoNow(),
        // No archived_at: only live observations have a mirror (archiving
        // unlinks it), so a rebuilt observation is always live.
      });
      if (inserted) upserted += 1;
    }

    return { scanned, upserted };
  }

  /**
   * Walks the foldered memory mirrors (`memory/[<scope>/]<slug>.md`, ADR-51)
   * and re-inserts each into the cache so a fresh clone recovers its memories
   * — without this the .md exist on disk but `memory list`/`search`/bootstrap
   * see nothing. Unlike the backlog entities the mirror uses FLAT top-level
   * frontmatter (not the `mnema:` block), so it is parsed directly. The slug
   * is the filename basename; the insert is idempotent by slug.
   *
   * The raw `scope` is read back from the frontmatter (the folder is only a
   * lossy projection). Documented loss (not in the mirror): `created_by`
   * (attributed to `unknown`). Only live memories have a mirror
   * (archived/superseded ones are deleted on write), so this restores only
   * live rows. The curated `decisions/`/`notes/` subfolders are human-authored
   * and never scanned as memory mirrors.
   */
  private rebuildMemories(skipped: { file: string; reason: string }[]): RebuildCounts {
    const root = path.join(this.paths.projectRoot, this.paths.memoryDir);
    let scanned = 0;
    let upserted = 0;

    for (const { slug, filePath } of listMirrorEntries(root, {
      excludeDirs: CURATED_MEMORY_SUBFOLDERS,
    })) {
      // `context.md` is the `adopt memory` scaffolding at the root — a
      // human-authored file with no row. The writer/prune path protects it via
      // PRUNE_PROTECTED_FILENAMES; the rebuild must agree, or it would ingest a
      // phantom `context` row (or warn on the bare default on every sync).
      if (PRUNE_PROTECTED_FILENAMES.has(path.basename(filePath))) continue;
      scanned += 1;
      const parsed = this.readMirror(filePath, skipped);
      if (parsed === null) continue;
      const { data, content } = parsed;

      const title = readString(data, 'title');
      if (title === null) {
        skipped.push({ file: filePath, reason: 'missing title' });
        continue;
      }
      const createdBy = this.actors.upsert('unknown', ActorKind.Human);
      const now = isoNow();
      const inserted = this.memories.insertFromMirror({
        slug,
        title,
        content: content.trim(),
        topics: readStringArray(data, 'topics'),
        // The raw scope is authoritative in the frontmatter; the folder is a
        // lossy projection. Absent (a scopeless memory, or a mirror written
        // before scope was persisted) → null.
        scope: readString(data, 'scope'),
        createdBy,
        createdAt: readString(data, 'created_at') ?? now,
        updatedAt: readString(data, 'updated_at') ?? now,
      });
      if (inserted) upserted += 1;
    }

    return { scanned, upserted };
  }

  /**
   * Walks the foldered skill mirrors (`skills/{default,authored}/<slug>.md`,
   * ADR-51) and re-inserts each into the cache so a fresh clone recovers its
   * skills. Like memories the mirror uses flat frontmatter; the slug is the
   * filename basename and the origin folder decides the author (`default/` →
   * the reserved `system` seed handle, `authored/` → a human). The mirror
   * version is dressed as `<n>.0.0`; only the leading integer is the row
   * version. Idempotent by (slug, version).
   *
   * Documented losses (not in the mirror): version HISTORY (only the latest is
   * mirrored — a rebuilt skill is a single row at its current version), and
   * `change_rationale`/`scope`. Only live-latest skills have a mirror
   * (superseded ones are deleted on write).
   */
  private rebuildSkills(skipped: { file: string; reason: string }[]): RebuildCounts {
    const root = path.join(this.paths.projectRoot, this.paths.skillsDir);
    let scanned = 0;
    let upserted = 0;

    for (const { slug, filePath } of listMirrorEntries(root)) {
      scanned += 1;
      const parsed = this.readMirror(filePath, skipped);
      if (parsed === null) continue;
      const { data, content } = parsed;

      const name = readString(data, 'name');
      const description = readString(data, 'description');
      if (name === null || description === null) {
        skipped.push({ file: filePath, reason: 'missing name or description' });
        continue;
      }
      // The mirror version is semver-dressed (`3.0.0`); the row version is the
      // leading integer. A malformed value skips the file rather than guessing.
      const versionRaw = readString(data, 'version');
      const version = versionRaw === null ? Number.NaN : Number.parseInt(versionRaw, 10);
      if (!Number.isInteger(version) || version < 1) {
        skipped.push({ file: filePath, reason: `unreadable version "${versionRaw ?? ''}"` });
        continue;
      }
      // `default/` holds the tool-shipped seeds (authored by the reserved
      // `system` handle); everything else is human-authored. The folder is the
      // authority since the mirror does not carry `created_by`.
      const inDefault = path.basename(path.dirname(filePath)) === SKILL_DEFAULT_DIR;
      const createdBy = this.actors.upsert(
        inDefault ? SEED_AUTHOR_HANDLE : 'unknown',
        ActorKind.Human,
      );
      const now = isoNow();
      const inserted = this.skills.insertFromMirror({
        slug,
        name,
        version,
        description,
        content: content.trim(),
        toolsUsed: readStringArray(data, 'tools_used'),
        invocable: data.invocable === true,
        dynamicContext: readStringArray(data, 'dynamic_context'),
        usageCount: readNumber(data, 'usage_count') ?? 0,
        lastUsedAt: readString(data, 'last_used_at'),
        createdBy,
        createdAt: readString(data, 'created_at') ?? now,
        updatedAt: readString(data, 'updated_at') ?? now,
      });
      if (inserted) upserted += 1;
    }

    return { scanned, upserted };
  }

  /**
   * Reads a knowledge mirror's FLAT frontmatter + body, recording a skip and
   * returning null on unreadable YAML (a hostile or corrupt file must not
   * crash the whole rebuild). Distinct from the backlog entities, which read
   * the nested `mnema:` block via {@link MarkdownIo}.
   */
  private readMirror(
    filePath: string,
    skipped: { file: string; reason: string }[],
  ): { data: Record<string, unknown>; content: string } | null {
    try {
      const parsed = parseFrontmatter(readFileSync(filePath, 'utf-8'));
      return { data: parsed.data as Record<string, unknown>, content: parsed.content };
    } catch (error) {
      skipped.push({
        file: filePath,
        reason: `unreadable frontmatter: ${error instanceof Error ? error.message : 'parse error'}`,
      });
      return null;
    }
  }

  /**
   * Walks a directory for roadmap markdowns of the given kind (epics and
   * decisions coexist in `roadmap/`, distinguished by their `kind:`
   * frontmatter) and upserts a row for each.
   */
  private rebuildRoadmap(
    projectId: string,
    projectKey: string,
    dir: string,
    kind: 'epic' | 'sprint' | 'decision',
    skipped: { file: string; reason: string }[],
  ): RebuildCounts {
    const root = path.join(this.paths.projectRoot, dir);
    if (!existsSync(root)) return { scanned: 0, upserted: 0 };

    let scanned = 0;
    let upserted = 0;

    for (const fileName of listMarkdownFiles(root)) {
      const filePath = path.join(root, fileName);
      const data = this.markdownIo.read(filePath).mnemaData;

      // The directory may hold more than one kind (epic + decision); only
      // act on files whose frontmatter matches the kind we're rebuilding.
      if (readString(data, 'kind') !== kind) continue;
      scanned += 1;

      const key = readString(data, 'key');
      if (key === null) {
        skipped.push({ file: filePath, reason: 'missing mnema.key' });
        continue;
      }
      const expectedKey = fileName.replace(/\.md$/, '');
      if (key !== expectedKey) {
        skipped.push({
          file: filePath,
          reason: `mnema.key (${key}) does not match filename (${expectedKey})`,
        });
        continue;
      }
      if (!key.startsWith(`${projectKey}-`)) {
        skipped.push({ file: filePath, reason: 'key prefix does not match project' });
        continue;
      }

      const changed =
        kind === 'epic'
          ? this.upsertEpic(projectId, key, data)
          : kind === 'sprint'
            ? this.upsertSprint(projectId, key, data)
            : this.upsertDecision(projectId, key, data);
      if (changed) upserted += 1;
    }

    return { scanned, upserted };
  }

  /** Inserts an epic when absent, or realigns its state when it drifted. */
  private upsertEpic(projectId: string, key: string, data: Record<string, unknown>): boolean {
    const state = readEnum(data, 'state', EpicState, EpicState.Open);
    const existing = this.epics.findByKey(key);
    if (existing === null) {
      const epic = this.epics.insert({
        key,
        projectId,
        title: readString(data, 'title') ?? key,
        description: readString(data, 'description'),
        metadata: readRecord(data, 'metadata'),
      });
      if (state !== EpicState.Open) this.epics.updateState(epic.id, state);
      return true;
    }
    let changed = false;
    if (existing.state !== state) {
      this.epics.updateState(existing.id, state);
      changed = true;
    }
    const drift = collectEpicContentDrift(existing, data);
    if (drift !== null) {
      this.epics.updateFields(existing.id, drift);
      changed = true;
    }
    return changed;
  }

  /** Inserts a sprint when absent, or realigns its state when it drifted. */
  private upsertSprint(projectId: string, key: string, data: Record<string, unknown>): boolean {
    const state = readEnum(data, 'state', SprintState, SprintState.Planned);
    const existing = this.sprints.findByKey(key);
    if (existing === null) {
      const sprint = this.sprints.insert({
        key,
        projectId,
        name: readString(data, 'name') ?? key,
        goal: readString(data, 'goal'),
        startsAt: readString(data, 'starts_at'),
        endsAt: readString(data, 'ends_at'),
        capacity: readNumber(data, 'capacity'),
        metadata: readRecord(data, 'metadata'),
      });
      if (state !== SprintState.Planned) this.sprints.updateState(sprint.id, state);
      return true;
    }
    let changed = false;
    if (existing.state !== state) {
      this.sprints.updateState(existing.id, state);
      changed = true;
    }
    const drift = collectSprintContentDrift(existing, data);
    if (drift !== null) {
      this.sprints.updateFields(existing.id, drift);
      changed = true;
    }
    return changed;
  }

  /**
   * Inserts a decision when absent, or realigns its status when it
   * drifted. The `superseded_by` link is deliberately left for
   * {@link relinkSupersededDecisions}: the successor may not be walked yet
   * when this row is upserted, so resolving it here would drop a forward
   * reference.
   */
  private upsertDecision(projectId: string, key: string, data: Record<string, unknown>): boolean {
    const status = readEnum(data, 'status', DecisionStatus, DecisionStatus.Proposed);
    const decisionText = readString(data, 'decision');
    const existing = this.decisions.findByKey(key);
    if (existing === null) {
      const authoredBy = this.actors.upsert(
        readString(data, 'authored_by') ?? 'unknown',
        ActorKind.Human,
      );
      const decision = this.decisions.insert({
        key,
        projectId,
        title: readString(data, 'title') ?? key,
        decision: decisionText ?? '',
        context: readString(data, 'context'),
        rationale: readString(data, 'rationale'),
        consequences: readString(data, 'consequences'),
        impacts: readStringArray(data, 'impacts'),
        metadata: readRecord(data, 'metadata'),
        authoredBy,
      });
      if (status !== DecisionStatus.Proposed) {
        this.decisions.updateStatus(decision.id, status, null);
      }
      return true;
    }
    let changed = false;
    if (existing.status !== status) {
      this.decisions.updateStatus(existing.id, status, null);
      changed = true;
    }
    // Content only — status and superseded_by are owned by updateStatus and
    // the relinkSupersededDecisions second pass, never touched here.
    const drift = collectDecisionContentDrift(existing, data);
    if (drift !== null) {
      this.decisions.updateFields(existing.id, drift);
      changed = true;
    }
    return changed;
  }

  /**
   * Second pass over the roadmap decisions: resolves each superseded
   * decision's `superseded_by` key to the successor's freshly-inserted id
   * and writes the pointer. Runs after every decision row exists so a
   * forward reference (successor walked after the row that points at it)
   * survives, and re-applies the link even when {@link upsertDecision}
   * left the status unchanged.
   */
  private relinkSupersededDecisions(dir: string, projectKey: string): void {
    const root = path.join(this.paths.projectRoot, dir);
    if (!existsSync(root)) return;

    for (const fileName of listMarkdownFiles(root)) {
      const data = this.markdownIo.read(path.join(root, fileName)).mnemaData;
      if (readString(data, 'kind') !== 'decision') continue;

      const status = readEnum(data, 'status', DecisionStatus, DecisionStatus.Proposed);
      if (status !== DecisionStatus.Superseded) continue;

      const key = readString(data, 'key');
      if (key === null || key !== fileName.replace(/\.md$/, '')) continue;
      if (!key.startsWith(`${projectKey}-`)) continue;

      const decision = this.decisions.findByKey(key);
      if (decision === null) continue;

      const supersededByKey = readString(data, 'superseded_by');
      const supersededById =
        supersededByKey !== null ? (this.decisions.findByKey(supersededByKey)?.id ?? null) : null;
      if (decision.supersededBy === supersededById) continue;

      this.decisions.updateStatus(decision.id, status, supersededById);
    }
  }

  /**
   * Second pass over the backlog tasks: recreates each `blocks` dependency
   * edge declared by a task's `depends_on` frontmatter. Runs after every
   * task row exists so a blocker walked after the dependent still resolves.
   * Edges live only in the git-ignored `dependencies` table, so this is the
   * only thing that restores them on a fresh clone — without it a blocked
   * task would read as ready. Resolves each key to its id, skips a dangling
   * reference (blocker absent) rather than crashing, and is idempotent: an
   * edge already present is left untouched.
   */
  private relinkTaskDependencies(projectKey: string): void {
    const root = path.join(this.paths.projectRoot, this.paths.backlogDir);
    if (!existsSync(root)) return;

    for (const stateDir of listDirs(root)) {
      if (!this.validStates.has(stateDir)) continue;
      const stateRoot = path.join(root, stateDir);

      for (const fileName of listMarkdownFiles(stateRoot)) {
        const data = this.markdownIo.read(path.join(stateRoot, fileName)).mnemaData;

        const key = readString(data, 'key');
        if (key === null || key !== fileName.replace(/\.md$/, '')) continue;

        const dependsOn = readStringArray(data, 'depends_on');
        if (dependsOn.length === 0) continue;

        const parsedKey = parseTaskKey(key);
        if (parsedKey === null || parsedKey.projectKey !== projectKey) continue;

        const task = this.tasks.findByKey(key);
        if (task === null) continue;

        for (const blockerKey of dependsOn) {
          const blocker = this.tasks.findByKey(blockerKey);
          // A dangling reference (blocker absent, or the task blocking
          // itself) is skipped rather than crashing the rebuild.
          if (blocker === null || blocker.id === task.id) continue;
          if (this.dependencies.exists(task.id, blocker.id, 'blocks')) continue;
          this.dependencies.insert({
            taskId: task.id,
            blocksTaskId: blocker.id,
            kind: 'blocks',
          });
        }
      }
    }
  }
}

/**
 * Compares a cached task row against its committed frontmatter and returns
 * only the content columns that drifted, shaped for
 * {@link TaskRepository.updateFields}. Returns `null` when nothing changed
 * so the caller can skip the write and leave `updated_at` truthful.
 *
 * Mirrors the fields {@link serialiseTask} round-trips and the insert
 * path's fallbacks (title/priority default the same way) so a freshly
 * written mirror reports no drift. `assigneeId` is passed in already
 * resolved from the `assignee` handle, matching how the insert branch
 * derives it.
 */
function collectTaskContentDrift(
  existing: Task,
  data: Record<string, unknown>,
  assigneeId: string | null,
): TaskFieldUpdates | null {
  const updates: { -readonly [K in keyof TaskFieldUpdates]: TaskFieldUpdates[K] } = {};
  let changed = false;

  const title = readString(data, 'title');
  if (title !== null && title !== existing.title) {
    updates.title = title;
    changed = true;
  }

  const description = readString(data, 'description');
  if (description !== existing.description) {
    updates.description = description;
    changed = true;
  }

  const acceptanceCriteria = readStringArray(data, 'acceptance_criteria');
  if (!sameStringArray(acceptanceCriteria, existing.acceptanceCriteria)) {
    updates.acceptanceCriteria = acceptanceCriteria;
    changed = true;
  }

  const estimate = readNumber(data, 'estimate');
  if (estimate !== existing.estimate) {
    updates.estimate = estimate;
    changed = true;
  }

  const priority = readNumber(data, 'priority') ?? 3;
  if (priority !== existing.priority) {
    updates.priority = priority;
    changed = true;
  }

  if (assigneeId !== existing.assigneeId) {
    updates.assigneeId = assigneeId;
    changed = true;
  }

  const metadata = readRecord(data, 'metadata');
  if (!sameRecord(metadata, existing.metadata)) {
    updates.metadata = metadata;
    changed = true;
  }

  return changed ? updates : null;
}

/**
 * Content drift for an existing epic, shaped for {@link EpicRepository.updateFields}.
 * Returns `null` when nothing changed. Mirrors {@link serialiseEpic}'s fields and
 * the insert path's fallbacks (title defaults to the key), so a freshly written
 * mirror reports no drift.
 */
function collectEpicContentDrift(
  existing: Epic,
  data: Record<string, unknown>,
): EpicFieldUpdates | null {
  const updates: { -readonly [K in keyof EpicFieldUpdates]: EpicFieldUpdates[K] } = {};
  let changed = false;

  const title = readString(data, 'title');
  if (title !== null && title !== existing.title) {
    updates.title = title;
    changed = true;
  }

  const description = readString(data, 'description');
  if (description !== existing.description) {
    updates.description = description;
    changed = true;
  }

  const metadata = readRecord(data, 'metadata');
  if (!sameRecord(metadata, existing.metadata)) {
    updates.metadata = metadata;
    changed = true;
  }

  return changed ? updates : null;
}

/**
 * Content drift for an existing sprint, shaped for {@link SprintRepository.updateFields}.
 * Returns `null` when nothing changed.
 */
function collectSprintContentDrift(
  existing: Sprint,
  data: Record<string, unknown>,
): SprintFieldUpdates | null {
  const updates: { -readonly [K in keyof SprintFieldUpdates]: SprintFieldUpdates[K] } = {};
  let changed = false;

  const name = readString(data, 'name');
  if (name !== null && name !== existing.name) {
    updates.name = name;
    changed = true;
  }

  const goal = readString(data, 'goal');
  if (goal !== existing.goal) {
    updates.goal = goal;
    changed = true;
  }

  const startsAt = readString(data, 'starts_at');
  if (startsAt !== existing.startsAt) {
    updates.startsAt = startsAt;
    changed = true;
  }

  const endsAt = readString(data, 'ends_at');
  if (endsAt !== existing.endsAt) {
    updates.endsAt = endsAt;
    changed = true;
  }

  const capacity = readNumber(data, 'capacity');
  if (capacity !== existing.capacity) {
    updates.capacity = capacity;
    changed = true;
  }

  const metadata = readRecord(data, 'metadata');
  if (!sameRecord(metadata, existing.metadata)) {
    updates.metadata = metadata;
    changed = true;
  }

  return changed ? updates : null;
}

/**
 * Content drift for an existing decision, shaped for {@link DecisionRepository.updateFields}.
 * Returns `null` when nothing changed. `status` and `superseded_by` are owned by the
 * status path and are never included here.
 */
function collectDecisionContentDrift(
  existing: Decision,
  data: Record<string, unknown>,
): DecisionFieldUpdates | null {
  const updates: { -readonly [K in keyof DecisionFieldUpdates]: DecisionFieldUpdates[K] } = {};
  let changed = false;

  const title = readString(data, 'title');
  if (title !== null && title !== existing.title) {
    updates.title = title;
    changed = true;
  }

  const decision = readString(data, 'decision');
  if (decision !== null && decision !== existing.decision) {
    updates.decision = decision;
    changed = true;
  }

  const context = readString(data, 'context');
  if (context !== existing.context) {
    updates.context = context;
    changed = true;
  }

  const rationale = readString(data, 'rationale');
  if (rationale !== existing.rationale) {
    updates.rationale = rationale;
    changed = true;
  }

  const consequences = readString(data, 'consequences');
  if (consequences !== existing.consequences) {
    updates.consequences = consequences;
    changed = true;
  }

  const impacts = readStringArray(data, 'impacts');
  if (!sameStringArray(impacts, existing.impacts)) {
    updates.impacts = impacts;
    changed = true;
  }

  const metadata = readRecord(data, 'metadata');
  if (!sameRecord(metadata, existing.metadata)) {
    updates.metadata = metadata;
    changed = true;
  }

  return changed ? updates : null;
}

function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Order-insensitive equality for two frontmatter records, compared by their
 * canonical JSON. Good enough to decide whether metadata drifted — both sides
 * come from the same serialiser, so key order is stable in practice.
 */
function sameRecord(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function listDirs(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function listMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name);
}

function readString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(data: Record<string, unknown>, key: string): number | null {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Reads the serialized `git_pr` frontmatter ({url, state}) back into a
 * {@link GitPrRef}, or null when absent/malformed — a garbled value never
 * fails the whole rebuild.
 */
function readGitPr(data: Record<string, unknown>): GitPrRef | null {
  const value = data.git_pr;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { url, state } = value as Record<string, unknown>;
  if (typeof url !== 'string' || url.length === 0 || typeof state !== 'string') return null;
  return { url, state };
}

function readStringArray(data: Record<string, unknown>, key: string): string[] {
  const value = data[key];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function readRecord(data: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = data[key];
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * Reads a string frontmatter value and narrows it to a known enum,
 * falling back to a default when absent or unrecognised. Keeps a
 * hand-edited or future-version file from crashing the rebuild.
 */
function readEnum<T extends Record<string, string>>(
  data: Record<string, unknown>,
  key: string,
  enumObject: T,
  fallback: T[keyof T],
): T[keyof T] {
  const value = data[key];
  const values = Object.values(enumObject) as string[];
  return typeof value === 'string' && values.includes(value) ? (value as T[keyof T]) : fallback;
}
