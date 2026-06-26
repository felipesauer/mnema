import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { Config } from '@/config/config-schema.js';
import { ConfigSchema } from '@/config/config-schema.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { AuditQuery } from '@/services/audit-query.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

/**
 * `enforcement_mode` decides what a failed workflow gate means:
 *  - blocking — always blocks
 *  - strict   — blocks an agent (via present), a human may override
 *  - advisory — anyone may override; only a warning
 *
 * The `default` workflow's `submit` (DRAFT→READY) requires
 * description + acceptance_criteria + estimate, so submitting a
 * title-only DRAFT with an empty payload always trips the gate.
 */
const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('workflows');

function makeConfig(mode: 'advisory' | 'strict' | 'blocking'): Config {
  return ConfigSchema.parse({
    version: '1.0',
    mnema_version: '^0.1.0',
    project: { key: 'TEST', name: 'Test' },
    workflow: 'default',
    enforcement_mode: mode,
  });
}

describe('enforcement_mode on a failed gate', () => {
  let projectRoot: string;
  let container: ServiceContainer;

  function boot(mode: 'advisory' | 'strict' | 'blocking') {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-enforce-'));
    for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
      mkdirSync(path.join(projectRoot, dir), { recursive: true });
    }
    copyFileSync(
      path.join(workflowsSrc, 'default.json'),
      path.join(projectRoot, '.mnema/workflows', 'default.json'),
    );
    container = createServiceContainer(makeConfig(mode), projectRoot, { migrationsDir });
  }

  /** Creates a title-only DRAFT — its submit gate will fail. */
  function draftKey(): string {
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Bare draft',
      actor: 'daniel',
    });
    if (!created.ok) throw new Error('setup: create failed');
    return created.value.key;
  }

  /** Submits with an empty payload (gate fails); `agent` toggles the `via` field. */
  function submit(key: string, agent: boolean) {
    return container.task.transition({
      taskKey: key,
      action: 'submit',
      payload: {},
      actor: 'daniel',
      via: agent ? 'agent:test' : undefined,
    });
  }

  function auditKinds(): string[] {
    const events = new AuditQuery(path.join(projectRoot, '.mnema/audit')).run({});
    return events.map((e) => e.kind);
  }

  afterEach(() => {
    container.close();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('blocking: blocks even a human, and audits the block', () => {
    boot('blocking');
    const key = draftKey();
    const result = submit(key, false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe(ErrorCode.GateFailed);
    expect(auditKinds()).toContain('transition_blocked');
    // The task did not move.
    const after = container.task.findByKey(key);
    if (after.ok) expect(after.value.state).toBe('DRAFT');
  });

  it('strict: blocks an agent', () => {
    boot('strict');
    const key = draftKey();
    const result = submit(key, true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe(ErrorCode.GateFailed);
    expect(auditKinds()).toContain('transition_blocked');
  });

  it('strict: lets a human override, and audits the override', () => {
    boot('strict');
    const key = draftKey();
    const result = submit(key, false);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.state).toBe('READY');
    expect(auditKinds()).toContain('gate_overridden');
  });

  it('advisory: lets an agent through, and audits the override', () => {
    boot('advisory');
    const key = draftKey();
    const result = submit(key, true);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.state).toBe('READY');
    expect(auditKinds()).toContain('gate_overridden');
  });

  it('a complete payload passes regardless of mode (no override event)', () => {
    boot('strict');
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Complete draft',
      description: 'A description longer than ten chars',
      acceptanceCriteria: ['works'],
      estimate: 3,
      actor: 'daniel',
    });
    if (!created.ok) throw new Error('setup');
    const moved = container.task.transition({
      taskKey: created.value.key,
      action: 'submit',
      payload: {},
      actor: 'daniel',
      via: 'agent:test',
    });
    expect(moved.ok).toBe(true);
    expect(auditKinds()).not.toContain('gate_overridden');
    expect(auditKinds()).not.toContain('transition_blocked');
  });

  it('an unknown action is always rejected, even in advisory', () => {
    boot('advisory');
    const key = draftKey();
    const result = container.task.transition({
      taskKey: key,
      action: 'no_such_action',
      payload: {},
      actor: 'daniel',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe(ErrorCode.InvalidTransition);
  });
});
