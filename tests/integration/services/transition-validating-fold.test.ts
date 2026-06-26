import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '@/config/config-schema.js';
import { ConfigSchema } from '@/config/config-schema.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

/**
 * Regression for the transition fold-validation guard: it must respect
 * `field_kind`. A `validating` numeric gate field is recorded in the audit
 * payload and NEVER folded onto its first-class column, so the guard must not
 * reject it against the column invariant. (A `mutating` field that WOULD fold
 * is still validated — covered by the create-path and numeric-validation tests.)
 */
const migrationsDir = path.resolve('src/storage/sqlite/migrations');

// A custom workflow where `priority` is a VALIDATING gate field on `finish`,
// with no bound — looser than the priority column's 1..5 invariant. The gate
// accepts priority:8; persistence must not fold it; the guard must not reject.
const CUSTOM_WORKFLOW = {
  schema_version: '1.0',
  name: 'custom-validating',
  description: 'test workflow with a validating numeric field',
  states: ['OPEN', 'DONE'],
  initial: 'OPEN',
  terminal: ['DONE'],
  transitions: {
    OPEN: {
      finish: {
        to: 'DONE',
        description: 'Finish and record an audit-only confidence score',
        use_when: 'Work complete; the score is audit-only, not a task field',
        requires: {
          priority: { type: 'number', field_kind: 'validating' },
        },
      },
      // `force` declares priority as MUTATING with no bound — the gate accepts
      // 8, but it WOULD fold onto the 1..5 column, so the guard must reject.
      force: {
        to: 'DONE',
        description: 'Force-close, folding the given priority onto the task',
        use_when: 'Administrative close that overwrites the task priority',
        requires: {
          priority: { type: 'number', field_kind: 'mutating' },
        },
      },
    },
  },
};

function makeConfig(): Config {
  return ConfigSchema.parse({
    version: '1.0',
    mnema_version: '^0.1.0',
    project: { key: 'TEST', name: 'Test' },
    workflow: 'custom-validating',
  });
}

describe('transition fold-validation respects field_kind', () => {
  let projectRoot: string;
  let container: ServiceContainer;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-validfold-'));
    for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
      const full = path.join(projectRoot, dir);
      if (!existsSync(full)) mkdirSync(full, { recursive: true });
    }
    writeFileSync(
      path.join(projectRoot, '.mnema/workflows', 'custom-validating.json'),
      JSON.stringify(CUSTOM_WORKFLOW),
    );
    container = createServiceContainer(makeConfig(), projectRoot, { migrationsDir });
  });

  afterEach(() => {
    container.close();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('accepts a validating priority that exceeds the column bound (it is never folded)', () => {
    const created = container.task.create({ projectKey: 'TEST', title: 'probe', actor: 'daniel' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const moved = container.task.transition({
      taskKey: created.value.key,
      action: 'finish',
      payload: { priority: 8 }, // accepted by the gate (no bound); audit-only
      actor: 'daniel',
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.state).toBe('DONE');
    // The column was NOT touched — it keeps the create-time default (3).
    expect(moved.value.priority).toBe(3);
  });

  it('rejects a MUTATING priority that exceeds the column bound (it would fold)', () => {
    const created = container.task.create({ projectKey: 'TEST', title: 'probe', actor: 'daniel' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const moved = container.task.transition({
      taskKey: created.value.key,
      action: 'force',
      payload: { priority: 8 }, // gate accepts it, but it folds onto the 1..5 column
      actor: 'daniel',
    });
    expect(moved.ok).toBe(false);
    if (moved.ok) return;
    expect(moved.error.kind).toBe(ErrorCode.ValidationFailed);
  });
});
