import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '@/config/config-schema.js';
import { ConfigSchema } from '@/config/config-schema.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

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

describe('TaskService (integration)', () => {
  let projectRoot: string;
  let container: ServiceContainer;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-task-svc-'));

    for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
      const full = path.join(projectRoot, dir);
      if (!existsSync(full)) {
        mkdirSync(full, { recursive: true });
      }
    }
    copyFileSync(
      path.join(workflowsSrc, 'default.json'),
      path.join(projectRoot, '.mnema/workflows', 'default.json'),
    );

    container = createServiceContainer(makeConfig(), projectRoot, { migrationsDir });

    // Seed a project row so TaskService.create has somewhere to attach.
    container.adapter
      .getDatabase()
      .prepare("INSERT INTO projects (id, key, name) VALUES ('p1', 'TEST', 'Test')")
      .run();
  });

  afterEach(() => {
    container.close();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('creates a task in the workflow initial state', () => {
    const result = container.task.create({
      projectKey: 'TEST',
      title: 'First task',
      actor: 'daniel',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.key).toBe('TEST-1');
    expect(result.value.state).toBe('DRAFT');
    expect(container.task.list()).toHaveLength(1);
  });

  it('writes the task markdown on the filesystem after creation', () => {
    container.task.create({ projectKey: 'TEST', title: 'A', actor: 'daniel' });

    const file = path.join(projectRoot, '.mnema/backlog', 'DRAFT', 'TEST-1.md');
    expect(existsSync(file)).toBe(true);
    const content = readFileSync(file, 'utf-8');
    expect(content).toContain('TEST-1');
    expect(content).toContain('DRAFT');
  });

  it('appends an audit event for task_created', () => {
    container.task.create({ projectKey: 'TEST', title: 'A', actor: 'daniel' });

    const auditFile = path.join(projectRoot, '.mnema/audit', 'current.jsonl');
    expect(existsSync(auditFile)).toBe(true);
    const content = readFileSync(auditFile, 'utf-8').trim();
    expect(content.length).toBeGreaterThan(0);

    const event = JSON.parse(content) as { kind: string; actor: string };
    expect(event.kind).toBe('task_created');
    expect(event.actor).toBe('daniel');
  });

  describe('transition', () => {
    it('moves a task through a valid action and persists the new state', () => {
      const created = container.task.create({
        projectKey: 'TEST',
        title: 'Implement OAuth',
        actor: 'daniel',
      });
      expect(created.ok).toBe(true);

      const moved = container.task.transition({
        taskKey: 'TEST-1',
        action: 'submit',
        payload: {
          title: 'Implement OAuth login flow',
          description: 'Add Google OAuth support to the login page.',
          acceptance_criteria: ['Users can authenticate'],
          estimate: 5,
        },
        actor: 'daniel',
      });

      expect(moved.ok).toBe(true);
      if (!moved.ok) return;
      expect(moved.value.state).toBe('READY');
    });

    it('moves the markdown file when state changes', () => {
      container.task.create({ projectKey: 'TEST', title: 'Move me', actor: 'daniel' });

      container.task.transition({
        taskKey: 'TEST-1',
        action: 'submit',
        payload: {
          title: 'Move me to ready',
          description: 'A task that gets submitted.',
          acceptance_criteria: ['Done'],
          estimate: 3,
        },
        actor: 'daniel',
      });

      const draftFile = path.join(projectRoot, '.mnema/backlog', 'DRAFT', 'TEST-1.md');
      const readyFile = path.join(projectRoot, '.mnema/backlog', 'READY', 'TEST-1.md');
      expect(existsSync(draftFile)).toBe(false);
      expect(existsSync(readyFile)).toBe(true);
    });

    it('returns InvalidTransition when the action is not allowed', () => {
      container.task.create({ projectKey: 'TEST', title: 'X', actor: 'daniel' });

      const result = container.task.transition({
        taskKey: 'TEST-1',
        action: 'approve',
        payload: { approval_note: 'lgtm' },
        actor: 'daniel',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe(ErrorCode.InvalidTransition);
    });

    it('returns GateFailed when the payload misses required fields', () => {
      container.task.create({ projectKey: 'TEST', title: 'X', actor: 'daniel' });

      const result = container.task.transition({
        taskKey: 'TEST-1',
        action: 'submit',
        payload: { title: 'X' },
        actor: 'daniel',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe(ErrorCode.GateFailed);
    });

    it('returns TaskNotFound for an unknown key', () => {
      const result = container.task.transition({
        taskKey: 'GHOST-1',
        action: 'submit',
        payload: {},
        actor: 'daniel',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe(ErrorCode.TaskNotFound);
    });
  });

  describe('soft delete', () => {
    it('soft-deletes a task, removing it from list() and the markdown', () => {
      container.task.create({ projectKey: 'TEST', title: 'A', actor: 'daniel' });
      const md = path.join(projectRoot, '.mnema/backlog', 'DRAFT', 'TEST-1.md');
      expect(existsSync(md)).toBe(true);

      const deleted = container.task.softDelete({ taskKey: 'TEST-1', actor: 'daniel' });
      expect(deleted.ok).toBe(true);
      if (!deleted.ok) return;
      expect(deleted.value.deletedAt).not.toBeNull();
      expect(container.task.list()).toHaveLength(0);
      expect(existsSync(md)).toBe(false);
    });

    it('restores a soft-deleted task and brings the markdown back', () => {
      container.task.create({ projectKey: 'TEST', title: 'A', actor: 'daniel' });
      container.task.softDelete({ taskKey: 'TEST-1', actor: 'daniel' });

      const restored = container.task.restore({ taskKey: 'TEST-1', actor: 'daniel' });
      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      expect(restored.value.deletedAt).toBeNull();
      expect(container.task.list().map((t) => t.key)).toEqual(['TEST-1']);
      const md = path.join(projectRoot, '.mnema/backlog', 'DRAFT', 'TEST-1.md');
      expect(existsSync(md)).toBe(true);
    });

    it('softDelete on a deleted task returns TASK_NOT_FOUND', () => {
      container.task.create({ projectKey: 'TEST', title: 'A', actor: 'daniel' });
      container.task.softDelete({ taskKey: 'TEST-1', actor: 'daniel' });

      const second = container.task.softDelete({ taskKey: 'TEST-1', actor: 'daniel' });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.kind).toBe(ErrorCode.TaskNotFound);
    });

    it('restore on an unknown key returns TASK_NOT_FOUND', () => {
      const result = container.task.restore({ taskKey: 'GHOST-1', actor: 'daniel' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe(ErrorCode.TaskNotFound);
    });
  });
});
