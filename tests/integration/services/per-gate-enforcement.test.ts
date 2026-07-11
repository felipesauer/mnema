import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { Config } from '@/config/config-schema.js';
import { ConfigSchema } from '@/config/config-schema.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('workflows');

/** Build a config with an optional per-field severity map. */
function makeConfig(fieldSeverity: Record<string, 'off' | 'warn' | 'block'>): Config {
  return ConfigSchema.parse({
    version: '1.0',
    mnema_version: '^0.1.0',
    project: { key: 'TEST', name: 'Test' },
    workflow: 'default',
    enforcement_mode: 'blocking',
    enforcement_field_severity: fieldSeverity,
  });
}

describe('per-gate enforcement severity (MNEMA-243)', () => {
  let projectRoot: string;
  let container: ServiceContainer;

  function boot(fieldSeverity: Record<string, 'off' | 'warn' | 'block'>): void {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-pergate-'));
    for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
      const full = path.join(projectRoot, dir);
      if (!existsSync(full)) mkdirSync(full, { recursive: true });
    }
    copyFileSync(
      path.join(workflowsSrc, 'default.json'),
      path.join(projectRoot, '.mnema/workflows', 'default.json'),
    );
    container = createServiceContainer(makeConfig(fieldSeverity), projectRoot, { migrationsDir });
  }

  afterEach(() => {
    container.close();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('warn-only ceremony field proceeds while the block safety field still blocks', () => {
    // estimate = ceremony (warn), description missing = safety (global block).
    boot({ estimate: 'warn' });
    container.task.create({ projectKey: 'TEST', title: 'A task', actor: 'daniel' });

    // Missing description (blocks) AND a below-Fibonacci-shaped estimate would
    // both fail; description is a hard block, so the transition is refused —
    // proving a block field still bites even with a warn field present.
    const blocked = container.task.transition({
      taskKey: 'TEST-1',
      action: 'submit',
      payload: { title: 'A task', acceptance_criteria: ['ok'] }, // no description, no estimate
      actor: 'daniel',
      via: 'agent:cc',
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error.kind).toBe(ErrorCode.GateFailed);
    if (blocked.error.kind !== ErrorCode.GateFailed) return;
    // Only the block-resolved fields are reported; estimate (warn) is not.
    const missing = blocked.error.issues.map((i) => i.path[0]);
    expect(missing).toContain('description');
    expect(missing).not.toContain('estimate');
  });

  it('a transition with only a warn-field failing proceeds', () => {
    // estimate warn-only: supply everything BUT estimate → the sole failing
    // field is warn → the transition proceeds despite the global blocking mode.
    boot({ estimate: 'warn' });
    container.task.create({ projectKey: 'TEST', title: 'A task', actor: 'daniel' });

    const moved = container.task.transition({
      taskKey: 'TEST-1',
      action: 'submit',
      payload: {
        title: 'A task',
        description: 'a real description of the work',
        acceptance_criteria: ['ok'],
        // estimate omitted → its gate fails, but it is warn-only
      },
      actor: 'daniel',
      via: 'agent:cc',
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.state).toBe('READY');
  });

  it('empty field_severity reproduces the pure global blocking behaviour', () => {
    boot({});
    container.task.create({ projectKey: 'TEST', title: 'A task', actor: 'daniel' });
    // Missing estimate under global blocking (no per-field override) → blocked.
    const blocked = container.task.transition({
      taskKey: 'TEST-1',
      action: 'submit',
      payload: { title: 'A task', description: 'a real description', acceptance_criteria: ['ok'] },
      actor: 'daniel',
      via: 'agent:cc',
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error.kind).toBe(ErrorCode.GateFailed);
  });
});
