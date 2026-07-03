import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WikilinkLintService } from '@/services/wikilink-lint-service.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { DecisionRepository } from '@/storage/sqlite/repositories/decision-repository.js';
import { MemoryRepository } from '@/storage/sqlite/repositories/memory-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { SkillRepository } from '@/storage/sqlite/repositories/skill-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('WikilinkLintService', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let lint: WikilinkLintService;
  let skillsDir: string;
  let memoryDir: string;
  let actorId: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-wl-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    skillsDir = path.join(tempRoot, 'skills');
    memoryDir = path.join(tempRoot, 'memory');
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(memoryDir, { recursive: true });

    const projects = new ProjectRepository(adapter);
    projects.insert({ key: 'TEST', name: 'Test' });
    actorId = 'a1';
    adapter
      .getDatabase()
      .prepare("INSERT INTO actors (id, handle, kind) VALUES (?, 'daniel', 'human')")
      .run(actorId);

    const skills = new SkillRepository(adapter);
    const memories = new MemoryRepository(adapter);
    const decisions = new DecisionRepository(adapter);
    const tasks = new TaskRepository(adapter);

    // known targets
    skills.insert({
      slug: 'other-skill',
      name: 'Other',
      version: 1,
      description: 'd',
      content: 'c',
      toolsUsed: [],
      createdBy: actorId,
    });
    memories.upsert({
      slug: 'a-memory',
      title: 'Mem',
      content: 'c',
      topics: [],
      createdBy: actorId,
    });

    lint = new WikilinkLintService(
      skillsDir,
      memoryDir,
      'TEST',
      skills,
      memories,
      decisions,
      tasks,
      projects,
    );
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function writeSkill(slug: string, body: string): void {
    writeFileSync(
      path.join(skillsDir, `${slug}.md`),
      `---\nname: ${slug}\nversion: 1.0.0\ndescription: x\n---\n\n${body}\n`,
    );
  }

  it('reports clean when every wikilink resolves', () => {
    writeSkill('a-skill', 'links to [[other-skill]] and [[a-memory]]');
    const report = lint.lint();
    expect(report.diagnostics).toEqual([]);
    expect(report.filesScanned).toBeGreaterThanOrEqual(1);
  });

  it('flags a broken wikilink', () => {
    writeSkill('a-skill', 'links to [[does-not-exist]]');
    const report = lint.lint();
    expect(report.warningCount).toBe(1);
    expect(report.diagnostics[0]?.message).toContain('does-not-exist');
  });

  it('accepts an anchored wikilink whose slug resolves', () => {
    writeSkill('a-skill', 'see [[other-skill#usage]]');
    const report = lint.lint();
    expect(report.diagnostics).toEqual([]);
  });

  it('accepts an Obsidian alias wikilink whose slug resolves', () => {
    // Before the alias fix the slug was "other-skill|Look here", which no
    // target matches, so the link was wrongly flagged as broken.
    writeSkill('a-skill', 'see [[other-skill|Look here]] and [[other-skill#usage|the usage]]');
    const report = lint.lint();
    expect(report.diagnostics).toEqual([]);
  });

  it('ignores wikilink-looking text inside frontmatter', () => {
    // gray-matter strips frontmatter; only the body is scanned
    writeFileSync(
      path.join(skillsDir, 'fm.md'),
      `---\nname: fm\nrelated: [[ghost]]\n---\n\nbody links to [[other-skill]]\n`,
    );
    const report = lint.lint();
    expect(report.diagnostics).toEqual([]);
  });

  it('referencesTo lists files linking to a slug', () => {
    writeSkill('one', 'I use [[other-skill]]');
    writeSkill('two', 'I also use [[other-skill]]');
    writeSkill('three', 'I use [[a-memory]] instead');
    const refs = lint.referencesTo('other-skill');
    expect(refs).toHaveLength(2);
    expect(refs.every((f) => f.endsWith('.md'))).toBe(true);
  });

  it('resolves a decision key as a valid target', () => {
    // record + accept a decision so its key exists
    const decisions = new DecisionRepository(adapter);
    const project = new ProjectRepository(adapter).findByKey('TEST');
    const seq = decisions.nextSequence(project?.id ?? '');
    decisions.insert({
      key: `TEST-ADR-${seq}`,
      projectId: project?.id ?? '',
      title: 'T',
      decision: 'D',
      context: null,
      rationale: null,
      consequences: null,
      authoredBy: actorId,
    });
    writeSkill('a-skill', `superseded by [[TEST-ADR-${seq}]]`);
    const report = lint.lint();
    expect(report.diagnostics).toEqual([]);
  });
});
