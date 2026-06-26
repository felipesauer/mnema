import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '@/config/config-schema.js';
import { ConfigSchema } from '@/config/config-schema.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

/**
 * Regression coverage for the producer/consumer validation asymmetry: the CLI
 * coerced numeric flags with bare `Number(...)`, so values the MCP layer
 * rejects (NaN, negative, float) were silently persisted or crashed with a raw
 * SQLite error. The service is now the shared gate — these assert it rejects
 * with a structured `Result.Err` regardless of entry point.
 */
const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('workflows');

function makeConfig(): Config {
  return ConfigSchema.parse({
    version: '1.0',
    mnema_version: '^0.1.0',
    project: { key: 'TEST', name: 'Test' },
    workflow: 'default',
  });
}

describe('service-level numeric validation', () => {
  let projectRoot: string;
  let container: ServiceContainer;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-numval-'));
    for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
      const full = path.join(projectRoot, dir);
      if (!existsSync(full)) mkdirSync(full, { recursive: true });
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

  describe('task.create', () => {
    it('rejects a negative context_budget', () => {
      const r = container.task.create({
        projectKey: 'TEST',
        title: 'X',
        contextBudget: -10,
        actor: 'daniel',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe(ErrorCode.ValidationFailed);
    });

    it('rejects a non-integer (float) context_budget', () => {
      const r = container.task.create({
        projectKey: 'TEST',
        title: 'X',
        contextBudget: 3.7,
        actor: 'daniel',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe(ErrorCode.ValidationFailed);
    });

    it('rejects NaN context_budget (the silent-NULL case)', () => {
      const r = container.task.create({
        projectKey: 'TEST',
        title: 'X',
        contextBudget: Number('abc'),
        actor: 'daniel',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe(ErrorCode.ValidationFailed);
    });

    it('rejects priority out of the 1..5 range', () => {
      const r = container.task.create({
        projectKey: 'TEST',
        title: 'X',
        priority: 99,
        actor: 'daniel',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe(ErrorCode.ValidationFailed);
    });

    it('rejects a NaN priority instead of crashing on NOT NULL', () => {
      const r = container.task.create({
        projectKey: 'TEST',
        title: 'X',
        priority: Number('abc'),
        actor: 'daniel',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe(ErrorCode.ValidationFailed);
    });

    it('still accepts valid values (0 budget is distinct from unset)', () => {
      const r = container.task.create({
        projectKey: 'TEST',
        title: 'X',
        contextBudget: 0,
        estimate: 5,
        priority: 2,
        actor: 'daniel',
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.contextBudget).toBe(0);
        expect(r.value.estimate).toBe(5);
        expect(r.value.priority).toBe(2);
      }
    });
  });

  describe('sprint.addMetric', () => {
    beforeEach(() => {
      container.sprint.plan({ projectKey: 'TEST', name: 'S1', actor: 'daniel' });
    });

    it('rejects a non-finite target instead of crashing on NOT NULL', () => {
      const r = container.sprint.addMetric({
        sprintKey: 'TEST-SPRINT-1',
        name: 'p95',
        target: Number('abc'),
        actor: 'daniel',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe(ErrorCode.ValidationFailed);
    });

    it('rejects a non-finite baseline rather than silently storing NULL', () => {
      const r = container.sprint.addMetric({
        sprintKey: 'TEST-SPRINT-1',
        name: 'p95',
        target: 100,
        baseline: Number('xyz'),
        actor: 'daniel',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe(ErrorCode.ValidationFailed);
    });

    it('accepts a valid metric', () => {
      const r = container.sprint.addMetric({
        sprintKey: 'TEST-SPRINT-1',
        name: 'p95',
        target: 100,
        baseline: 250,
        unit: 'ms',
        actor: 'daniel',
      });
      expect(r.ok).toBe(true);
    });
  });

  describe('taskEvidence.attach', () => {
    let taskKey: string;
    beforeEach(() => {
      const t = container.task.create({
        projectKey: 'TEST',
        title: 'X',
        acceptanceCriteria: ['a', 'b'],
        actor: 'daniel',
      });
      if (!t.ok) throw new Error('setup task create failed');
      taskKey = t.value.key;
    });

    it('rejects a non-integer (0.5) criterion index — no orphan REAL row', () => {
      const r = container.taskEvidence.attach({
        taskKey,
        criterionIndex: 0.5,
        ref: 'x',
        actor: 'daniel',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe(ErrorCode.EvidenceCriterionOutOfRange);
      // The slot must remain free: a valid attach at index 0 still works.
      const ok = container.taskEvidence.attach({
        taskKey,
        criterionIndex: 0,
        ref: 'x',
        actor: 'daniel',
      });
      expect(ok.ok).toBe(true);
    });

    it('rejects a NaN criterion index instead of crashing on NOT NULL', () => {
      const r = container.taskEvidence.attach({
        taskKey,
        criterionIndex: Number('abc'),
        ref: 'x',
        actor: 'daniel',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe(ErrorCode.EvidenceCriterionOutOfRange);
    });

    it('rejects an invalid evidence kind instead of a raw CHECK-constraint crash', () => {
      const r = container.taskEvidence.attach({
        taskKey,
        criterionIndex: 0,
        // biome-ignore lint/suspicious/noExplicitAny: deliberately bad input
        kind: 'screenshot' as any,
        ref: 'x',
        actor: 'daniel',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe(ErrorCode.ValidationFailed);
    });
  });
});
