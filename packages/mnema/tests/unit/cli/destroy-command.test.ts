import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CONFIG_FILE_RELATIVE } from '@mnema/core/config/config-loader.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DestroyPaths, removeArtifacts } from '@/cli/commands/destroy-command.js';

const PATHS: DestroyPaths = {
  state: '.mnema/state',
  audit: '.mnema/audit',
  workflows: '.mnema/workflows',
  backlog: '.mnema/backlog',
  sprints: '.mnema/sprints',
  roadmap: '.mnema/roadmap',
  memory: '.mnema/memory',
  observations: '.mnema/observations',
  skills: '.mnema/skills',
  commands: '.mnema/commands',
  workflow: 'default',
};

const bundledWorkflow = path.resolve('packages/core/workflows/default.json');

const AGENTS_MANAGED = `<!-- MNEMA:START -->\n# Mnema generated content\n<!-- MNEMA:END -->\n`;

describe('removeArtifacts', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-destroy-'));
    for (const dir of [
      PATHS.state,
      PATHS.audit,
      PATHS.workflows,
      PATHS.backlog,
      PATHS.sprints,
      PATHS.roadmap,
      PATHS.memory,
      PATHS.observations,
      PATHS.skills,
      PATHS.commands,
    ]) {
      mkdirSync(path.join(projectRoot, dir), { recursive: true });
    }
    const configFile = path.join(projectRoot, CONFIG_FILE_RELATIVE);
    mkdirSync(path.dirname(configFile), { recursive: true });
    writeFileSync(configFile, '{}', 'utf-8');
    writeFileSync(path.join(projectRoot, 'AGENTS.md'), AGENTS_MANAGED, 'utf-8');
    // Workflow JSON is a byte-for-byte copy of the bundled template,
    // matching what `init` does on a fresh project.
    copyFileSync(bundledWorkflow, path.join(projectRoot, PATHS.workflows, 'default.json'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('removes core artifacts and keeps markdown + audit by default', () => {
    const removed = removeArtifacts(projectRoot, PATHS, {
      keepMarkdown: true,
      keepAudit: true,
    });
    expect(removed).toEqual(
      expect.arrayContaining([
        CONFIG_FILE_RELATIVE,
        PATHS.state,
        path.join(PATHS.workflows, 'default.json'),
        PATHS.workflows,
        PATHS.skills,
        'AGENTS.md',
      ]),
    );
    expect(existsSync(path.join(projectRoot, PATHS.state))).toBe(false);
    expect(existsSync(path.join(projectRoot, CONFIG_FILE_RELATIVE))).toBe(false);
    expect(existsSync(path.join(projectRoot, PATHS.backlog))).toBe(true);
    expect(existsSync(path.join(projectRoot, PATHS.audit))).toBe(true);
    // The bundled workflow JSON was removed; its containing dir was
    // empty after that and is folded away too.
    expect(existsSync(path.join(projectRoot, PATHS.workflows, 'default.json'))).toBe(false);
    expect(existsSync(path.join(projectRoot, PATHS.workflows))).toBe(false);
    // AGENTS.md had only the managed block, so it disappears entirely.
    expect(existsSync(path.join(projectRoot, 'AGENTS.md'))).toBe(false);
  });

  it('folds the whole .mnema/ shell — the commands dir is not left orphaned', () => {
    // With nothing kept, every managed dir (including the MNEMA-69
    // commands dir) must go so `.mnema/` itself can be removed.
    const removed = removeArtifacts(projectRoot, PATHS, {
      keepMarkdown: false,
      keepAudit: false,
    });
    expect(removed).toContain(PATHS.commands);
    expect(existsSync(path.join(projectRoot, PATHS.commands))).toBe(false);
    expect(existsSync(path.join(projectRoot, '.mnema'))).toBe(false);
  });

  it('folds an empty commands dir even when markdown is kept', () => {
    // keepMarkdown preserves the trees, but an empty scaffolded commands
    // dir is not content worth keeping — it is folded so it does not
    // linger.
    const removed = removeArtifacts(projectRoot, PATHS, {
      keepMarkdown: true,
      keepAudit: true,
    });
    expect(removed).toContain(PATHS.commands);
    expect(existsSync(path.join(projectRoot, PATHS.commands))).toBe(false);
  });

  it('preserves a customised workflow JSON', () => {
    writeFileSync(
      path.join(projectRoot, PATHS.workflows, 'default.json'),
      '{"customised": true}\n',
      'utf-8',
    );
    const removed = removeArtifacts(projectRoot, PATHS, {
      keepMarkdown: true,
      keepAudit: true,
    });
    expect(removed).not.toContain(path.join(PATHS.workflows, 'default.json'));
    expect(existsSync(path.join(projectRoot, PATHS.workflows, 'default.json'))).toBe(true);
  });

  it('preserves a non-empty skills directory', () => {
    writeFileSync(path.join(projectRoot, PATHS.skills, 'my-skill.md'), '# Skill\n', 'utf-8');
    const removed = removeArtifacts(projectRoot, PATHS, {
      keepMarkdown: true,
      keepAudit: true,
    });
    expect(removed).not.toContain(PATHS.skills);
    expect(existsSync(path.join(projectRoot, PATHS.skills))).toBe(true);
  });

  it('strips only the managed block from a hand-edited AGENTS.md', () => {
    const userPrefix = '# My project\n\nCustom instructions for the agent.\n\n';
    writeFileSync(path.join(projectRoot, 'AGENTS.md'), `${userPrefix}${AGENTS_MANAGED}`, 'utf-8');

    removeArtifacts(projectRoot, PATHS, { keepMarkdown: true, keepAudit: true });

    expect(existsSync(path.join(projectRoot, 'AGENTS.md'))).toBe(true);
    const remaining = readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf-8');
    expect(remaining).toContain('Custom instructions');
    expect(remaining).not.toContain('MNEMA:START');
  });

  it('also removes markdown trees when keepMarkdown=false', () => {
    removeArtifacts(projectRoot, PATHS, { keepMarkdown: false, keepAudit: true });
    expect(existsSync(path.join(projectRoot, PATHS.backlog))).toBe(false);
    expect(existsSync(path.join(projectRoot, PATHS.sprints))).toBe(false);
    expect(existsSync(path.join(projectRoot, PATHS.roadmap))).toBe(false);
    expect(existsSync(path.join(projectRoot, PATHS.memory))).toBe(false);
    expect(existsSync(path.join(projectRoot, PATHS.observations))).toBe(false);
    expect(existsSync(path.join(projectRoot, PATHS.audit))).toBe(true);
  });

  it('also removes the audit log when keepAudit=false', () => {
    removeArtifacts(projectRoot, PATHS, { keepMarkdown: true, keepAudit: false });
    expect(existsSync(path.join(projectRoot, PATHS.audit))).toBe(false);
    expect(existsSync(path.join(projectRoot, PATHS.backlog))).toBe(true);
  });

  // The exact block `init` writes today (must match init-command's
  // `gitignoreBlock`). The destroy strip has to recognise THIS format, not the
  // stale `# mnema\n<state>/` tuple an older init used.
  const currentGitignoreBlock = [
    '# mnema: ignore only the local cache (SQLite db, sync buffer,',
    '# attachments) and the personal config.local.json override. The',
    '# backlog/roadmap/sprint/memory/skill markdown and the audit log',
    '# under .mnema/ are the source of truth — commit them. The cache is',
    '# rebuildable from that markdown via `mnema sync`.',
    `${PATHS.state}/`,
    '.mnema/config.local.json',
    `${PATHS.audit}/.audit.lock*`,
  ].join('\n');

  it('strips the managed `.gitignore` block (current format) and leaves user lines intact', () => {
    const userPrefix = 'node_modules/\ndist/\n';
    writeFileSync(
      path.join(projectRoot, '.gitignore'),
      `${userPrefix}\n${currentGitignoreBlock}\n`,
      'utf-8',
    );

    const removed = removeArtifacts(projectRoot, PATHS, {
      keepMarkdown: true,
      keepAudit: true,
    });
    expect(removed).toContain('.gitignore');
    const remaining = readFileSync(path.join(projectRoot, '.gitignore'), 'utf-8');
    expect(remaining).toContain('node_modules/');
    expect(remaining).toContain('dist/');
    expect(remaining).not.toContain('# mnema');
    expect(remaining).not.toContain(`${PATHS.state}/`);
    expect(remaining).not.toContain('.mnema/config.local.json');
    expect(remaining).not.toContain('.audit.lock');
  });

  it('deletes `.gitignore` when only the managed block (current format) remained', () => {
    writeFileSync(path.join(projectRoot, '.gitignore'), `${currentGitignoreBlock}\n`, 'utf-8');

    removeArtifacts(projectRoot, PATHS, { keepMarkdown: true, keepAudit: true });

    expect(existsSync(path.join(projectRoot, '.gitignore'))).toBe(false);
  });

  it('strips the managed `.gitattributes` block (current format) and leaves user lines intact', () => {
    const userLine = '*.png binary\n';
    const managed = [
      '# mnema: the audit log is append-only; merge with union so parallel',
      '# branches keep both sides instead of conflicting on the tail.',
      `${PATHS.audit}/*.jsonl merge=union`,
    ].join('\n');
    writeFileSync(path.join(projectRoot, '.gitattributes'), `${userLine}\n${managed}\n`, 'utf-8');

    const removed = removeArtifacts(projectRoot, PATHS, {
      keepMarkdown: true,
      keepAudit: true,
    });
    expect(removed).toContain('.gitattributes');
    const remaining = readFileSync(path.join(projectRoot, '.gitattributes'), 'utf-8');
    expect(remaining).toContain('*.png binary');
    expect(remaining).not.toContain('# mnema');
    expect(remaining).not.toContain('merge=union');
  });

  it('deletes `.gitattributes` when only the managed block remained', () => {
    const managed = [
      '# mnema: the audit log is append-only; merge with union so parallel',
      '# branches keep both sides instead of conflicting on the tail.',
      `${PATHS.audit}/*.jsonl merge=union`,
    ].join('\n');
    writeFileSync(path.join(projectRoot, '.gitattributes'), `${managed}\n`, 'utf-8');

    removeArtifacts(projectRoot, PATHS, { keepMarkdown: true, keepAudit: true });

    expect(existsSync(path.join(projectRoot, '.gitattributes'))).toBe(false);
  });

  it('skips paths that do not exist without raising', () => {
    rmSync(path.join(projectRoot, 'AGENTS.md'));
    rmSync(path.join(projectRoot, PATHS.workflows), { recursive: true });
    const removed = removeArtifacts(projectRoot, PATHS, {
      keepMarkdown: true,
      keepAudit: true,
    });
    expect(removed).not.toContain('AGENTS.md');
    expect(removed).not.toContain(path.join(PATHS.workflows, 'default.json'));
    expect(removed).toContain(CONFIG_FILE_RELATIVE);
  });
});
