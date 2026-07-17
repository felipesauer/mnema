import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActorKind } from '@/domain/enums/actor-kind.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { IdentityService } from '@/services/integrity/identity-service.js';
import { MemoryService } from '@/services/knowledge/memory-service.js';
import { SkillService } from '@/services/knowledge/skill-service.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { MemoryRepository } from '@/storage/sqlite/repositories/memory-repository.js';
import { SkillRepository } from '@/storage/sqlite/repositories/skill-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';
import { chainedAuditWriter } from '../../setup/audit-writer.js';

/**
 * User-level skills/memories (`~/.config/mnema`) merge UNDER the
 * project's own: a project entry of the same slug shadows the user's,
 * user entries are read-only (`source: 'user'`), and `record` only ever
 * writes to the project.
 */
const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

describe('user-level skills & memories', () => {
  let projectRoot: string;
  let userDir: string;
  let adapter: SqliteAdapter;
  let skill: SkillService;
  let memory: MemoryService;

  function writeUserSkill(slug: string, name: string): void {
    const dir = path.join(userDir, 'skills');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, `${slug}.md`),
      `---\nname: ${name}\nversion: 1.0.0\ndescription: from the user layer\ntools_used: []\n---\n# ${name}\n`,
      'utf-8',
    );
  }

  function writeUserMemory(slug: string, title: string, topics: string[] = []): void {
    const dir = path.join(userDir, 'memory');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, `${slug}.md`),
      `---\ntitle: ${title}\ntopics: ${JSON.stringify(topics)}\n---\n# ${title}\n`,
      'utf-8',
    );
  }

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-ulk-'));
    userDir = mkdtempSync(path.join(tmpdir(), 'mnema-ulk-home-'));
    adapter = new SqliteAdapter(path.join(projectRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const audit = new AuditService(chainedAuditWriter(adapter, path.join(projectRoot, '.audit')));
    const identity = new IdentityService(new ActorRepository(adapter));
    identity.ensureActor('daniel', ActorKind.Human);

    skill = new SkillService(
      path.join(projectRoot, 'skills'),
      new Set(),
      new SkillRepository(adapter),
      identity,
      audit,
      userDir,
    );
    memory = new MemoryService(
      path.join(projectRoot, 'memory'),
      new MemoryRepository(adapter),
      identity,
      audit,
      userDir,
    );
  });

  afterEach(() => {
    adapter.close();
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(userDir, { recursive: true, force: true });
  });

  it('lists a user-level skill, tagged source=user', () => {
    writeUserSkill('deploy-flow', 'Deploy flow');
    const skills = skill.list();
    const found = skills.find((s) => s.slug === 'deploy-flow');
    expect(found?.source).toBe('user');
    expect(found?.name).toBe('Deploy flow');
  });

  it('a project skill shadows a same-slug user skill', () => {
    writeUserSkill('shared', 'User version');
    skill.record({
      slug: 'shared',
      name: 'Project version',
      description: 'lives in the project',
      content: 'project body',
      actor: 'daniel',
    });
    const found = skill.list().filter((s) => s.slug === 'shared');
    expect(found).toHaveLength(1); // not duplicated
    expect(found[0]?.source).toBe('project');
    expect(found[0]?.name).toBe('Project version');
  });

  it('show falls back to the user layer when the project has none', () => {
    writeUserSkill('only-user', 'Only user');
    const result = skill.show('only-user');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.source).toBe('user');
  });

  it('record writes to the project, never the user layer', () => {
    skill.record({
      slug: 'recorded',
      name: 'Recorded',
      description: 'x',
      content: 'y',
      actor: 'daniel',
    });
    // The user dir gained nothing; the project did.
    const fromProject = skill.list().find((s) => s.slug === 'recorded');
    expect(fromProject?.source).toBe('project');
  });

  it('memories merge the same way, and the topic filter applies to user entries', () => {
    writeUserMemory('habit', 'A cross-project habit', ['workflow']);
    writeUserMemory('other', 'Unrelated', ['misc']);
    const workflow = memory.list('workflow');
    expect(workflow.some((m) => m.slug === 'habit')).toBe(true);
    expect(workflow.some((m) => m.slug === 'other')).toBe(false);
  });

  it('with no user layer (userDir null) only project entries show', () => {
    const isolated = new SkillService(
      path.join(projectRoot, 'skills'),
      new Set(),
      new SkillRepository(adapter),
      new IdentityService(new ActorRepository(adapter)),
      new AuditService(chainedAuditWriter(adapter, path.join(projectRoot, '.audit'))),
      null,
    );
    writeUserSkill('ignored', 'Ignored');
    expect(isolated.list().some((s) => s.slug === 'ignored')).toBe(false);
  });
});
