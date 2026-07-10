import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import type { Task } from '../domain/entities/task.js';
import { ActorKind } from '../domain/enums/actor-kind.js';
import { DecisionStatus } from '../domain/enums/decision-status.js';
import { EpicState } from '../domain/enums/epic-state.js';
import { SprintState } from '../domain/enums/sprint-state.js';
import type { TaskState } from '../domain/enums/task-state.js';
import { parseTaskKey } from '../domain/id-generator.js';
import { MarkdownIo } from '../storage/markdown/markdown-io.js';
import type { ActorRepository } from '../storage/sqlite/repositories/actor-repository.js';
import type { DecisionRepository } from '../storage/sqlite/repositories/decision-repository.js';
import type { EpicRepository } from '../storage/sqlite/repositories/epic-repository.js';
import type { LabelRepository } from '../storage/sqlite/repositories/label-repository.js';
import type { ProjectRepository } from '../storage/sqlite/repositories/project-repository.js';
import type { SprintRepository } from '../storage/sqlite/repositories/sprint-repository.js';
import type {
  TaskFieldUpdates,
  TaskRepository,
} from '../storage/sqlite/repositories/task-repository.js';

/**
 * Per-entity tally of a {@link SyncRebuild.run} execution.
 */
export interface RebuildCounts {
  readonly scanned: number;
  readonly upserted: number;
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
  readonly skipped: readonly { readonly file: string; readonly reason: string }[];
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
    private readonly labels: LabelRepository,
    private readonly paths: {
      readonly projectRoot: string;
      readonly backlogDir: string;
      readonly roadmapDir: string;
      readonly sprintsDir: string;
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
  ) {}

  /**
   * Walks the version-controlled markdown and upserts a row for each
   * entity it finds, then relinks tasks to their epic/sprint.
   *
   * For each markdown:
   * - the `mnema:` frontmatter is the source of truth
   * - missing actors are created (handles taken verbatim from the file)
   * - existing rows are touched only when something changed, to keep
   *   `updated_at` truthful
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
      skipped: [],
    };

    const project = this.projects.findByKey(projectKey);
    if (project === null) {
      return empty;
    }

    const skipped: { file: string; reason: string }[] = [];

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
    const tasks = this.rebuildTasks(project.id, project.key, skipped);

    return {
      tasksScanned: tasks.scanned,
      tasksUpserted: tasks.upserted,
      epics,
      sprints,
      decisions,
      skipped,
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
  ): RebuildCounts {
    const root = path.join(this.paths.projectRoot, this.paths.backlogDir);
    if (!existsSync(root)) return { scanned: 0, upserted: 0 };

    let scanned = 0;
    let upserted = 0;

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
            this.tasks.updateState(existing.id, stateName, null);
            changed = true;
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
    if (existing.state !== state) {
      this.epics.updateState(existing.id, state);
      return true;
    }
    return false;
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
    if (existing.state !== state) {
      this.sprints.updateState(existing.id, state);
      return true;
    }
    return false;
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
        authoredBy,
      });
      if (status !== DecisionStatus.Proposed) {
        this.decisions.updateStatus(decision.id, status, null);
      }
      return true;
    }
    if (existing.status !== status) {
      this.decisions.updateStatus(existing.id, status, null);
      return true;
    }
    return false;
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

  return changed ? updates : null;
}

function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
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
