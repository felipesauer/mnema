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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type DestroyPaths, removeArtifacts } from '@/cli/commands/destroy-command.js';
import { CONFIG_FILE_RELATIVE } from '@/config/config-loader.js';

const PATHS: DestroyPaths = {
  state: '.mnema/state',
  audit: '.mnema/audit',
  workflows: '.mnema/workflows',
  backlog: '.mnema/backlog',
  sprints: '.mnema/sprints',
  roadmap: '.mnema/roadmap',
  memory: '.mnema/memory',
  skills: '.mnema/skills',
  workflow: 'default',
};

const bundledWorkflow = path.resolve('workflows/default.json');

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
      PATHS.skills,
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
        PATHS.skills,
        'AGENTS.md',
      ]),
    );
    expect(existsSync(path.join(projectRoot, PATHS.state))).toBe(false);
    expect(existsSync(path.join(projectRoot, CONFIG_FILE_RELATIVE))).toBe(false);
    expect(existsSync(path.join(projectRoot, PATHS.backlog))).toBe(true);
    expect(existsSync(path.join(projectRoot, PATHS.audit))).toBe(true);
    expect(existsSync(path.join(projectRoot, PATHS.workflows))).toBe(true);
    expect(existsSync(path.join(projectRoot, PATHS.workflows, 'default.json'))).toBe(false);
    // AGENTS.md had only the managed block, so it disappears entirely.
    expect(existsSync(path.join(projectRoot, 'AGENTS.md'))).toBe(false);
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
    expect(existsSync(path.join(projectRoot, PATHS.audit))).toBe(true);
  });

  it('also removes the audit log when keepAudit=false', () => {
    removeArtifacts(projectRoot, PATHS, { keepMarkdown: true, keepAudit: false });
    expect(existsSync(path.join(projectRoot, PATHS.audit))).toBe(false);
    expect(existsSync(path.join(projectRoot, PATHS.backlog))).toBe(true);
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
