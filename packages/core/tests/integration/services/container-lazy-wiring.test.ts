import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '@/config/config-schema.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('packages/core/workflows');

/**
 * The whole point of the sliced container: a session that touches one
 * domain must not pay for the constructors of the others. The wiring
 * diagnostics record exactly which pieces were built, in order.
 */
describe('service container lazy wiring', () => {
  let projectRoot: string;
  let container: ServiceContainer;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-lazy-'));
    mkdirSync(path.join(projectRoot, '.mnema/workflows'), { recursive: true });
    mkdirSync(path.join(projectRoot, '.mnema/state'), { recursive: true });
    copyFileSync(
      path.join(workflowsSrc, 'default.json'),
      path.join(projectRoot, '.mnema/workflows/default.json'),
    );
    const config = ConfigSchema.parse({
      version: '2.0',
      mnema_version: '^0.1.0',
      project: { key: 'LAZY', name: 'Lazy Wiring' },
      workflow: 'default',
    });
    container = createServiceContainer(config, projectRoot, {
      migrationsDir,
      userDir: null,
    });
  });

  afterEach(() => {
    container.close();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('builds nothing beyond the substrate at construction time', () => {
    expect(container.wiringDiagnostics()).toEqual([]);
  });

  it('an adapter-only read (search) never builds the audit or backlog lattices', () => {
    container.search.search('anything');
    const built = container.wiringDiagnostics();
    expect(built).toContain('search');
    expect(built).not.toContain('audit-core');
    expect(built).not.toContain('sync-core');
    expect(built).not.toContain('task');
  });

  it('touching the task service builds its chain (audit + sync) and nothing else', () => {
    void container.task;
    const built = container.wiringDiagnostics();
    expect(built).toContain('task');
    expect(built).toContain('audit-core');
    expect(built).toContain('sync-core');
    // None of the other ~40 services were constructed.
    expect(built).not.toContain('skill');
    expect(built).not.toContain('memory');
    expect(built).not.toContain('flowMetrics');
    expect(built).not.toContain('gitObserver');
    expect(built).not.toContain('snapshot');
    expect(built.length).toBeLessThanOrEqual(3);
  });

  it('memoises: repeated access constructs once', () => {
    void container.task;
    void container.task;
    const built = container.wiringDiagnostics();
    expect(built.filter((n) => n === 'task')).toHaveLength(1);
  });
});
