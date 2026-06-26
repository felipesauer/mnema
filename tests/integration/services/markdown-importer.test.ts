import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '@/config/config-schema.js';
import { MarkdownImporter } from '@/services/importers/markdown-importer.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('workflows');

function setupProject(): { root: string; container: ServiceContainer } {
  const root = mkdtempSync(path.join(tmpdir(), 'mnema-md-importer-'));
  for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  copyFileSync(
    path.join(workflowsSrc, 'default.json'),
    path.join(root, '.mnema/workflows', 'default.json'),
  );
  const config = ConfigSchema.parse({
    version: '1.0',
    mnema_version: '^0.1.0',
    project: { key: 'TEST', name: 'Test' },
    workflow: 'default',
  });
  const container = createServiceContainer(config, root, { migrationsDir });
  return { root, container };
}

describe('MarkdownImporter (integration)', () => {
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

  it('creates one task per heading and reports counts', () => {
    const sourcePath = path.join(root, 'TODO.md');
    writeFileSync(
      sourcePath,
      [
        '## DRAFT Implement OAuth',
        '',
        'Description.',
        '',
        '- AC 1',
        '- AC 2',
        '',
        '## DRAFT Refactor session middleware',
        '',
        'Another desc.',
      ].join('\n'),
      'utf-8',
    );

    const importer = new MarkdownImporter(container.task, 'TEST', 'daniel');
    const result = importer.import(sourcePath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tasksCreated).toBe(2);
    expect(result.value.filesScanned).toBe(1);
    expect(container.task.list().map((t) => t.title)).toEqual([
      'DRAFT Implement OAuth',
      'DRAFT Refactor session middleware',
    ]);
  });

  it('walks directories non-recursively by default', () => {
    const dir = path.join(root, 'planning');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'a.md'), '## DRAFT One\n', 'utf-8');
    writeFileSync(path.join(dir, 'b.md'), '## DRAFT Two\n', 'utf-8');

    const importer = new MarkdownImporter(container.task, 'TEST', 'daniel');
    const result = importer.import(dir);
    expect(result.ok && result.value.tasksCreated).toBe(2);
  });

  it('returns ATTACHMENT_SOURCE_NOT_FOUND for unknown sources', () => {
    const importer = new MarkdownImporter(container.task, 'TEST', 'daniel');
    const result = importer.import(path.join(root, 'missing.md'));
    expect(result.ok).toBe(false);
  });

  it('skips headings already present when `skipExisting` is set', () => {
    const sourcePath = path.join(root, 'TODO.md');
    writeFileSync(
      sourcePath,
      ['## DRAFT Implement OAuth', '', 'Description.', '', '## Refactor middleware', ''].join('\n'),
      'utf-8',
    );
    const importer = new MarkdownImporter(container.task, 'TEST', 'daniel');

    const first = importer.import(sourcePath);
    expect(first.ok && first.value.tasksCreated).toBe(2);

    const second = importer.import(sourcePath, { skipExisting: true });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.tasksCreated).toBe(0);
    expect(second.value.tasksSkippedExisting).toBe(2);
    expect(container.task.list()).toHaveLength(2);
  });
});
