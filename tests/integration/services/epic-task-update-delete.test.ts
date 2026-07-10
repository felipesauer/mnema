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

describe('epic/task content edit + epic delete', () => {
  let projectRoot: string;
  let container: ServiceContainer;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-edit-svc-'));
    for (const dir of [
      '.mnema/state',
      '.mnema/audit',
      '.mnema/backlog',
      '.mnema/roadmap',
      '.mnema/workflows',
    ]) {
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

  const epicPath = (key: string): string => path.join(projectRoot, '.mnema/roadmap', `${key}.md`);

  it('edits an epic description and reflects it in the read + the .md mirror', () => {
    const created = container.epic.create({
      projectKey: 'TEST',
      title: 'Cart redesign',
      description: 'old text',
      actor: 'daniel',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = container.epic.update({
      epicKey: created.value.key,
      description: 'new text',
      actor: 'daniel',
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.description).toBe('new text');

    const readBack = container.epic.show(created.value.key);
    expect(readBack.ok).toBe(true);
    if (!readBack.ok) return;
    expect(readBack.value.epic.description).toBe('new text');

    const md = readFileSync(epicPath(created.value.key), 'utf-8');
    expect(md).toContain('new text');
    expect(md).not.toContain('old text');
  });

  it('edits a READY task title and reads it back changed', () => {
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Original title',
      actor: 'daniel',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const submitted = container.task.transition({
      taskKey: created.value.key,
      action: 'submit',
      payload: {
        description: 'a sufficiently long description',
        acceptance_criteria: ['works'],
        estimate: 3,
      },
      actor: 'daniel',
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect(submitted.value.state).toBe('READY');

    const updated = container.task.updateContent({
      taskKey: created.value.key,
      title: 'Corrected title',
      actor: 'daniel',
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.title).toBe('Corrected title');
    expect(updated.value.state).toBe('READY');

    const readBack = container.task.findByKey(created.value.key);
    expect(readBack.ok).toBe(true);
    if (!readBack.ok) return;
    expect(readBack.value.title).toBe('Corrected title');
  });

  it('refuses task_update on a terminal (CANCELED) task with a structured error', () => {
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Doomed task',
      actor: 'daniel',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const canceled = container.task.transition({
      taskKey: created.value.key,
      action: 'cancel',
      payload: { reason: 'not pursuing this' },
      actor: 'daniel',
    });
    expect(canceled.ok).toBe(true);
    if (!canceled.ok) return;
    expect(canceled.value.state).toBe('CANCELED');

    const updated = container.task.updateContent({
      taskKey: created.value.key,
      title: 'Too late',
      actor: 'daniel',
    });
    expect(updated.ok).toBe(false);
    if (updated.ok) return;
    expect(updated.error.kind).toBe(ErrorCode.TerminalState);
  });

  it('soft-deletes an epic: it vanishes from reads and its .md is gone', () => {
    const created = container.epic.create({
      projectKey: 'TEST',
      title: 'Throwaway epic',
      actor: 'daniel',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(existsSync(epicPath(created.value.key))).toBe(true);

    const deleted = container.epic.delete({
      epicKey: created.value.key,
      actor: 'daniel',
    });
    expect(deleted.ok).toBe(true);

    const show = container.epic.show(created.value.key);
    expect(show.ok).toBe(false);
    if (show.ok) return;
    expect(show.error.kind).toBe(ErrorCode.EpicNotFound);

    expect(container.epic.list('TEST').map((e) => e.key)).not.toContain(created.value.key);
    expect(existsSync(epicPath(created.value.key))).toBe(false);
  });

  it('refuses to delete an epic that still has an attached task', () => {
    const epic = container.epic.create({
      projectKey: 'TEST',
      title: 'Guarded epic',
      actor: 'daniel',
    });
    const task = container.task.create({
      projectKey: 'TEST',
      title: 'Attached task',
      actor: 'daniel',
    });
    expect(epic.ok && task.ok).toBe(true);
    if (!epic.ok || !task.ok) return;

    container.epic.addTask({
      epicKey: epic.value.key,
      taskKey: task.value.key,
      actor: 'daniel',
    });

    const deleted = container.epic.delete({
      epicKey: epic.value.key,
      actor: 'daniel',
    });
    expect(deleted.ok).toBe(false);
    if (deleted.ok) return;
    expect(deleted.error.kind).toBe(ErrorCode.EpicHasTasks);

    // The refusal leaves the epic and its mirror intact.
    expect(container.epic.show(epic.value.key).ok).toBe(true);
    expect(existsSync(epicPath(epic.value.key))).toBe(true);
  });

  it('leaves no live orphan when a crash interrupts delete between the two steps', () => {
    const created = container.epic.create({
      projectKey: 'TEST',
      title: 'Crash epic',
      actor: 'daniel',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const key = created.value.key;
    expect(existsSync(epicPath(key))).toBe(true);

    // Simulate a crash in the window between the two non-atomic steps: the
    // mirror unlink runs, then the process dies before the soft-delete
    // commits. With the mirror-first order this leaves a live row with a
    // missing `.md` (benign) — never a deleted row with a live `.md`, which a
    // rebuild would re-materialise as a live epic (the orphan this guards).
    const repo = container.epic as unknown as {
      epics: { softDelete: (id: string) => boolean };
    };
    const original = repo.epics.softDelete.bind(repo.epics);
    repo.epics.softDelete = () => {
      throw new Error('injected crash before soft-delete commit');
    };

    expect(() => container.epic.delete({ epicKey: key, actor: 'daniel' })).toThrow(
      /injected crash/,
    );
    repo.epics.softDelete = original;

    // The recoverable state is benign: the epic is still live and readable
    // (not a deleted row masquerading behind a stale mirror).
    const show = container.epic.show(key);
    expect(show.ok).toBe(true);

    // The mirror is gone, but rebuildMirrors heals it — self-healing.
    expect(existsSync(epicPath(key))).toBe(false);
    const rebuilt = container.epic.rebuildMirrors('TEST');
    expect(rebuilt).toContain(key);
    expect(existsSync(epicPath(key))).toBe(true);
  });
});
