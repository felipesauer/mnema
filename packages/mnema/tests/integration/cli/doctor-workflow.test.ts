import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ActorKind } from '@mnema/core/domain/enums/actor-kind.js';
import type { Workflow } from '@mnema/core/domain/state-machine/state-machine.js';
import { MigrationRunner } from '@mnema/core/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@mnema/core/storage/sqlite/repositories/actor-repository.js';
import { ProjectRepository } from '@mnema/core/storage/sqlite/repositories/project-repository.js';
import { TaskRepository } from '@mnema/core/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@mnema/core/storage/sqlite/sqlite-adapter.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectTaskStateDrift, inspectWorkflowShape } from '@/cli/commands/doctor-command.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    name: 'test',
    description: null,
    states: ['DRAFT', 'READY', 'DONE'],
    initial: 'DRAFT',
    terminal: ['DONE'],
    features: {
      sprints: false,
      epics: false,
      reviewWorkflow: false,
      blockedState: false,
    },
    transitions: {
      DRAFT: {
        submit: {
          to: 'READY',
          description: 'submit',
          useWhen: 'when ready',
          requires: {} as unknown as Workflow['transitions'][string][string]['requires'],
          requiresSpec: {},
        },
      },
      READY: {
        complete: {
          to: 'DONE',
          description: 'complete',
          useWhen: 'when done',
          requires: {} as unknown as Workflow['transitions'][string][string]['requires'],
          requiresSpec: {},
        },
      },
    },
    ...overrides,
  };
}

describe('inspectWorkflowShape', () => {
  it('reports clean on a well-formed workflow', () => {
    const checks = inspectWorkflowShape(makeWorkflow());
    expect(checks.find((c) => c.name === 'workflow dead-end states')?.ok).toBe(true);
    expect(checks.find((c) => c.name === 'workflow unreachable states')?.ok).toBe(true);
  });

  it('flags a non-terminal state with no outbound transitions', () => {
    const checks = inspectWorkflowShape(
      makeWorkflow({
        states: ['DRAFT', 'STUCK', 'DONE'],
        transitions: {
          DRAFT: {
            park: {
              to: 'STUCK',
              description: 'park here',
              useWhen: 'when parking',
              requires: {} as unknown as Workflow['transitions'][string][string]['requires'],
              requiresSpec: {},
            },
          },
        },
      }),
    );
    const deadEnd = checks.find((c) => c.name === 'workflow dead-end states');
    expect(deadEnd?.ok).toBe(false);
    expect(deadEnd?.severity).toBe('warning');
    expect(deadEnd?.detail).toContain('STUCK');
  });

  it('flags a non-initial state with no inbound transitions', () => {
    const checks = inspectWorkflowShape(
      makeWorkflow({
        states: ['DRAFT', 'ORPHAN', 'DONE'],
        // DRAFT → DONE direct; ORPHAN is dangling.
        transitions: {
          DRAFT: {
            finish: {
              to: 'DONE',
              description: 'finish',
              useWhen: 'when done',
              requires: {} as unknown as Workflow['transitions'][string][string]['requires'],
              requiresSpec: {},
            },
          },
        },
      }),
    );
    const unreachable = checks.find((c) => c.name === 'workflow unreachable states');
    expect(unreachable?.ok).toBe(false);
    expect(unreachable?.severity).toBe('warning');
    expect(unreachable?.detail).toContain('ORPHAN');
  });
});

describe('inspectTaskStateDrift', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-task-drift-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    const actors = new ActorRepository(adapter);
    const projects = new ProjectRepository(adapter);
    const tasks = new TaskRepository(adapter);
    const project = projects.insert({ key: 'TEST', name: 'Test' });
    const reporterId = actors.upsert('daniel', ActorKind.Human);
    tasks.insert({ key: 'TEST-1', projectId: project.id, title: 'Live', reporterId });
    // Stuff a phantom state directly via SQL to simulate the
    // "workflow edit dropped a state" scenario.
    adapter.getDatabase().prepare(`UPDATE tasks SET state = 'PHANTOM' WHERE key = 'TEST-1'`).run();
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('flags tasks whose state is no longer declared by the workflow', () => {
    const checks = inspectTaskStateDrift(adapter, makeWorkflow());
    const drift = checks.find((c) => c.name === 'tasks states match workflow');
    expect(drift?.ok).toBe(false);
    expect(drift?.severity).toBe('error');
    expect(drift?.detail).toContain('PHANTOM');
  });

  it('reports clean when every task is in a declared state', () => {
    adapter.getDatabase().prepare(`UPDATE tasks SET state = 'DRAFT' WHERE key = 'TEST-1'`).run();
    const checks = inspectTaskStateDrift(adapter, makeWorkflow());
    const drift = checks.find((c) => c.name === 'tasks states match workflow');
    expect(drift?.ok).toBe(true);
  });
});
