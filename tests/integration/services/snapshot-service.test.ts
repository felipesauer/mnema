import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StateMachine } from '@/domain/state-machine/state-machine.js';
import { WorkflowLoader } from '@/domain/state-machine/workflow-loader.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { CoverageService } from '@/services/coverage-service.js';
import { DependencyGraphService } from '@/services/dependency-graph-service.js';
import { InboxService } from '@/services/inbox-service.js';
import { renderHtml, renderMarkdown } from '@/services/snapshot-render.js';
import { SnapshotService } from '@/services/snapshot-service.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { DependencyRepository } from '@/storage/sqlite/repositories/dependency-repository.js';
import { EpicRepository } from '@/storage/sqlite/repositories/epic-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { SprintRepository } from '@/storage/sqlite/repositories/sprint-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const DAY = 86_400_000;

describe('SnapshotService', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let snapshot: SnapshotService;
  let epics: EpicRepository;
  let tasks: TaskRepository;
  let deps: DependencyRepository;
  let projectId: string;
  let actorId: string;
  const now = Date.parse('2026-06-30T12:00:00.000Z');

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-snapshot-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    const projects = new ProjectRepository(adapter);
    projectId = projects.insert({ key: 'TEST', name: 'Test' }).id;
    adapter
      .getDatabase()
      .prepare("INSERT INTO actors (id, handle, kind) VALUES ('a1', 'daniel', 'human')")
      .run();
    actorId = 'a1';
    tasks = new TaskRepository(adapter);
    epics = new EpicRepository(adapter);
    const sprints = new SprintRepository(adapter);
    deps = new DependencyRepository(adapter);
    const stateMachine = new StateMachine(
      new WorkflowLoader().load(path.resolve('workflows/default.json')),
    );
    const coverage = new CoverageService(epics, sprints, tasks, stateMachine);
    const graph = new DependencyGraphService(deps, tasks, epics, sprints, stateMachine);
    // IN_REVIEW SLA of 1 day so an aged review task breaches. The inbox's
    // decision dependency only feeds pendingDecisions, which the snapshot
    // ignores — a minimal stand-in keeps this test focused on tasks.
    const inbox = new InboxService(
      tasks,
      { pendingDecisions: () => [] } as unknown as ConstructorParameters<typeof InboxService>[1],
      'TEST',
      stateMachine,
      { staleAfterDays: 99, slaDays: { IN_REVIEW: 1 } },
    );
    snapshot = new SnapshotService(coverage, graph, inbox, epics, sprints, tasks);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  /** Insert a task in a given state, optionally aged and in an epic. */
  function seed(
    key: string,
    opts: { state?: string; epicId?: string; agedDays?: number } = {},
  ): string {
    const at = new Date(now - (opts.agedDays ?? 0) * DAY).toISOString();
    const id = `id-${key}`;
    adapter
      .getDatabase()
      .prepare(
        `INSERT INTO tasks (id, key, project_id, epic_id, title, description, acceptance_criteria,
           state, priority, reporter_id, reopen_count, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '', '[]', ?, 3, ?, 0, '{}', ?, ?)`,
      )
      .run(
        id,
        key,
        projectId,
        opts.epicId ?? null,
        `Task ${key}`,
        opts.state ?? 'DRAFT',
        actorId,
        at,
        at,
      );
    return id;
  }

  it('composes coverage, dependency graph and scoped SLA breaches for an epic', () => {
    const epic = epics.insert({ key: 'TEST-EPIC-1', projectId, title: 'Auth epic' });
    // 1 DONE, 1 blocked chain (A blocks B), 1 IN_REVIEW aged 3d (SLA 1d → breach).
    seed('T-DONE', { state: 'DONE', epicId: epic.id });
    const a = seed('T-A', { state: 'READY', epicId: epic.id });
    const b = seed('T-B', { state: 'READY', epicId: epic.id });
    deps.insert({ taskId: b, blocksTaskId: a, kind: 'blocks' }); // A blocks B
    seed('T-REV', { state: 'IN_REVIEW', epicId: epic.id, agedDays: 3 });
    // A task in ANOTHER epic that also breaches — must NOT leak into this scope.
    seed('OTHER-1', { state: 'IN_REVIEW', agedDays: 9 });

    const result = snapshot.forScope({ kind: 'epic', key: 'TEST-EPIC-1' }, now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const s = result.value;

    expect(s.title).toBe('Auth epic');
    expect(s.coverage.total).toBe(4);
    expect(s.coverage.terminal).toBe(1); // T-DONE
    expect(s.graph.criticalPath).toEqual(['T-A', 'T-B']);
    // Only the in-scope IN_REVIEW task breaches; OTHER-1 is excluded.
    expect(s.slaBreaches.map((x) => x.key)).toEqual(['T-REV']);
  });

  it('returns EpicNotFound for an unknown epic', () => {
    const result = snapshot.forScope({ kind: 'epic', key: 'NOPE-9' }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe(ErrorCode.EpicNotFound);
  });

  it('renders markdown with the headline sections', () => {
    const epic = epics.insert({ key: 'TEST-EPIC-1', projectId, title: 'Auth epic' });
    seed('T-DONE', { state: 'DONE', epicId: epic.id });
    const result = snapshot.forScope({ kind: 'epic', key: 'TEST-EPIC-1' }, now);
    if (!result.ok) return;
    const md = renderMarkdown(result.value);
    expect(md).toContain('# Snapshot — Auth epic');
    expect(md).toContain('## Coverage');
    expect(md).toContain('## Dependencies');
    expect(md).toContain('## SLA breaches');
  });

  it('renders self-contained HTML that escapes interpolated text', () => {
    const epic = epics.insert({ key: 'TEST-EPIC-1', projectId, title: 'A & B <auth>' });
    seed('T-1', { state: 'DRAFT', epicId: epic.id });
    const result = snapshot.forScope({ kind: 'epic', key: 'TEST-EPIC-1' }, now);
    if (!result.ok) return;
    const html = renderHtml(result.value);
    expect(html).toContain('<!doctype html>');
    expect(html).not.toContain('http://'); // no external assets
    expect(html).not.toContain('https://');
    // The title is escaped, not injected raw.
    expect(html).toContain('A &amp; B &lt;auth&gt;');
    expect(html).not.toContain('<auth>');
  });
});
