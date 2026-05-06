import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '@/config/config-schema.js';
import { AdoptionService } from '@/services/adoption-service.js';

const config = ConfigSchema.parse({
  version: '1.0',
  mnema_version: '^0.1.0',
  project: { key: 'TEST', name: 'Test' },
  workflow: 'default',
});

describe('AdoptionService', () => {
  let projectRoot: string;
  let service: AdoptionService;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-adopt-'));
    service = new AdoptionService(projectRoot, config);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('installs skills with the canonical template files', () => {
    const result = service.adopt('skills');
    expect(result.created.length).toBeGreaterThanOrEqual(2);
    expect(result.skipped).toHaveLength(0);
    for (const expected of [
      'SKILL.md',
      'creating-tasks.md',
      'transitioning-tasks.md',
      'handling-blockers.md',
      'recording-decisions.md',
    ]) {
      expect(existsSync(path.join(projectRoot, 'skills', expected))).toBe(true);
    }
  });

  it('installs memory with INDEX, context and decisions/notes subfolders', () => {
    const result = service.adopt('memory');
    expect(result.created.length).toBe(4);
    expect(existsSync(path.join(projectRoot, 'memory', 'INDEX.md'))).toBe(true);
    expect(existsSync(path.join(projectRoot, 'memory', 'context.md'))).toBe(true);
    expect(existsSync(path.join(projectRoot, 'memory', 'decisions', 'INDEX.md'))).toBe(true);
    expect(existsSync(path.join(projectRoot, 'memory', 'notes', 'INDEX.md'))).toBe(true);
  });

  it('is idempotent: a second adopt skips already-existing files', () => {
    service.adopt('skills');
    const second = service.adopt('skills');
    expect(second.created).toHaveLength(0);
    expect(second.skipped.length).toBeGreaterThan(0);
  });

  it('does not overwrite custom content', () => {
    const file = path.join(projectRoot, 'skills', 'SKILL.md');
    mkdirSync(path.join(projectRoot, 'skills'), { recursive: true });
    writeFileSync(file, '# customised', 'utf-8');

    service.adopt('skills');
    expect(readFileSync(file, 'utf-8')).toBe('# customised');
  });

  it('adoptAll touches every component once', () => {
    const summary = service.adoptAll();
    expect(summary.results.map((r) => r.component)).toEqual(['skills', 'memory', 'roadmap']);
    expect(existsSync(path.join(projectRoot, 'skills', 'SKILL.md'))).toBe(true);
    expect(existsSync(path.join(projectRoot, 'memory', 'INDEX.md'))).toBe(true);
    expect(existsSync(path.join(projectRoot, 'roadmap', 'README.md'))).toBe(true);
  });
});
