import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '@/config/config-schema.js';
import { ConfigSchema } from '@/config/config-schema.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

/**
 * Regression for report item #7: a gate validates the task's *resulting*
 * state, so fields already persisted satisfy `requires` without being
 * resent, and omitting one never overwrites the stored value.
 *
 * The `default` workflow's `submit` (DRAFT→READY) requires
 * title + description + acceptance_criteria + estimate.
 */
const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('packages/core/workflows');

function makeConfig(): Config {
  return ConfigSchema.parse({
    version: '2.0',
    mnema_version: '^0.1.0',
    project: { key: 'TEST', name: 'Test' },
    workflow: 'default',
  });
}

describe('transition tolerates already-persisted gate fields', () => {
  let projectRoot: string;
  let container: ServiceContainer;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-persisted-'));
    for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
      mkdirSync(path.join(projectRoot, dir), { recursive: true });
    }
    copyFileSync(
      path.join(workflowsSrc, 'default.json'),
      path.join(projectRoot, '.mnema/workflows', 'default.json'),
    );
    container = createServiceContainer(makeConfig(), projectRoot, { migrationsDir });
  });

  afterEach(() => {
    container.close();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  /** Creates a DRAFT task already complete enough to submit. */
  function createComplete() {
    return container.task.create({
      projectKey: 'TEST',
      title: 'Complete draft',
      description: 'A rich description worth more than ten characters',
      acceptanceCriteria: ['it works'],
      estimate: 5,
      actor: 'daniel',
    });
  }

  it('submits with an empty payload when the fields are already stored', () => {
    const created = createComplete();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // No fields resent — the gate is satisfied by the persisted values.
    const moved = container.task.transition({
      taskKey: created.value.key,
      action: 'submit',
      payload: {},
      actor: 'daniel',
    });
    expect(moved.ok).toBe(true);
    if (moved.ok) expect(moved.value.state).toBe('READY');
  });

  it('does not erase the stored description when it is omitted', () => {
    const created = createComplete();
    if (!created.ok) return;
    const rich = created.value.description;

    container.task.transition({
      taskKey: created.value.key,
      action: 'submit',
      payload: {},
      actor: 'daniel',
    });

    const after = container.task.findByKey(created.value.key);
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.value.description).toBe(rich);
  });

  it('still rejects submit when a required field was never provided', () => {
    // Only a title — description/AC/estimate are missing from both the
    // task and the payload, so the gate must fail.
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Bare draft',
      actor: 'daniel',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const moved = container.task.transition({
      taskKey: created.value.key,
      action: 'submit',
      payload: {},
      actor: 'daniel',
      // As an agent under the default `strict` mode, a missing required
      // field is blocked (a human could override; an agent cannot).
      via: 'agent:test',
    });
    expect(moved.ok).toBe(false);
  });

  it('an explicit payload value still wins over the stored one', () => {
    const created = createComplete();
    if (!created.ok) return;

    container.task.transition({
      taskKey: created.value.key,
      action: 'submit',
      payload: { description: 'An explicitly updated, sufficiently long description' },
      actor: 'daniel',
    });

    const after = container.task.findByKey(created.value.key);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.value.description).toBe('An explicitly updated, sufficiently long description');
    }
  });
});
