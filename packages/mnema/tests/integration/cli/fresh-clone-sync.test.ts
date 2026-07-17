import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '@mnema/core/config/config-schema.js';
import { createServiceContainer } from '@mnema/core/services/service-container.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectMirrorDrift } from '@/cli/commands/doctor-command.js';

/**
 * Regression for the "commit markdown, rebuild with `mnema sync`" promise.
 *
 * On a fresh clone the state directory is git-ignored, so `.mnema/state/`
 * does not exist and the database has never been created. Two failures
 * used to break the promise:
 *
 *  1. Opening the database crashed with a raw better-sqlite3 error
 *     because the parent directory was missing.
 *  2. Even once the directory existed, `sync` rebuilt nothing — the
 *     freshly-migrated database had no `projects` row, so the rebuild
 *     bailed before scanning the committed backlog.
 *
 * This test reproduces a clean checkout (config + workflow + backlog
 * markdown on disk, but no state directory) and asserts the container
 * boots and `syncRebuild` rehydrates the committed task.
 */
const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('packages/core/workflows');

/** Builds a checkout that has everything git tracks but no `.mnema/state/`. */
function freshClone(): string {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-clone-'));

  // Version-controlled layout: config, the active workflow, committed
  // backlog markdown, plus roadmap (epics + decisions) and sprints.
  // Deliberately NO `.mnema/state/` — that is the git-ignored directory
  // a clone never has.
  mkdirSync(path.join(projectRoot, '.mnema/workflows'), { recursive: true });
  mkdirSync(path.join(projectRoot, '.mnema/backlog/DRAFT'), { recursive: true });
  mkdirSync(path.join(projectRoot, '.mnema/roadmap'), { recursive: true });
  mkdirSync(path.join(projectRoot, '.mnema/sprints'), { recursive: true });
  mkdirSync(path.join(projectRoot, '.mnema/memory'), { recursive: true });
  mkdirSync(path.join(projectRoot, '.mnema/skills/default'), { recursive: true });
  mkdirSync(path.join(projectRoot, '.mnema/skills/authored'), { recursive: true });

  const config = ConfigSchema.parse({
    version: '1.0',
    mnema_version: '^0.1.0',
    project: { key: 'CLONE', name: 'Clone Test' },
    workflow: 'default',
  });
  writeFileSync(
    path.join(projectRoot, '.mnema/mnema.config.json'),
    JSON.stringify(config, null, 2),
  );

  // Copy the default workflow as the project ships it.
  writeFileSync(
    path.join(projectRoot, '.mnema/workflows/default.json'),
    readFileSync(path.join(workflowsSrc, 'default.json'), 'utf-8'),
  );

  // A committed task markdown, in the shape `sync-service` writes,
  // carrying its epic/sprint links by key.
  const taskMd = [
    '---',
    'mnema:',
    '  key: CLONE-1',
    '  state: DRAFT',
    '  title: Survives the clone',
    '  description: A task that was committed as markdown',
    '  acceptance_criteria:',
    '    - rebuilds from disk',
    '  estimate: 3',
    '  priority: 2',
    '  assignee: null',
    '  reporter: alice',
    '  epic_key: CLONE-EPIC-1',
    '  sprint_key: CLONE-SPRINT-1',
    '  reopen_count: 0',
    '  metadata: {}',
    "  updated_at: '2026-06-01T00:00:00.000Z'",
    '---',
    '# Survives the clone',
    '',
  ].join('\n');
  writeFileSync(path.join(projectRoot, '.mnema/backlog/DRAFT/CLONE-1.md'), taskMd);

  // Committed roadmap: an epic and a decision share roadmap/, the sprint
  // lives under sprints/ — the shape `RoadmapMirror` writes.
  const epicMd = [
    '---',
    'mnema:',
    '  key: CLONE-EPIC-1',
    '  kind: epic',
    '  state: OPEN',
    '  title: The committed epic',
    '  description: groups the clone tasks',
    '  metadata: {}',
    "  created_at: '2026-06-01T00:00:00.000Z'",
    '  closed_at: null',
    '---',
    '# The committed epic',
    '',
  ].join('\n');
  writeFileSync(path.join(projectRoot, '.mnema/roadmap/CLONE-EPIC-1.md'), epicMd);

  const decisionMd = [
    '---',
    'mnema:',
    '  key: CLONE-ADR-1',
    '  kind: decision',
    '  status: accepted',
    '  title: Commit the roadmap as markdown',
    '  context: null',
    '  decision: Mirror epics, sprints and decisions to disk',
    '  rationale: null',
    '  consequences: null',
    '  superseded_by: null',
    '  authored_by: alice',
    '  impacts: []',
    '  metadata: {}',
    "  at: '2026-06-01T00:00:00.000Z'",
    '---',
    '# Commit the roadmap as markdown',
    '',
  ].join('\n');
  writeFileSync(path.join(projectRoot, '.mnema/roadmap/CLONE-ADR-1.md'), decisionMd);

  const sprintMd = [
    '---',
    'mnema:',
    '  key: CLONE-SPRINT-1',
    '  kind: sprint',
    '  state: PLANNED',
    '  name: First cycle',
    '  goal: rebuild from disk',
    '  starts_at: null',
    '  ends_at: null',
    '  capacity: null',
    '  metadata: {}',
    "  created_at: '2026-06-01T00:00:00.000Z'",
    '  closed_at: null',
    '---',
    '# First cycle',
    '',
  ].join('\n');
  writeFileSync(path.join(projectRoot, '.mnema/sprints/CLONE-SPRINT-1.md'), sprintMd);

  // Committed knowledge mirrors, in the FLAT-frontmatter shape the memory and
  // skill writers produce (not the nested `mnema:` block the backlog uses).
  const memoryMd = [
    '---',
    'title: A durable fact',
    'topics: ["architecture","clone"]',
    "created_at: '2026-06-01T00:00:00.000Z'",
    "updated_at: '2026-06-02T00:00:00.000Z'",
    '---',
    '',
    'The project uses git-tracked markdown as the source of truth.',
    '',
  ].join('\n');
  writeFileSync(path.join(projectRoot, '.mnema/memory/git-native-truth.md'), memoryMd);

  // A SCOPED memory: it mirrors under a scope-folder, and its raw scope is
  // carried in the frontmatter (the folder is only a lossy projection).
  const scopedMemoryMd = [
    '---',
    'title: Notifier retry policy',
    'topics: ["notifier"]',
    'scope: packages/notifier',
    "created_at: '2026-06-01T00:00:00.000Z'",
    "updated_at: '2026-06-02T00:00:00.000Z'",
    '---',
    '',
    'Retries use exponential backoff capped at 30s.',
    '',
  ].join('\n');
  mkdirSync(path.join(projectRoot, '.mnema/memory/packages-notifier'), { recursive: true });
  writeFileSync(
    path.join(projectRoot, '.mnema/memory/packages-notifier/notifier-retry.md'),
    scopedMemoryMd,
  );

  // A tool-shipped seed skill under default/ (author = system).
  const seedSkillMd = [
    '---',
    'name: Bug report',
    'version: 1.0.0',
    'description: How to file a good bug report',
    'tools_used: []',
    'usage_count: 0',
    "created_at: '2026-06-01T00:00:00.000Z'",
    "updated_at: '2026-06-01T00:00:00.000Z'",
    '---',
    '',
    // `zephyrredact` is a distinctive token that appears ONLY in the body —
    // not in name/description — so a search for it exercises the FTS body
    // columns (content_core), which a mirror rebuild must populate.
    'Steps to write a bug report: redact secrets with the zephyrredact helper.',
    '',
  ].join('\n');
  writeFileSync(path.join(projectRoot, '.mnema/skills/default/bug-report.md'), seedSkillMd);

  // A human-authored, invocable skill under authored/, with a used counter.
  const authoredSkillMd = [
    '---',
    'name: Release checklist',
    'version: 2.0.0',
    'description: The steps before cutting a release',
    'tools_used: ["pr_status"]',
    'invocable: true',
    'dynamic_context: ["release"]',
    'usage_count: 4',
    "last_used_at: '2026-06-10T00:00:00.000Z'",
    "created_at: '2026-06-01T00:00:00.000Z'",
    "updated_at: '2026-06-09T00:00:00.000Z'",
    '---',
    '',
    'Run the checklist before release.',
    '',
  ].join('\n');
  writeFileSync(
    path.join(projectRoot, '.mnema/skills/authored/release-checklist.md'),
    authoredSkillMd,
  );

  return projectRoot;
}

