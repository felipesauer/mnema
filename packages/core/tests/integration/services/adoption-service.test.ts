import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '@/config/config-schema.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { IdentityService } from '@/services/integrity/identity-service.js';
import { AdoptionService } from '@/services/knowledge/adoption-service.js';
import { SkillService } from '@/services/knowledge/skill-service.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { SkillRepository } from '@/storage/sqlite/repositories/skill-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';
import { chainedAuditWriter } from '../../setup/audit-writer.js';

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

  it('installs skills: SKILL.md index at root, seed skills under default/ (ADR-51)', () => {
    const result = service.adopt('skills');
    expect(result.created.length).toBeGreaterThanOrEqual(2);
    expect(result.skipped).toHaveLength(0);
    // The catalogue index stays at the root.
    expect(existsSync(path.join(projectRoot, '.mnema/skills', 'SKILL.md'))).toBe(true);
    // The tool-shipped seeds land under default/.
    for (const expected of [
      'creating-tasks.md',
      'transitioning-tasks.md',
      'handling-blockers.md',
      'recording-decisions.md',
      'report-issue.md',
    ]) {
      expect(existsSync(path.join(projectRoot, '.mnema/skills', 'default', expected))).toBe(true);
    }
    // ...and NOT flat at the skills root.
    expect(existsSync(path.join(projectRoot, '.mnema/skills', 'creating-tasks.md'))).toBe(false);
  });

  it('installs memory with INDEX, context and decisions/notes subfolders', () => {
    const result = service.adopt('memory');
    expect(result.created.length).toBe(4);
    expect(existsSync(path.join(projectRoot, '.mnema/memory', 'INDEX.md'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.mnema/memory', 'context.md'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.mnema/memory', 'decisions', 'INDEX.md'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.mnema/memory', 'notes', 'INDEX.md'))).toBe(true);
  });

  it('is idempotent: a second adopt skips already-existing files', () => {
    service.adopt('skills');
    const second = service.adopt('skills');
    expect(second.created).toHaveLength(0);
    expect(second.skipped.length).toBeGreaterThan(0);
  });

  it('does not overwrite custom content', () => {
    const file = path.join(projectRoot, '.mnema/skills', 'SKILL.md');
    mkdirSync(path.join(projectRoot, '.mnema/skills'), { recursive: true });
    writeFileSync(file, '# customised', 'utf-8');

    service.adopt('skills');
    expect(readFileSync(file, 'utf-8')).toBe('# customised');
  });

  it('adopt-installed skills become first-class rows via importSeeds (not orphans)', () => {
    // Regression: `adopt skills` writes files only; without recording them as
    // rows they read as orphan mirrors that `mnema upgrade` prunes. The CLI
    // adopt path now runs the same importSeeds('system') step as init — this
    // asserts the mechanism it leans on: adopted files → rows.
    service.adopt('skills');

    const dbPath = path.join(projectRoot, 'state.db');
    const adapter = new SqliteAdapter(dbPath);
    try {
      new MigrationRunner().run(
        adapter,
        path.resolve('packages/core/src/storage/sqlite/migrations'),
      );
      const repo = new SkillRepository(adapter);
      const identity = new IdentityService(new ActorRepository(adapter));
      const audit = new AuditService(
        chainedAuditWriter(adapter, path.join(projectRoot, '.mnema/audit')),
      );
      const skills = new SkillService(
        path.join(projectRoot, '.mnema/skills'),
        new Set(),
        repo,
        identity,
        audit,
      );

      const imported = skills.importSeeds('system');
      // The 5 real skills, never the SKILL.md index.
      expect(imported.sort()).toEqual(
        [
          'creating-tasks',
          'handling-blockers',
          'recording-decisions',
          'report-issue',
          'transitioning-tasks',
        ].sort(),
      );
      expect(imported).not.toContain('SKILL');

      const rows = repo.listLatest().map((s) => s.slug);
      expect(rows).toContain('creating-tasks');
      expect(rows).not.toContain('SKILL');

      // Idempotent: a second import creates no duplicate versions.
      const again = skills.importSeeds('system');
      expect(again.sort()).toEqual(imported.sort());
    } finally {
      adapter.close();
    }
  });

  it('adoptAll touches every component once', () => {
    const summary = service.adoptAll();
    expect(summary.results.map((r) => r.component)).toEqual([
      'skills',
      'memory',
      'roadmap',
      'commands',
      'templates',
    ]);
    expect(existsSync(path.join(projectRoot, '.mnema/skills', 'SKILL.md'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.mnema/memory', 'INDEX.md'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.mnema/roadmap', 'README.md'))).toBe(true);
  });
});
