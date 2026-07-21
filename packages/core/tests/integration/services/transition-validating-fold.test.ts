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
const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

// A custom workflow where `estimate` is a VALIDATING gate field on `finish`,
// with no bound — looser than the estimate column's ≥0-integer invariant. The
// gate accepts estimate:-1; persistence must not fold it; the guard must not
// reject.
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
          estimate: { type: 'number', field_kind: 'validating' },
        },
      },
      // `force` declares estimate as MUTATING with no bound — the gate accepts
      // -1, but it WOULD fold onto the ≥0-integer column, so the guard must
      // reject.
      force: {
        to: 'DONE',
        description: 'Force-close, folding the given estimate onto the task',
        use_when: 'Administrative close that overwrites the task estimate',
        requires: {
          estimate: { type: 'number', field_kind: 'mutating' },
        },
      },
    },
  },
};

function makeConfig(): Config {
  return ConfigSchema.parse({
    version: '2.0',
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
      path.join(projectRoot, '.mnema/workflows', 'default.json'),
      JSON.stringify(CUSTOM_WORKFLOW),
    );
    container = createServiceContainer(makeConfig(), projectRoot, { migrationsDir });
  });

  afterEach(() => {
    container.close();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('accepts a validating estimate that violates the column bound (it is never folded)', () => {
    const created = container.task.create({ projectKey: 'TEST', title: 'probe', actor: 'daniel' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const moved = container.task.transition({
      taskKey: created.value.id,
      action: 'finish',
      payload: { estimate: -1 }, // accepted by the gate (no bound); audit-only
      actor: 'daniel',
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.state).toBe('DONE');
    // The column was NOT touched — it keeps its create-time value (unset/null).
    expect(moved.value.estimate).toBeNull();
  });

  it('rejects a MUTATING estimate that violates the column bound (it would fold)', () => {
    const created = container.task.create({ projectKey: 'TEST', title: 'probe', actor: 'daniel' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const moved = container.task.transition({
      taskKey: created.value.id,
      action: 'force',
      payload: { estimate: -1 }, // gate accepts it, but it folds onto the ≥0 column
      actor: 'daniel',
    });
    expect(moved.ok).toBe(false);
    if (moved.ok) return;
    expect(moved.error.kind).toBe(ErrorCode.ValidationFailed);
  });
});
