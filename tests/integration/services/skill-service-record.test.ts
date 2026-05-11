import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActorKind } from '@/domain/enums/actor-kind.js';
import { AuditService } from '@/services/audit-service.js';
import { IdentityService } from '@/services/identity-service.js';
import { SkillService } from '@/services/skill-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { SkillRepository } from '@/storage/sqlite/repositories/skill-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

const KNOWN_TOOLS = new Set(['task_create', 'tasks_list']);

describe('SkillService (record/show/use)', () => {
  let tempRoot: string;
  let skillsDir: string;
  let adapter: SqliteAdapter;
  let service: SkillService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-skill-rec-'));
    skillsDir = path.join(tempRoot, '.mnema', 'skills');
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const audit = new AuditService(new AuditWriter(path.join(tempRoot, '.audit')));
    const repo = new SkillRepository(adapter);
    const identity = new IdentityService(new ActorRepository(adapter));
    identity.ensureActor('daniel', ActorKind.Human);

    service = new SkillService(skillsDir, KNOWN_TOOLS, repo, identity, audit);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('creates v1 when slug is unknown', () => {
    const result = service.record({
      slug: 'safe-migration',
      name: 'Safe migration rollout',
      description: 'How to roll a migration safely under load',
      content: '## Steps\n1. ...',
      actor: 'daniel',
    });
    expect(result.action).toBe('created');
    expect(result.skill.version).toBe(1);
    expect(existsSync(path.join(skillsDir, 'safe-migration.md'))).toBe(true);
  });

  it('updates in place when mode=update and content differs', () => {
    service.record({
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'A',
      actor: 'daniel',
    });
    const updated = service.record({
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'B',
      actor: 'daniel',
    });
    expect(updated.action).toBe('updated');
    expect(updated.skill.version).toBe(1);
    expect(updated.skill.content).toBe('B');
  });

  it('no-ops when content is byte-equal under mode=update', () => {
    service.record({
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'A',
      actor: 'daniel',
    });
    const again = service.record({
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'A',
      actor: 'daniel',
    });
    expect(again.action).toBe('no_op');
    expect(again.skill.version).toBe(1);
  });

  it('F-2: no_op does NOT advance updated_at', async () => {
    const first = service.record({
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'A',
      actor: 'daniel',
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const again = service.record({
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'A',
      actor: 'daniel',
    });
    expect(again.action).toBe('no_op');
    expect(again.skill.updatedAt).toBe(first.skill.updatedAt);
  });

  it('F-8: no_op regenerates the mirror when the file went missing', () => {
    const first = service.record({
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'A',
      actor: 'daniel',
    });
    const mirror = path.join(skillsDir, 's.md');
    expect(existsSync(mirror)).toBe(true);
    rmSync(mirror);

    const again = service.record({
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'A',
      actor: 'daniel',
    });
    expect(again.action).toBe('no_op');
    expect(again.skill.updatedAt).toBe(first.skill.updatedAt);
    expect(existsSync(mirror)).toBe(true);
  });

  it('bumps version when mode=new_version', () => {
    service.record({
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'A',
      actor: 'daniel',
    });
    const bumped = service.record({
      slug: 's',
      name: 'Skill v2',
      description: 'd',
      content: 'B',
      mode: 'new_version',
      actor: 'daniel',
    });
    expect(bumped.action).toBe('new_version');
    expect(bumped.skill.version).toBe(2);
    expect(service.listVersions('s')).toHaveLength(2);
  });

  it('records use, incrementing usage_count', () => {
    service.record({
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'A',
      actor: 'daniel',
    });
    const after = service.recordUse('s', 'daniel');
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.usageCount).toBe(1);
    expect(after.value.lastUsedAt).not.toBeNull();
  });

  it('show returns latest by default and a specific version when asked', () => {
    service.record({
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'A',
      actor: 'daniel',
    });
    service.record({
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'B',
      mode: 'new_version',
      actor: 'daniel',
    });
    const latest = service.show('s');
    expect(latest.ok).toBe(true);
    if (latest.ok) expect(latest.value.version).toBe(2);

    const v1 = service.show('s', 1);
    expect(v1.ok).toBe(true);
    if (v1.ok) expect(v1.value.content).toBe('A');
  });

  it('writes a mirror .md whose body matches the latest content', () => {
    service.record({
      slug: 's',
      name: 'Skill',
      description: 'desc',
      content: '## Hello world',
      actor: 'daniel',
    });
    const mirror = readFileSync(path.join(skillsDir, 's.md'), 'utf-8');
    expect(mirror).toContain('## Hello world');
    expect(mirror).toContain('name: Skill');
  });

  it('lint still works in lint-only mode (no record deps)', () => {
    writeFileSync(
      path.join(tempRoot, 'lint-only.md'),
      '---\nname: x\nversion: 1.0.0\ndescription: hello\ntools_used: []\n---\n## Example\nbody',
      'utf-8',
    );
    const lintOnly = new SkillService(tempRoot, KNOWN_TOOLS);
    const report = lintOnly.lint();
    expect(report.errorCount).toBe(0);
  });
});