function makeConfig() {
  return ConfigSchema.parse({
    version: '1.0',
    mnema_version: '^0.1.0',
    project: { key: 'CLONE', name: 'Clone Test' },
    workflow: 'default',
  });
}

describe('fresh clone → sync', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = freshClone();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  /** Opens a container against the clone and runs `fn`, always closing it. */
  function withClone<T>(fn: (container: ReturnType<typeof createServiceContainer>) => T): T {
    const container = createServiceContainer(makeConfig(), projectRoot, { migrationsDir });
    try {
      return fn(container);
    } finally {
      container.close();
    }
  }

  it('boots the container without a pre-existing state directory', () => {
    // Bug #1: this used to throw a raw "Cannot open database because the
    // directory does not exist" because `.mnema/state/` was missing.
    withClone((container) => {
      expect(container.adapter.getDatabase().open).toBe(true);
    });
  });

  it('seeds the project from config so the rebuild has something to scan', () => {
    withClone((container) => {
      // Bug #2: without seeding, `projects` was empty and the rebuild
      // returned scanned=0. The config is the source of truth on a clone.
      const summary = container.syncRebuild.run('CLONE');
      expect(summary.tasksScanned).toBe(1);
      expect(summary.tasksUpserted).toBe(1);
      expect(summary.skipped).toEqual([]);
    });
  });

  it('rehydrates the committed task into the database', () => {
    withClone((container) => {
      container.syncRebuild.run('CLONE');

      const result = container.task.findByKey('CLONE-1');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.title).toBe('Survives the clone');
      expect(result.value.state).toBe('DRAFT');
      expect([...result.value.acceptanceCriteria]).toEqual(['rebuilds from disk']);
    });
  });

  it('is idempotent: a second rebuild upserts nothing new', () => {
    withClone((container) => {
      container.syncRebuild.run('CLONE');
      const second = container.syncRebuild.run('CLONE');
      expect(second.tasksScanned).toBe(1);
      expect(second.tasksUpserted).toBe(0);
      expect(second.epics.upserted).toBe(0);
      expect(second.sprints.upserted).toBe(0);
      expect(second.decisions.upserted).toBe(0);
    });
  });

  it('rehydrates the committed epic, sprint and decision (bug #3)', () => {
    withClone((container) => {
      const summary = container.syncRebuild.run('CLONE');
      expect(summary.epics.upserted).toBe(1);
      expect(summary.sprints.upserted).toBe(1);
      expect(summary.decisions.upserted).toBe(1);

      const epic = container.epic.show('CLONE-EPIC-1');
      expect(epic.ok).toBe(true);
      if (epic.ok) expect(epic.value.epic.title).toBe('The committed epic');

      const sprint = container.sprint.show('CLONE-SPRINT-1');
      expect(sprint).not.toBeNull();
      expect(sprint?.sprint.name).toBe('First cycle');

      const decision = container.decision.show('CLONE-ADR-1');
      expect(decision.ok).toBe(true);
      // The committed status was `accepted` — the rebuild must preserve it,
      // not reset to the `proposed` default every decision starts at.
      if (decision.ok) expect(decision.value.status).toBe('accepted');
    });
  });

  it('relinks the task to its epic and sprint by key', () => {
    withClone((container) => {
      container.syncRebuild.run('CLONE');

      const task = container.task.findByKey('CLONE-1');
      const epic = container.epic.show('CLONE-EPIC-1');
      const sprint = container.sprint.show('CLONE-SPRINT-1');
      expect(task.ok && epic.ok && sprint !== null).toBe(true);
      if (!task.ok || !epic.ok || sprint === null) return;

      // The links survive the clone: the task points at the rehydrated
      // epic/sprint rows even though their UUIDs were regenerated.
      expect(task.value.epicId).toBe(epic.value.epic.id);
      expect(task.value.sprintId).toBe(sprint.sprint.id);
    });
  });

  it('rehydrates committed memory mirrors into the database', () => {
    withClone((container) => {
      const summary = container.syncRebuild.run('CLONE');
      expect(summary.memories.scanned).toBe(2);
      expect(summary.memories.upserted).toBe(2);

      const memories = container.memory.list();
      expect(memories.map((m) => m.slug)).toContain('git-native-truth');
      const shown = container.memory.show('git-native-truth');
      expect(shown.ok).toBe(true);
      if (shown.ok) {
        expect(shown.value.title).toBe('A durable fact');
        expect([...shown.value.topics]).toEqual(['architecture', 'clone']);
        // Committed timestamps are preserved, not reset to now.
        expect(shown.value.createdAt).toBe('2026-06-01T00:00:00.000Z');
        expect(shown.value.updatedAt).toBe('2026-06-02T00:00:00.000Z');
        // A scopeless memory stays scopeless.
        expect(shown.value.scope).toBeNull();
      }
    });
  });

  it('recovers the raw scope of a scoped memory from the frontmatter', () => {
    withClone((container) => {
      container.syncRebuild.run('CLONE');
      const scoped = container.memory.show('notifier-retry');
      expect(scoped.ok).toBe(true);
      if (scoped.ok) {
        // The folder is `packages-notifier` (lossy), but the frontmatter
        // carried the raw `packages/notifier` — which is what round-trips.
        expect(scoped.value.scope).toBe('packages/notifier');
        expect(scoped.value.title).toBe('Notifier retry policy');
      }
    });
  });

  it('rehydrates committed skill mirrors (both origins, latest version)', () => {
    withClone((container) => {
      const summary = container.syncRebuild.run('CLONE');
      expect(summary.skills.scanned).toBe(2);
      expect(summary.skills.upserted).toBe(2);

      const skills = container.skill.list();
      expect(skills.map((s) => s.slug).sort()).toEqual(['bug-report', 'release-checklist']);

      const authored = container.skill.show('release-checklist');
      expect(authored.ok).toBe(true);
      if (authored.ok) {
        // The `2.0.0` mirror version becomes the integer row version 2.
        expect(authored.value.version).toBe(2);
        expect(authored.value.invocable).toBe(true);
        expect([...authored.value.toolsUsed]).toEqual(['pr_status']);
        expect(authored.value.usageCount).toBe(4);
      }
    });
  });

  it('a mirror-rebuilt skill is searchable by a BODY-only term (FTS content_core populated)', () => {
    withClone((container) => {
      container.syncRebuild.run('CLONE');
      // `zephyrredact` lives only in bug-report's body. Migration 035 indexes
      // the body via content_core/content_examples, so insertFromMirror must
      // populate them — otherwise the rebuilt skill is body-unsearchable.
      const result = container.search.search('zephyrredact', { entities: ['skill'] });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.map((h) => h.key)).toContain('bug-report');
      }
    });
  });

  it('knowledge rebuild is idempotent: a second sync upserts nothing', () => {
    withClone((container) => {
      container.syncRebuild.run('CLONE');
      const second = container.syncRebuild.run('CLONE');
      expect(second.memories.scanned).toBe(2);
      expect(second.memories.upserted).toBe(0);
      expect(second.skills.scanned).toBe(2);
      expect(second.skills.upserted).toBe(0);
    });
  });

  it('reports a green roadmap mirror after a sync', () => {
    withClone((container) => {
      container.syncRebuild.run('CLONE');

      const checks = inspectMirrorDrift(container.adapter, {
        skillsDir: path.join(projectRoot, '.mnema/skills'),
        memoryDir: path.join(projectRoot, '.mnema/memory'),
        roadmapDir: path.join(projectRoot, '.mnema/roadmap'),
        sprintsDir: path.join(projectRoot, '.mnema/sprints'),
        backlogDir: path.join(projectRoot, '.mnema/backlog'),
        observationsDir: path.join(projectRoot, '.mnema/observations'),
      });
      const roadmap = checks.filter((c) =>
        ['epics mirrored', 'sprints mirrored', 'decisions mirrored'].includes(c.name),
      );
      expect(roadmap).toHaveLength(3);
      expect(roadmap.every((c) => c.ok)).toBe(true);
    });
  });
});
