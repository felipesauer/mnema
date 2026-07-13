import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '@/config/config-schema.js';
import { DecisionStatus } from '@/domain/enums/decision-status.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';
import { MarkdownIo } from '@/storage/markdown/markdown-io.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('workflows');

function makeConfig() {
  return ConfigSchema.parse({
    version: '1.0',
    mnema_version: '^0.1.0',
    project: { key: 'TEST', name: 'Test' },
    workflow: 'default',
  });
}

function setupProject(): { root: string; container: ServiceContainer } {
  const root = mkdtempSync(path.join(tmpdir(), 'mnema-rebuild-'));
  for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  copyFileSync(
    path.join(workflowsSrc, 'default.json'),
    path.join(root, '.mnema/workflows', 'default.json'),
  );

  const container = createServiceContainer(makeConfig(), root, { migrationsDir });

  return { root, container };
}

describe('SyncRebuild', () => {
  let root: string;
  let container: ServiceContainer;

  beforeEach(() => {
    const setup = setupProject();
    root = setup.root;
    container = setup.container;
  });

  afterEach(() => {
    container.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('inserts tasks for markdowns that are not yet in the database', () => {
    const draftDir = path.join(root, '.mnema/backlog', 'DRAFT');
    mkdirSync(draftDir, { recursive: true });

    const md = `---
mnema:
  key: TEST-1
  state: DRAFT
  title: Imported task
  description: ''
  acceptance_criteria: []
  estimate: null
  priority: 3
  reporter: daniel
  reopen_count: 0
  metadata: {}
---

# Imported task
`;
    writeFileSync(path.join(draftDir, 'TEST-1.md'), md, 'utf-8');

    const summary = container.syncRebuild.run('TEST');
    expect(summary.tasksScanned).toBe(1);
    expect(summary.tasksUpserted).toBe(1);

    const list = container.task.list();
    expect(list.map((t) => t.key)).toEqual(['TEST-1']);
    expect(list[0]?.title).toBe('Imported task');
  });

  it('is idempotent — second run reports zero changes', () => {
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Existing',
      actor: 'daniel',
    });
    expect(created.ok).toBe(true);

    const first = container.syncRebuild.run('TEST');
    const second = container.syncRebuild.run('TEST');

    expect(first.tasksUpserted).toBe(0);
    expect(second.tasksUpserted).toBe(0);
    expect(first.tasksScanned).toBe(second.tasksScanned);
  });

  it('updates state when the markdown lives in a different state folder', () => {
    container.task.create({ projectKey: 'TEST', title: 'Move via fs', actor: 'daniel' });

    const draftFile = path.join(root, '.mnema/backlog', 'DRAFT', 'TEST-1.md');
    const readyDir = path.join(root, '.mnema/backlog', 'READY');
    mkdirSync(readyDir, { recursive: true });

    const original = readFileSync(draftFile, 'utf-8');
    writeFileSync(path.join(readyDir, 'TEST-1.md'), original.replace('DRAFT', 'READY'), 'utf-8');
    rmSync(draftFile, { force: true });

    const summary = container.syncRebuild.run('TEST');
    expect(summary.tasksUpserted).toBe(1);
    expect(summary.conflicts).toEqual([]);

    const reloaded = container.task.findByKey('TEST-1');
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.value.state).toBe('READY');

    // Realigning an already-cached row's state must not be invisible: a
    // `sync_realign` event records the change (the field incident silently
    // regressed DONE tasks with no audit trace).
    const realigns = container.auditQuery.run({ kind: 'sync_realign' });
    expect(realigns).toHaveLength(1);
    expect(realigns[0]?.data).toMatchObject({ key: 'TEST-1', from: 'DRAFT', to: 'READY' });
  });

  it('refuses to realign a task mirrored in more than one state dir (no silent regression)', () => {
    // A task that is genuinely DONE in the cache…
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Delivered work',
      description: 'a real deliverable',
      acceptanceCriteria: ['it works'],
      estimate: 1,
      actor: 'daniel',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const key = created.value.key;
    const move = (action: string, payload: Record<string, unknown>) => {
      const r = container.task.transition({ taskKey: key, action, payload, actor: 'daniel' });
      expect(r.ok).toBe(true);
    };
    move('submit', {});
    move('start', { assignee_id: 'daniel' });
    move('submit_review', { pr_url: 'https://github.com/o/r/pull/1' });
    move('approve', { approval_note: 'lgtm' });

    const doneReload = container.task.findByKey(key);
    expect(doneReload.ok).toBe(true);
    if (!doneReload.ok) return;
    expect(doneReload.value.state).toBe('DONE');

    // …but a squash-merge left a stale mirror of it in READY/ too (the
    // canonical DONE/ mirror stays in place). Two copies of one key now
    // exist across state dirs.
    const doneFile = path.join(root, '.mnema/backlog', 'DONE', `${key}.md`);
    const readyDir = path.join(root, '.mnema/backlog', 'READY');
    mkdirSync(readyDir, { recursive: true });
    const doneMd = readFileSync(doneFile, 'utf-8');
    writeFileSync(path.join(readyDir, `${key}.md`), doneMd.replace('DONE', 'READY'), 'utf-8');

    const summary = container.syncRebuild.run('TEST');

    // The row is left exactly as it was — never regressed to READY on a guess.
    const afterReload = container.task.findByKey(key);
    expect(afterReload.ok).toBe(true);
    if (!afterReload.ok) return;
    expect(afterReload.value.state).toBe('DONE');

    // The conflict is reported with both offending directories.
    expect(summary.conflicts).toHaveLength(1);
    expect(summary.conflicts[0]?.key).toBe(key);
    expect([...(summary.conflicts[0]?.states ?? [])].sort()).toEqual(['DONE', 'READY']);

    // And no realign event was emitted for the ambiguous key.
    const realigns = container.auditQuery.run({ kind: 'sync_realign' });
    expect(realigns.some((e) => (e.data as { key?: string }).key === key)).toBe(false);
  });

  it('reports no conflicts for a healthy one-mirror-per-task repo (guard is a no-op)', () => {
    container.task.create({ projectKey: 'TEST', title: 'Task A', actor: 'daniel' });
    container.task.create({ projectKey: 'TEST', title: 'Task B', actor: 'daniel' });

    const summary = container.syncRebuild.run('TEST');

    expect(summary.conflicts).toEqual([]);
    expect(summary.tasksScanned).toBe(2);
  });

  it('applies content drift (title/priority/acceptance_criteria) from the committed markdown', () => {
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Original title',
      actor: 'daniel',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // The create wrote the mirror; edit the committed markdown the way a
    // merged PR would — new title, new priority, a new acceptance criterion.
    const markdownIo = new MarkdownIo();
    const draftFile = path.join(root, '.mnema/backlog', 'DRAFT', `${created.value.key}.md`);
    const parsed = markdownIo.read(draftFile);
    markdownIo.write(draftFile, {
      ...parsed,
      mnemaData: {
        ...parsed.mnemaData,
        title: 'Edited by a merged PR',
        priority: 1,
        acceptance_criteria: ['a newly added criterion'],
      },
    });

    const summary = container.syncRebuild.run('TEST');

    // Content-only drift must count as an upsert (not 0).
    expect(summary.tasksUpserted).toBe(1);

    const reloaded = container.task.findByKey(created.value.key);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.value.title).toBe('Edited by a merged PR');
    expect(reloaded.value.priority).toBe(1);
    expect(reloaded.value.acceptanceCriteria).toEqual(['a newly added criterion']);
  });

  it('applies epic content drift (title/description) from the committed markdown', () => {
    const created = container.epic.create({
      projectKey: 'TEST',
      title: 'Epic original',
      description: 'epic original description',
      actor: 'daniel',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Row already exists in the cache; a merged PR edits the committed markdown.
    const markdownIo = new MarkdownIo();
    const file = path.join(root, '.mnema/roadmap', `${created.value.key}.md`);
    const parsed = markdownIo.read(file);
    markdownIo.write(file, {
      ...parsed,
      mnemaData: {
        ...parsed.mnemaData,
        title: 'Epic EDITED',
        description: 'epic EDITED description',
      },
    });

    const summary = container.syncRebuild.run('TEST');
    expect(summary.epics.upserted).toBe(1);

    const reloaded = container.epic.show(created.value.key);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.value.epic.title).toBe('Epic EDITED');
    expect(reloaded.value.epic.description).toBe('epic EDITED description');
  });

  it('applies sprint content drift (name/goal/capacity) from the committed markdown', () => {
    const planned = container.sprint.plan({
      projectKey: 'TEST',
      name: 'Sprint original',
      goal: 'ship the original',
      capacity: 10,
      actor: 'daniel',
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    const markdownIo = new MarkdownIo();
    const file = path.join(root, '.mnema/sprints', `${planned.value.key}.md`);
    const parsed = markdownIo.read(file);
    markdownIo.write(file, {
      ...parsed,
      mnemaData: {
        ...parsed.mnemaData,
        name: 'Sprint EDITED',
        goal: 'ship the EDITED',
        capacity: 20,
      },
    });

    const summary = container.syncRebuild.run('TEST');
    expect(summary.sprints.upserted).toBe(1);

    const reloaded = container.sprint.show(planned.value.key);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.sprint.name).toBe('Sprint EDITED');
    expect(reloaded?.sprint.goal).toBe('ship the EDITED');
    expect(reloaded?.sprint.capacity).toBe(20);
  });

  it('applies decision content drift (title/rationale) from the committed markdown', () => {
    const recorded = container.decision.record({
      projectKey: 'TEST',
      title: 'Decision original',
      decision: 'the decision body',
      rationale: 'original rationale',
      actor: 'daniel',
    });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;

    const markdownIo = new MarkdownIo();
    const file = path.join(root, '.mnema/roadmap', `${recorded.value.key}.md`);
    const parsed = markdownIo.read(file);
    markdownIo.write(file, {
      ...parsed,
      mnemaData: { ...parsed.mnemaData, title: 'Decision EDITED', rationale: 'EDITED rationale' },
    });

    const summary = container.syncRebuild.run('TEST');
    expect(summary.decisions.upserted).toBe(1);

    const reloaded = container.decision.show(recorded.value.key);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.value.title).toBe('Decision EDITED');
    expect(reloaded.value.rationale).toBe('EDITED rationale');
  });

  it('skips files whose mnema.key does not match the filename', () => {
    const dir = path.join(root, '.mnema/backlog', 'DRAFT');
    mkdirSync(dir, { recursive: true });

    const md = `---
mnema:
  key: TEST-99
  state: DRAFT
  title: wrong filename
---

body
`;
    writeFileSync(path.join(dir, 'TEST-1.md'), md, 'utf-8');

    const summary = container.syncRebuild.run('TEST');
    expect(summary.skipped.length).toBeGreaterThan(0);
    expect(existsSync(path.join(root, '.mnema/state', 'state.db'))).toBe(true);

    const list = container.task.list();
    expect(list).toHaveLength(0);
  });

  it('skips a backlog directory whose name is not a workflow state', () => {
    // A valid task in a real state, alongside a task under a bogus
    // directory. Since migration 004 dropped the tasks.state CHECK, an
    // unknown state would otherwise persist and strand the task past the
    // workflow gates — the rebuild must refuse it.
    const draftDir = path.join(root, '.mnema/backlog', 'DRAFT');
    mkdirSync(draftDir, { recursive: true });
    const validMd = `---
mnema:
  key: TEST-1
  state: DRAFT
  title: Legit task
  reporter: daniel
---

# Legit task
`;
    writeFileSync(path.join(draftDir, 'TEST-1.md'), validMd, 'utf-8');

    const bogusDir = path.join(root, '.mnema/backlog', 'NOTASTATE');
    mkdirSync(bogusDir, { recursive: true });
    const bogusMd = `---
mnema:
  key: TEST-2
  state: NOTASTATE
  title: Smuggled task
  reporter: daniel
---

# Smuggled task
`;
    writeFileSync(path.join(bogusDir, 'TEST-2.md'), bogusMd, 'utf-8');

    const summary = container.syncRebuild.run('TEST');

    // The legit task is upserted; the smuggled one is reported skipped.
    const list = container.task.list();
    expect(list.map((t) => t.key)).toEqual(['TEST-1']);
    expect(summary.skipped.some((s) => s.file.includes('TEST-2.md'))).toBe(true);
    expect(summary.skipped.some((s) => s.reason.includes('NOTASTATE'))).toBe(true);

    // No row anywhere carries the invalid state.
    expect(container.task.list().some((t) => t.state === 'NOTASTATE')).toBe(false);
  });

  it('preserves a decision supersede link across a rebuild from disk', () => {
    // Record two decisions and supersede the first with the second. The
    // real mirror is what lands on disk, so this exercises the exact
    // serialised shape the rebuild reads back.
    const first = container.decision.record({
      projectKey: 'TEST',
      title: 'Original approach',
      decision: 'do it the old way',
      actor: 'daniel',
    });
    const second = container.decision.record({
      projectKey: 'TEST',
      title: 'Replacement approach',
      decision: 'do it the new way',
      actor: 'daniel',
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const superseded = container.decision.transition({
      decisionKey: first.value.key,
      status: DecisionStatus.Superseded,
      supersededBy: second.value.key,
      actor: 'daniel',
    });
    expect(superseded.ok).toBe(true);

    // Simulate a fresh clone: the roadmap markdown is version-controlled
    // and present, but the git-ignored state DB is gone. The rebuild is
    // the only thing that repopulates the cache — and it walks the
    // superseded decision (ADR-1) before its successor (ADR-2).
    container.close();
    rmSync(path.join(root, '.mnema/state'), { recursive: true, force: true });
    const rebuilt = createServiceContainer(makeConfig(), root, { migrationsDir });
    try {
      rebuilt.syncRebuild.run('TEST');

      const one = rebuilt.decision.show(first.value.key);
      const two = rebuilt.decision.show(second.value.key);
      expect(one.ok && two.ok).toBe(true);
      if (!one.ok || !two.ok) return;

      // Status survives today; the successor pointer must too. The DB
      // stores it as the successor's regenerated id, so resolve through
      // the successor row rather than comparing the pre-rebuild id.
      expect(one.value.status).toBe(DecisionStatus.Superseded);
      expect(one.value.supersededBy).toBe(two.value.id);
    } finally {
      rebuilt.close();
      // Hand a live container back so the shared afterEach can close it.
      container = createServiceContainer(makeConfig(), root, { migrationsDir });
    }
  });

  it('restores an observation from its .md mirror after a state wipe', () => {
    const rec = container.observation.record({
      content: 'Build is flaky on Fridays',
      topics: ['ci', 'flaky'],
      actor: 'daniel',
    });
    expect(rec.ok).toBe(true);
    if (!rec.ok) return;
    const id = rec.value.id;

    // The record wrote a mirror carrying the full content.
    const mirrorPath = path.join(root, '.mnema/observations', `${id}.md`);
    expect(existsSync(mirrorPath)).toBe(true);
    expect(readFileSync(mirrorPath, 'utf-8')).toContain('Build is flaky on Fridays');

    // Wipe the cache DB — the mirror on disk is the only surviving copy.
    container.close();
    rmSync(path.join(root, '.mnema/state'), { recursive: true, force: true });
    const rebuilt = createServiceContainer(makeConfig(), root, { migrationsDir });
    try {
      const summary = rebuilt.syncRebuild.run('TEST');
      expect(summary.observations.scanned).toBe(1);
      expect(summary.observations.upserted).toBe(1);

      const restored = rebuilt.observation.list();
      expect(restored).toHaveLength(1);
      expect(restored[0]?.id).toBe(id);
      expect(restored[0]?.content).toBe('Build is flaky on Fridays');
      expect([...(restored[0]?.topics ?? [])]).toEqual(['ci', 'flaky']);

      // A second rebuild is a no-op — the row already exists.
      expect(rebuilt.syncRebuild.run('TEST').observations.upserted).toBe(0);
    } finally {
      rebuilt.close();
      container = createServiceContainer(makeConfig(), root, { migrationsDir });
    }
  });

  it('restores an observation linked to a task from disk', () => {
    const task = container.task.create({ projectKey: 'TEST', title: 'Linkable', actor: 'daniel' });
    expect(task.ok).toBe(true);
    if (!task.ok) return;
    const rec = container.observation.record({
      content: 'linked note',
      relatedTaskKey: task.value.key,
      actor: 'daniel',
    });
    expect(rec.ok).toBe(true);
    if (!rec.ok) return;

    container.close();
    rmSync(path.join(root, '.mnema/state'), { recursive: true, force: true });
    const rebuilt = createServiceContainer(makeConfig(), root, { migrationsDir });
    try {
      rebuilt.syncRebuild.run('TEST');
      // The note is re-linked to the freshly-inserted task by its stable key.
      const scoped = rebuilt.observation.list({ relatedTaskKey: task.value.key });
      expect(scoped.map((o) => o.content)).toEqual(['linked note']);
    } finally {
      rebuilt.close();
      container = createServiceContainer(makeConfig(), root, { migrationsDir });
    }
  });

  it('preserves the git branch + PR link across a rebuild from disk (ADR-49)', () => {
    // Audit finding: the git link was cache-only and lost on a fresh clone.
    // Branch + PR are now serialized to the task markdown and restored on
    // rebuild; the volatile commit list is intentionally re-derived by the
    // observer, so it does not survive (and must not fabricate a stale list).
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Git linked',
      actor: 'daniel',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const key = created.value.key;

    new TaskRepository(container.adapter).setGitLink(created.value.id, {
      branch: 'feat/linked',
      commits: [{ sha: 'aaaaaaa', subject: 'do it' }],
      pr: { url: 'https://example.com/pr/7', state: 'open' },
    });
    // The observer enqueues a sync on a real link change (watch-command);
    // mirror that, then flush the buffer so the markdown carries the link.
    container.sync.syncTask(created.value.key, { action: 'git_observed' });
    container.sync.flushAll();

    // Simulate a fresh clone: version-controlled markdown present, state DB gone.
    container.close();
    rmSync(path.join(root, '.mnema/state'), { recursive: true, force: true });
    const rebuilt = createServiceContainer(makeConfig(), root, { migrationsDir });
    try {
      rebuilt.syncRebuild.run('TEST');
      const reloaded = rebuilt.task.findByKey(key);
      expect(reloaded.ok).toBe(true);
      if (!reloaded.ok) return;
      // Stable identifiers survive the clone.
      expect(reloaded.value.gitBranch).toBe('feat/linked');
      expect(reloaded.value.gitPr).toEqual({ url: 'https://example.com/pr/7', state: 'open' });
      // Commits are re-derived by the observer, not serialized — no stale list.
      expect(reloaded.value.gitCommits).toHaveLength(0);
    } finally {
      rebuilt.close();
      container = createServiceContainer(makeConfig(), root, { migrationsDir });
    }
  });

  it('skips malformed / incomplete knowledge mirrors without crashing the rebuild', () => {
    // Seed the project row.
    container.task.create({ projectKey: 'TEST', title: 'seed', actor: 'daniel' });

    const memoryDir = path.join(root, '.mnema/memory');
    const skillsDir = path.join(root, '.mnema/skills/authored');
    mkdirSync(memoryDir, { recursive: true });
    mkdirSync(skillsDir, { recursive: true });

    // A good memory + a memory missing its title (skipped).
    writeFileSync(
      path.join(memoryDir, 'good.md'),
      '---\ntitle: Good\ntopics: []\n---\nbody\n',
      'utf-8',
    );
    writeFileSync(path.join(memoryDir, 'no-title.md'), '---\ntopics: []\n---\nbody\n', 'utf-8');
    // Unparseable YAML frontmatter (must be caught, not thrown).
    writeFileSync(path.join(memoryDir, 'broken.md'), '---\ntitle: "un\nclosed\n---\nx\n', 'utf-8');
    // A skill with an unreadable version (skipped).
    writeFileSync(
      path.join(skillsDir, 'bad-version.md'),
      '---\nname: Bad\nversion: not-a-version\ndescription: d\ntools_used: []\n---\nx\n',
      'utf-8',
    );

    const summary = container.syncRebuild.run('TEST');

    // The good memory landed; the three bad files were skipped, not fatal.
    expect(summary.memories.upserted).toBe(1);
    expect(summary.skills.upserted).toBe(0);
    const reasons = summary.skipped.map((s) => s.reason).join(' | ');
    expect(reasons).toMatch(/missing title/);
    expect(reasons).toMatch(/unreadable frontmatter/);
    expect(reasons).toMatch(/unreadable version/);
    expect(container.memory.list().map((m) => m.slug)).toContain('good');
  });

  it('never ingests the adopt scaffolding (context.md) as a memory row', () => {
    container.task.create({ projectKey: 'TEST', title: 'seed', actor: 'daniel' });
    const memoryDir = path.join(root, '.mnema/memory');
    mkdirSync(memoryDir, { recursive: true });
    // A titled context.md would otherwise become a phantom `context` row; a
    // bare one would otherwise raise a spurious "missing title" skip.
    writeFileSync(
      path.join(memoryDir, 'context.md'),
      '---\ntitle: Project context\n---\nscaffolding\n',
      'utf-8',
    );
    writeFileSync(path.join(memoryDir, 'INDEX.md'), '# index\n', 'utf-8');

    const summary = container.syncRebuild.run('TEST');

    expect(summary.memories.scanned).toBe(0);
    expect(summary.memories.upserted).toBe(0);
    expect(summary.skipped.some((s) => s.file.endsWith('context.md'))).toBe(false);
    expect(container.memory.list().map((m) => m.slug)).not.toContain('context');
  });
});
