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

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('packages/core/workflows');

function makeConfig() {
  return ConfigSchema.parse({
    version: '2.0',
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

    const id = '019f7700-0000-7000-8000-000000000001';
    const md = `---
mnema:
  id: ${id}
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
    writeFileSync(path.join(draftDir, `${id}.md`), md, 'utf-8');

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
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Move via fs',
      actor: 'daniel',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.id;

    const draftFile = path.join(root, '.mnema/backlog', 'DRAFT', `${id}.md`);
    const readyDir = path.join(root, '.mnema/backlog', 'READY');
    mkdirSync(readyDir, { recursive: true });

    const original = readFileSync(draftFile, 'utf-8');
    writeFileSync(path.join(readyDir, `${id}.md`), original.replace('DRAFT', 'READY'), 'utf-8');
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
    const id = created.value.id;
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
    // canonical DONE/ mirror stays in place). Two copies of one id now
    // exist across state dirs — same `<id>.md`, so the id dedup collides.
    const doneFile = path.join(root, '.mnema/backlog', 'DONE', `${id}.md`);
    const readyDir = path.join(root, '.mnema/backlog', 'READY');
    mkdirSync(readyDir, { recursive: true });
    const doneMd = readFileSync(doneFile, 'utf-8');
    writeFileSync(path.join(readyDir, `${id}.md`), doneMd.replace('DONE', 'READY'), 'utf-8');

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
    const draftFile = path.join(root, '.mnema/backlog', 'DRAFT', `${created.value.id}.md`);
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
    const file = path.join(root, '.mnema/roadmap', `${created.value.id}.md`);
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
    const file = path.join(root, '.mnema/sprints', `${planned.value.id}.md`);
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
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.value.sprint.name).toBe('Sprint EDITED');
    expect(reloaded.value.sprint.goal).toBe('ship the EDITED');
    expect(reloaded.value.sprint.capacity).toBe(20);
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

  it('skips files whose mnema.id does not match the filename', () => {
    const dir = path.join(root, '.mnema/backlog', 'DRAFT');
    mkdirSync(dir, { recursive: true });

    // The mirror is named by the committed id. A file whose frontmatter id
    // disagrees with its filename is skipped fail-closed — the rebuild never
    // adopts a row whose committed identity does not match where it lives.
    const md = `---
mnema:
  id: 019f7700-0000-7000-8000-000000000099
  key: TEST-1
  state: DRAFT
  title: wrong filename
---

body
`;
    writeFileSync(path.join(dir, '019f7700-0000-7000-8000-000000000001.md'), md, 'utf-8');

    const summary = container.syncRebuild.run('TEST');
    expect(summary.skipped.length).toBeGreaterThan(0);
    expect(summary.skipped.some((s) => s.reason.includes('does not match filename'))).toBe(true);
    expect(existsSync(path.join(root, '.mnema/state', 'state.db'))).toBe(true);

    const list = container.task.list();
    expect(list).toHaveLength(0);
  });

  it('skips a backlog directory whose name is not a workflow state', () => {
    // A valid task in a real state, alongside a task under a bogus
    // directory. Since migration 004 dropped the tasks.state CHECK, an
    // unknown state would otherwise persist and strand the task past the
    // workflow gates — the rebuild must refuse it.
    const validId = '019f7700-0000-7000-8000-000000000001';
    const draftDir = path.join(root, '.mnema/backlog', 'DRAFT');
    mkdirSync(draftDir, { recursive: true });
    const validMd = `---
mnema:
  id: ${validId}
  key: TEST-1
  state: DRAFT
  title: Legit task
  reporter: daniel
---

# Legit task
`;
    writeFileSync(path.join(draftDir, `${validId}.md`), validMd, 'utf-8');

    const bogusId = '019f7700-0000-7000-8000-000000000002';
    const bogusDir = path.join(root, '.mnema/backlog', 'NOTASTATE');
    mkdirSync(bogusDir, { recursive: true });
    const bogusMd = `---
mnema:
  id: ${bogusId}
  key: TEST-2
  state: NOTASTATE
  title: Smuggled task
  reporter: daniel
---

# Smuggled task
`;
    writeFileSync(path.join(bogusDir, `${bogusId}.md`), bogusMd, 'utf-8');

    const summary = container.syncRebuild.run('TEST');

    // The legit task is upserted; the smuggled one is reported skipped.
    const list = container.task.list();
    expect(list.map((t) => t.key)).toEqual(['TEST-1']);
    expect(summary.skipped.some((s) => s.file.includes(`${bogusId}.md`))).toBe(true);
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

  it('preserves a task reopen_count across a fresh-clone rebuild', () => {
    // Drive a task to DONE, then reopen it so reopen_count becomes non-zero
    // (the counter only bumps on a reopen from a terminal state).
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Reopened work',
      acceptanceCriteria: ['done once'],
      actor: 'daniel',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const key = created.value.key;
    const move = (action: string, payload: Record<string, unknown> = {}) => {
      const r = container.task.transition({ taskKey: key, action, payload, actor: 'daniel' });
      expect(r.ok, `${action}: ${r.ok ? '' : JSON.stringify(r.error)}`).toBe(true);
    };
    move('submit');
    move('start', { assignee_id: 'daniel' });
    move('submit_review', { pr_url: 'https://github.com/o/r/pull/1' });
    move('approve', { approval_note: 'lgtm' });
    move('reopen', { reason: 'regression found' });

    const before = container.task.findByKey(key);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.value.reopenCount).toBe(1);

    // Fresh clone: flush mirror, drop the state cache, rebuild from disk.
    container.sync.rebuildMirrors();
    container.close();
    rmSync(path.join(root, '.mnema/state'), { recursive: true, force: true });
    const fresh = createServiceContainer(makeConfig(), root, { migrationsDir });
    try {
      fresh.syncRebuild.run('TEST');
      const after = fresh.task.findByKey(key);
      expect(after.ok).toBe(true);
      if (!after.ok) return;
      // The whole point of the fix: reopen_count survives, not reset to 0.
      expect(after.value.reopenCount).toBe(1);
    } finally {
      fresh.close();
    }
  });

  it('preserves the committed id of every backlog entity across a fresh-clone rebuild', () => {
    // Option C: the v7 UUID is the COMMITTED identity — it must survive the
    // clone (the mirror carries it, the rebuild adopts it) rather than being
    // re-minted, which is what made the id clone-local before.
    const task = container.task.create({
      projectKey: 'TEST',
      title: 'Identity survives',
      acceptanceCriteria: ['stable id'],
      actor: 'daniel',
    });
    const epic = container.epic.create({ projectKey: 'TEST', title: 'An epic', actor: 'daniel' });
    const sprint = container.sprint.plan({ projectKey: 'TEST', name: 'A sprint', actor: 'daniel' });
    const decision = container.decision.record({
      projectKey: 'TEST',
      title: 'A decision',
      decision: 'do the thing',
      actor: 'daniel',
    });
    expect(task.ok && epic.ok && sprint.ok && decision.ok).toBe(true);
    if (!(task.ok && epic.ok && sprint.ok && decision.ok)) return;
    const ids = {
      task: task.value.id,
      epic: epic.value.id,
      sprint: sprint.value.id,
      decision: decision.value.id,
    };
    const keys = {
      task: task.value.key,
      epic: epic.value.key,
      sprint: sprint.value.key,
      decision: decision.value.key,
    };

    container.sync.rebuildMirrors();
    container.close();
    rmSync(path.join(root, '.mnema/state'), { recursive: true, force: true });
    const fresh = createServiceContainer(makeConfig(), root, { migrationsDir });
    try {
      fresh.syncRebuild.run('TEST');
      // Each entity is resolved by its human key, but its id is the SAME one
      // committed to the mirror — not a fresh mint.
      const t = fresh.task.findByKey(keys.task); // value = Task
      const e = fresh.epic.show(keys.epic); // value = EpicView ({ epic, ... })
      const d = fresh.decision.show(keys.decision); // value = Decision
      const s = fresh.sprint.show(keys.sprint); // value = SprintView ({ sprint, ... })
      expect(t.ok && e.ok && d.ok && s.ok).toBe(true);
      if (!(t.ok && e.ok && d.ok && s.ok)) return;
      expect(t.value.id).toBe(ids.task);
      expect(e.value.epic.id).toBe(ids.epic);
      expect(d.value.id).toBe(ids.decision);
      expect(s.value.sprint.id).toBe(ids.sprint);
    } finally {
      fresh.close();
    }
  });

  it('preserves the blocks dependency graph across a fresh-clone rebuild (by id)', () => {
    // The depends_on frontmatter carries the blocker's committed id now, so the
    // blocks edge relinks by id on a clone. This is the graph the plan warns
    // evaporates silently if the reference does not survive.
    const blocker = container.task.create({
      projectKey: 'TEST',
      title: 'Blocker',
      acceptanceCriteria: ['x'],
      actor: 'daniel',
    });
    const blocked = container.task.create({
      projectKey: 'TEST',
      title: 'Blocked',
      acceptanceCriteria: ['x'],
      actor: 'daniel',
    });
    expect(blocker.ok && blocked.ok).toBe(true);
    if (!(blocker.ok && blocked.ok)) return;
    const link = container.dependency.link({
      taskKey: blocked.value.key,
      blocksTaskKey: blocker.value.key,
      kind: 'blocks',
      actor: 'daniel',
    });
    expect(link.ok).toBe(true);
    const blockerId = blocker.value.id;

    // Re-mirror the blocked task so its `depends_on` reaches disk (linking a
    // dependency updates the DB edge; the mirror follows on the next sync).
    container.sync.syncTask(blocked.value.key);
    container.sync.flushAll();
    container.close();
    rmSync(path.join(root, '.mnema/state'), { recursive: true, force: true });
    const fresh = createServiceContainer(makeConfig(), root, { migrationsDir });
    try {
      fresh.syncRebuild.run('TEST');
      // The edge survives, keyed on the committed blocker id — the same id, and
      // the same edge, not a dangling reference silently dropped.
      const view = fresh.dependency.listFor(blocked.value.key);
      expect(view.ok).toBe(true);
      if (!view.ok) return;
      const blocks = view.value.dependsOn.filter((d) => d.kind === 'blocks');
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.blocksTaskId).toBe(blockerId);
    } finally {
      fresh.close();
    }
  });

  it('preserves a closed epic created_at + closed_at across a fresh-clone rebuild', () => {
    const created = container.epic.create({
      projectKey: 'TEST',
      title: 'Delivered epic',
      description: 'closed and re-cloned',
      actor: 'daniel',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const key = created.value.key;
    const closed = container.epic.close({ epicKey: key, actor: 'daniel' });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;

    const before = container.epic.show(key);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const { createdAt, closedAt, state } = before.value.epic;
    // Guard the assertion is meaningful: a closed epic has both timestamps set.
    expect(state).toBe('CLOSED');
    expect(closedAt).not.toBeNull();

    container.sync.rebuildMirrors();
    container.epic.rebuildMirrors('TEST');
    container.close();
    rmSync(path.join(root, '.mnema/state'), { recursive: true, force: true });
    const fresh = createServiceContainer(makeConfig(), root, { migrationsDir });
    try {
      fresh.syncRebuild.run('TEST');
      const after = fresh.epic.show(key);
      expect(after.ok).toBe(true);
      if (!after.ok) return;
      // The committed timestamps survive — not reset to the clone's "now".
      expect(after.value.epic.state).toBe('CLOSED');
      expect(after.value.epic.createdAt).toBe(createdAt);
      expect(after.value.epic.closedAt).toBe(closedAt);
    } finally {
      fresh.close();
    }
  });

  it('stamps closed_at when a task reaches DONE and preserves it across a fresh-clone rebuild', () => {
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Delivered task',
      description: 'driven to done and re-cloned',
      acceptanceCriteria: ['it works'],
      estimate: 1,
      actor: 'daniel',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const key = created.value.key;
    // A freshly-created task carries no close time.
    expect(created.value.closedAt).toBeNull();

    const move = (action: string, payload: Record<string, unknown>) => {
      const r = container.task.transition({ taskKey: key, action, payload, actor: 'daniel' });
      expect(r.ok).toBe(true);
    };
    move('submit', {});
    move('start', { assignee_id: 'daniel' });
    move('submit_review', { pr_url: 'https://github.com/o/r/pull/1' });
    move('approve', { approval_note: 'lgtm' });

    const before = container.task.findByKey(key);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    // Entering the terminal state stamped closed_at.
    expect(before.value.state).toBe('DONE');
    expect(before.value.closedAt).not.toBeNull();
    const closedAt = before.value.closedAt;

    container.sync.rebuildMirrors();
    container.close();
    rmSync(path.join(root, '.mnema/state'), { recursive: true, force: true });
    const fresh = createServiceContainer(makeConfig(), root, { migrationsDir });
    try {
      fresh.syncRebuild.run('TEST');
      const after = fresh.task.findByKey(key);
      expect(after.ok).toBe(true);
      if (!after.ok) return;
      // The stamped close time survives the mirror → fresh-DB round-trip.
      expect(after.value.state).toBe('DONE');
      expect(after.value.closedAt).toBe(closedAt);
    } finally {
      fresh.close();
    }
  });

  it('clears closed_at when a terminal task is reopened', () => {
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Reopened task',
      description: 'done then reopened',
      acceptanceCriteria: ['it works'],
      estimate: 1,
      actor: 'daniel',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const key = created.value.key;
    const move = (action: string, payload: Record<string, unknown>) => {
      const r = container.task.transition({ taskKey: key, action, payload, actor: 'daniel' });
      expect(r.ok, `${action} should succeed`).toBe(true);
    };
    move('submit', {});
    move('start', { assignee_id: 'daniel' });
    move('submit_review', { pr_url: 'https://github.com/o/r/pull/1' });
    move('approve', { approval_note: 'lgtm' });

    const done = container.task.findByKey(key);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.closedAt).not.toBeNull();

    // Reopening leaves the terminal state, so the close time is cleared.
    move('reopen', { reason: 'regressed in QA' });
    const reopened = container.task.findByKey(key);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.value.state).not.toBe('DONE');
    expect(reopened.value.closedAt).toBeNull();
  });

  // Incremental sync-rebuild over an already-populated DB must reconcile
  // closed_at from the authoritative mirror, not just state. Regression for
  // the reopen-on-disk (stale close retained) and complete-on-disk (disk
  // close dropped) cases.
  const markdownIo = new MarkdownIo();
  const stateMirror = (state: string, id: string) =>
    path.join(root, '.mnema/backlog', state, `${id}.md`);

  function driveToDone(key: string): void {
    const move = (action: string, payload: Record<string, unknown>) => {
      const r = container.task.transition({ taskKey: key, action, payload, actor: 'daniel' });
      expect(r.ok, `${action} should succeed`).toBe(true);
    };
    move('submit', {});
    move('start', { assignee_id: 'daniel' });
    move('submit_review', { pr_url: 'https://github.com/o/r/pull/1' });
    move('approve', { approval_note: 'lgtm' });
  }

  it('reconcile: clears closed_at when a task is reopened on disk', () => {
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Disk-reopened task',
      description: 'done in cache, reopened in the mirror',
      acceptanceCriteria: ['it works'],
      estimate: 1,
      actor: 'daniel',
    });
    if (!created.ok) return;
    const key = created.value.key;
    const id = created.value.id;
    driveToDone(key);
    const done = container.task.findByKey(key);
    if (!done.ok) return;
    expect(done.value.closedAt).not.toBeNull();

    // Edit the mirror on disk: move it to IN_PROGRESS and drop closed_at,
    // as a merge/hand-edit would. Remove the stale DONE mirror so the walk
    // sees the row in exactly one state dir.
    rmSync(stateMirror('DONE', id), { force: true });
    mkdirSync(path.dirname(stateMirror('IN_PROGRESS', id)), { recursive: true });
    markdownIo.write(stateMirror('IN_PROGRESS', id), {
      mnemaData: {
        id,
        key,
        state: 'IN_PROGRESS',
        title: 'Disk-reopened task',
        closed_at: null,
        updated_at: new Date(Date.parse(done.value.updatedAt) + 1000).toISOString(),
      },
      otherFrontmatter: {},
      content: '# task\n',
    });

    container.syncRebuild.run('TEST');

    const after = container.task.findByKey(key);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.state).toBe('IN_PROGRESS');
    // Before the fix the cache kept the stale DONE close time.
    expect(after.value.closedAt).toBeNull();
  });

  it('reconcile: carries closed_at into the cache when a task is completed on disk', () => {
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Disk-completed task',
      description: 'submitted in cache, marked done in the mirror',
      acceptanceCriteria: ['it works'],
      estimate: 1,
      actor: 'daniel',
    });
    if (!created.ok) return;
    const key = created.value.key;
    const id = created.value.id;
    // Move it to a non-terminal live state so the row starts with a null close.
    const submit = container.task.transition({
      taskKey: key,
      action: 'submit',
      payload: {},
      actor: 'daniel',
    });
    expect(submit.ok).toBe(true);
    const before = container.task.findByKey(key);
    if (!before.ok) return;
    expect(before.value.closedAt).toBeNull();

    // The mirror says DONE with an explicit close time (a merge landed the
    // completed snapshot). Remove the READY mirror; write the DONE one.
    rmSync(stateMirror('READY', id), { force: true });
    const diskClosedAt = '2026-01-02T03:04:05.000Z';
    mkdirSync(path.dirname(stateMirror('DONE', id)), { recursive: true });
    markdownIo.write(stateMirror('DONE', id), {
      mnemaData: {
        id,
        key,
        state: 'DONE',
        title: 'Disk-completed task',
        closed_at: diskClosedAt,
        updated_at: diskClosedAt,
      },
      otherFrontmatter: {},
      content: '# task\n',
    });

    container.syncRebuild.run('TEST');

    const after = container.task.findByKey(key);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.state).toBe('DONE');
    // Before the fix the disk close time was dropped (row stayed null).
    expect(after.value.closedAt).toBe(diskClosedAt);
  });

  it('reconstructs the provenance graph from the audit on a fresh clone', () => {
    // An observation promoted to a decision builds an observation → decision
    // edge in the (git-ignored) provenance_links cache.
    const obs = container.observation.record({
      content: 'a signal worth promoting',
      actor: 'daniel',
    });
    expect(obs.ok).toBe(true);
    if (!obs.ok) return;
    const promoted = container.decision.promoteFromObservation({
      observationId: obs.value.id,
      projectKey: 'TEST',
      title: 'Promoted decision',
      decision: 'do the thing',
      actor: 'daniel',
    });
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;
    const decisionKey = promoted.value.key;

    // Sanity: the edge exists before the clone.
    const beforeChain = container.provenance.chain({ kind: 'decision', ref: decisionKey });
    expect(beforeChain.upstream.some((e) => e.fromKind === 'observation')).toBe(true);

    // Fresh clone: the provenance_links table is git-ignored, so it is gone;
    // only the committed audit chain survives.
    container.sync.rebuildMirrors();
    container.close();
    rmSync(path.join(root, '.mnema/state'), { recursive: true, force: true });
    const fresh = createServiceContainer(makeConfig(), root, { migrationsDir });
    try {
      fresh.syncRebuild.run('TEST');
      // The edge is rebuilt from the decision_promoted_from_observation event.
      const afterChain = fresh.provenance.chain({ kind: 'decision', ref: decisionKey });
      const edge = afterChain.upstream.find((e) => e.fromKind === 'observation');
      expect(edge, 'observation → decision provenance edge must survive the clone').toBeDefined();
      expect(edge?.toRef).toBe(decisionKey);
    } finally {
      fresh.close();
    }
  });

  it('reconstructs a skill-supersede provenance edge on a fresh clone', () => {
    // Two skills, then supersede the first with the second — the live wiring
    // records a skill → skill edge keyed on ROW IDS (which are regenerated on a
    // clone) and retires the superseded skill's mirror. The rebuild recovers the
    // edge from the skill_superseded audit event, remapping the successor to its
    // fresh row id and anchoring the retired end at its stable slug.
    const recorded = container.skill.record({
      slug: 'old-skill',
      name: 'Old skill',
      description: 'the way we used to do it',
      content: 'the old steps',
      actor: 'daniel',
    });
    expect(recorded.ok).toBe(true);
    container.skill.record({
      slug: 'new-skill',
      name: 'New skill',
      description: 'the way we do it now',
      content: 'the new steps',
      actor: 'daniel',
    });
    // Drive the real supersede path so the audit event is written by production
    // code — not hand-crafted.
    const superseded = container.skill.supersede('old-skill', 'new-skill', 'daniel');
    expect(superseded.ok).toBe(true);

    // Sanity: the edge exists live before the clone (keyed on row ids).
    const beforeNew = container.skill.show('new-skill');
    expect(beforeNew.ok).toBe(true);
    if (!beforeNew.ok) return;
    const beforeChain = container.provenance.chain({ kind: 'skill', ref: beforeNew.value.id });
    expect(beforeChain.upstream.some((e) => e.fromKind === 'skill')).toBe(true);

    // Fresh clone: drop the git-ignored state (rows AND the provenance cache),
    // rebuild from the committed mirrors + audit chain.
    container.sync.rebuildMirrors();
    container.close();
    rmSync(path.join(root, '.mnema/state'), { recursive: true, force: true });
    const fresh = createServiceContainer(makeConfig(), root, { migrationsDir });
    try {
      fresh.syncRebuild.run('TEST');

      // The successor survives the clone with a NEW row id.
      const afterNew = fresh.skill.show('new-skill');
      expect(afterNew.ok).toBe(true);
      if (!afterNew.ok) return;
      const newId = afterNew.value.id;

      // Walking up from the successor's new id surfaces the reconstructed edge,
      // resolved to that new row id — not the pre-clone id, not empty.
      const afterChain = fresh.provenance.chain({ kind: 'skill', ref: newId });
      const edge = afterChain.upstream.find((e) => e.fromKind === 'skill');
      expect(edge, 'skill-supersede provenance edge must survive the clone').toBeDefined();
      expect(edge?.toRef).toBe(newId);
      // The superseded skill has no mirror after being retired, so its stable
      // slug anchors the source end.
      expect(edge?.fromRef).toBe('old-skill');
    } finally {
      fresh.close();
    }
  });

  it('carries the stable successor key on a skill_superseded audit event', () => {
    // The remap above only works because the event records the successor's
    // stable (slug, version), not just the regenerated row id.
    container.skill.record({
      slug: 'legacy',
      name: 'Legacy',
      description: 'old',
      content: 'a',
      actor: 'daniel',
    });
    container.skill.record({
      slug: 'current',
      name: 'Current',
      description: 'new',
      content: 'b',
      actor: 'daniel',
    });
    container.skill.supersede('legacy', 'current', 'daniel');

    const events = container.auditQuery.run({ kind: 'skill_superseded' });
    expect(events).toHaveLength(1);
    const { data } = events[0] ?? { data: {} };
    expect(data.slug).toBe('legacy');
    expect(data.version).toBe(1);
    expect(data.successor_slug).toBe('current');
    expect(data.successor_version).toBe(1);
    // The pre-existing row-id pointer is preserved for existing readers.
    expect(typeof data.superseded_by).toBe('string');
  });

  // MNEMA-343: the task mirror must serialise assignee/reporter as stable
  // HANDLES, not regenerated actor UUIDs. Before the fix a task with an
  // assignee was non-idempotent (every sync re-drifted assigneeId) and a
  // fresh clone rebound it to a bogus actor whose handle was a UUID string.
  it('a task with an assignee is idempotent across sync (no assignee drift)', () => {
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Assigned task',
      description: 'x',
      acceptanceCriteria: ['a'],
      estimate: 1,
      actor: 'daniel',
    });
    if (!created.ok) return;
    const key = created.value.key;
    const move = (action: string, payload: Record<string, unknown>) => {
      const r = container.task.transition({ taskKey: key, action, payload, actor: 'daniel' });
      expect(r.ok, `${action} should succeed`).toBe(true);
    };
    move('submit', {});
    move('start', { assignee_id: 'daniel' }); // assigns the actor

    const first = container.syncRebuild.run('TEST');
    const second = container.syncRebuild.run('TEST');
    // Before the fix the mirror held the assignee UUID, read back as a handle,
    // upserting a new actor each run → a phantom upsert every sync.
    expect(first.tasksUpserted).toBe(0);
    expect(second.tasksUpserted).toBe(0);
  });

  it('rebinds an assigned task to the SAME actor on a fresh clone (handle round-trip)', () => {
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Assigned + cloned',
      description: 'x',
      acceptanceCriteria: ['a'],
      estimate: 1,
      actor: 'daniel',
    });
    if (!created.ok) return;
    const key = created.value.key;
    container.task.transition({
      taskKey: key,
      action: 'submit',
      payload: {},
      actor: 'daniel',
    });
    container.task.transition({
      taskKey: key,
      action: 'start',
      payload: { assignee_id: 'daniel' },
      actor: 'daniel',
    });
    const before = container.task.findByKey(key);
    if (!before.ok) return;
    expect(before.value.assigneeId).not.toBeNull();

    // Fresh clone: drop the (git-ignored) state cache and rebuild from mirrors.
    container.sync.rebuildMirrors();
    container.close();
    rmSync(path.join(root, '.mnema/state'), { recursive: true, force: true });
    const fresh = createServiceContainer(makeConfig(), root, { migrationsDir });
    try {
      fresh.syncRebuild.run('TEST');
      const after = fresh.task.findByKey(key);
      expect(after.ok).toBe(true);
      if (!after.ok) return;
      // Still assigned after the clone…
      expect(after.value.assigneeId).not.toBeNull();
      // …and 'daniel' is a real actor in the roster, NOT replaced by a bogus
      // actor whose handle is a UUID string (the bug's signature).
      const roster = fresh.identity.listActors();
      expect(roster.some((a) => a.handle === 'daniel')).toBe(true);
      const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
      expect(roster.some((a) => uuidLike.test(a.handle))).toBe(false);
    } finally {
      fresh.close();
    }
  });
});
