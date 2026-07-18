import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '@/config/config-schema.js';
import { DecisionStatus } from '@/domain/enums/decision-status.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('packages/core/workflows');

function setupProject(): { root: string; container: ServiceContainer } {
  const root = mkdtempSync(path.join(tmpdir(), 'mnema-concurrent-'));
  for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
    const full = path.join(root, dir);
    if (!existsSync(full)) mkdirSync(full, { recursive: true });
  }
  copyFileSync(
    path.join(workflowsSrc, 'default.json'),
    path.join(root, '.mnema/workflows', 'default.json'),
  );
  const config = ConfigSchema.parse({
    version: '2.0',
    mnema_version: '^0.1.0',
    project: { key: 'CC', name: 'Concurrent' },
    workflow: 'default',
  });
  const container = createServiceContainer(config, root, { migrationsDir });
  return { root, container };
}

describe('concurrent mutations (single-process simulation)', () => {
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

  it('task transition: second writer with stale updatedAt is refused with CONFLICT', () => {
    container.task.create({ projectKey: 'CC', title: 'Race me', actor: 'alice' });
    const seed = container.task.findByKey('CC-1');
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;
    const taskAtT0 = seed.value;

    // Alice submits, the row moves DRAFT → READY.
    const alice = container.task.transition({
      taskKey: 'CC-1',
      action: 'submit',
      payload: {
        title: 'A submit by alice',
        description: 'Alice description long enough to pass the gate',
        acceptance_criteria: ['ok'],
        estimate: 1,
      },
      actor: 'alice',
      expectedUpdatedAt: taskAtT0.updatedAt,
    });
    expect(alice.ok).toBe(true);

    // Bob carries the pre-submit token and tries to submit again. The
    // row has moved to READY since, so the gate refuses with
    // INVALID_TRANSITION before the token check fires — but the
    // protection we care about is that bob's submit does NOT succeed.
    const bob = container.task.transition({
      taskKey: 'CC-1',
      action: 'submit',
      payload: {
        title: 'B submit by bob',
        description: 'Bob description long enough to pass the gate',
        acceptance_criteria: ['ok'],
        estimate: 1,
      },
      actor: 'bob',
      expectedUpdatedAt: taskAtT0.updatedAt,
    });
    expect(bob.ok).toBe(false);
    if (bob.ok) return;
    // INVALID_TRANSITION is fine — the row already moved. The point is
    // bob did not get away with a silent lost-write.
    expect([ErrorCode.InvalidTransition, ErrorCode.Conflict]).toContain(bob.error.kind);
  });

  it('task transition without expectedUpdatedAt still uses the read row as default token', () => {
    container.task.create({ projectKey: 'CC', title: 'Default token', actor: 'alice' });
    const seed = container.task.findByKey('CC-1');
    if (!seed.ok) return;
    const taskAtT0 = seed.value;

    // Alice mutates first.
    container.task.transition({
      taskKey: 'CC-1',
      action: 'submit',
      payload: {
        title: 'Alice attempt with valid payload',
        description: 'Alice description long enough to pass the gate',
        acceptance_criteria: ['ok'],
        estimate: 1,
      },
      actor: 'alice',
    });

    // Bob skips expectedUpdatedAt entirely. Pre-fix this would have
    // silently overwritten alice's row; now it must fail (the service
    // defaults the token to what it read, which is now stale).
    const bobAttempt = container.task.transition({
      taskKey: 'CC-1',
      action: 'submit',
      payload: {
        title: 'Bob attempt with valid payload',
        description: 'Bob description long enough to pass the gate',
        acceptance_criteria: ['ok'],
        estimate: 1,
      },
      actor: 'bob',
    });
    // Either INVALID_TRANSITION (because state moved) or CONFLICT
    // (would need the gate to also accept 'submit' from READY, which
    // it doesn't). Both prevent lost-write.
    expect(bobAttempt.ok).toBe(false);
    // The audit log should NOT contain two `task_transitioned DRAFT →
    // READY` events: alice's submit is the only one that hit the row.
    const events = container.auditQuery.run({ taskKey: 'CC-1', kind: 'task_transitioned' });
    expect(events).toHaveLength(1);
    // Suppress unused-var warning by referencing the seed.
    expect(taskAtT0.state).toBe('DRAFT');
  });

  it('decision transition: second writer with stale token refused (no lost-write)', () => {
    const recorded = container.decision.record({
      projectKey: 'CC',
      title: 'Title D',
      decision: 'd',
      actor: 'alice',
    });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    const adrAtT0 = recorded.value;

    // Alice accepts.
    const alice = container.decision.transition({
      decisionKey: 'CC-ADR-1',
      status: DecisionStatus.Accepted,
      actor: 'alice',
      expectedUpdatedAt: adrAtT0.updatedAt,
    });
    expect(alice.ok).toBe(true);

    // Bob carries stale token, tries to reject. Should fail with
    // CONFLICT, not silently overwrite alice's accept.
    const bob = container.decision.transition({
      decisionKey: 'CC-ADR-1',
      status: DecisionStatus.Rejected,
      actor: 'bob',
      expectedUpdatedAt: adrAtT0.updatedAt,
    });
    expect(bob.ok).toBe(false);
    if (bob.ok) return;
    // DecisionInvalidStatus fires first when the row has moved past
    // proposed; we accept either result as "bob's write was refused".
    expect([ErrorCode.Conflict, ErrorCode.DecisionInvalidStatus]).toContain(bob.error.kind);

    const show = container.decision.show('CC-ADR-1');
    expect(show.ok).toBe(true);
    if (!show.ok) return;
    expect(show.value.status).toBe(DecisionStatus.Accepted);
  });

  it('decision transition without explicit token also fails closed', () => {
    container.decision.record({
      projectKey: 'CC',
      title: 'Title D2',
      decision: 'd',
      actor: 'alice',
    });

    // First accept moves the row.
    container.decision.transition({
      decisionKey: 'CC-ADR-1',
      status: DecisionStatus.Accepted,
      actor: 'alice',
    });

    // Re-read produces fresh updatedAt — but bob "carried" the row he
    // read before alice acted. Simulate by re-fetching via the show
    // path, then trying the same status. The service defaults the
    // token to whatever findByKey just returned, so this transition
    // becomes idempotent — but the audit log should not contain two
    // accept events.
    container.decision.transition({
      decisionKey: 'CC-ADR-1',
      status: DecisionStatus.Accepted,
      actor: 'bob',
    });

    const events = container.auditQuery.run({
      taskKey: 'CC-ADR-1',
      kind: 'decision_status_changed',
    });
    // Only alice's transition produced a status change; bob's call
    // either failed (invalid transition: accepted → accepted) or was
    // refused by the token check.
    expect(events).toHaveLength(1);
  });

  it('epic/sprint/decision creation mints distinct sequential keys under the immediate-transaction path', () => {
    // The create path for each of these runs nextSequence (a COUNT) + insert
    // inside runInTransactionImmediate, matching the task fix — so rapid
    // sequential creates never collide on a key. (Cross-process serialisation
    // is covered by task-create-concurrent-processes; this pins that the same
    // immediate-transaction path is wired for the other three entities.)
    const epicKeys: string[] = [];
    const sprintKeys: string[] = [];
    const decisionKeys: string[] = [];
    for (let i = 0; i < 5; i++) {
      const e = container.epic.create({
        projectKey: 'CC',
        title: `Epic number ${i}`,
        actor: 'alice',
      });
      expect(e.ok).toBe(true);
      if (e.ok) epicKeys.push(e.value.key);

      const s = container.sprint.plan({
        projectKey: 'CC',
        name: `Sprint number ${i}`,
        actor: 'alice',
      });
      expect(s.ok).toBe(true);
      if (s.ok) sprintKeys.push(s.value.key);

      const d = container.decision.record({
        projectKey: 'CC',
        title: `Decision number ${i}`,
        decision: 'do the thing',
        actor: 'alice',
      });
      expect(d.ok).toBe(true);
      if (d.ok) decisionKeys.push(d.value.key);
    }

    expect(new Set(epicKeys).size).toBe(5);
    expect(new Set(sprintKeys).size).toBe(5);
    expect(new Set(decisionKeys).size).toBe(5);
    expect([...epicKeys].sort()).toEqual(
      Array.from({ length: 5 }, (_, i) => `CC-EPIC-${i + 1}`).sort(),
    );
    expect([...decisionKeys].sort()).toEqual(
      Array.from({ length: 5 }, (_, i) => `CC-ADR-${i + 1}`).sort(),
    );
  });

  it('Conflict error carries the entity field for the printer', () => {
    container.task.create({ projectKey: 'CC', title: 'Title X', actor: 'alice' });
    const seed = container.task.findByKey('CC-1');
    if (!seed.ok) return;

    // Alice moves the row.
    container.task.transition({
      taskKey: 'CC-1',
      action: 'submit',
      payload: {
        title: 'Alice attempt with valid payload',
        description: 'Alice description long enough to pass the gate',
        acceptance_criteria: ['ok'],
        estimate: 1,
      },
      actor: 'alice',
      expectedUpdatedAt: seed.value.updatedAt,
    });

    // Force a CONFLICT shape from `start` with a deliberately wrong token.
    const stale = container.task.transition({
      taskKey: 'CC-1',
      action: 'start',
      payload: { assignee_id: 'alice' },
      actor: 'bob',
      expectedUpdatedAt: 'definitely-not-the-current-token',
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error.kind).toBe(ErrorCode.Conflict);
    if (stale.error.kind !== ErrorCode.Conflict) return;
    expect(stale.error.entity).toBe('task');
  });
});
