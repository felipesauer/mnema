import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type DestroyPaths, removeArtifacts } from '@/cli/commands/destroy-command.js';

const PATHS: DestroyPaths = {
  state: '.app',
  audit: '.audit',
  workflows: 'workflows',
  backlog: 'backlog',
  sprints: 'sprints',
  roadmap: 'roadmap',
  memory: 'memory',
  skills: 'skills',
  workflow: 'default',
};

const bundledWorkflow = path.resolve('workflows/default.json');

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
    writeFileSync(path.join(projectRoot, 'mnema.config.json'), '{}', 'utf-8');
    writeFileSync(path.join(projectRoot, 'AGENTS.md'), '# x', 'utf-8');
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
        '.app',
        'mnema.config.json',
        'AGENTS.md',
        path.join('workflows', 'default.json'),
        'skills',
      ]),
    );
    expect(existsSync(path.join(projectRoot, '.app'))).toBe(false);
    expect(existsSync(path.join(projectRoot, 'mnema.config.json'))).toBe(false);
    expect(existsSync(path.join(projectRoot, 'backlog'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.audit'))).toBe(true);
    // The workflows/ directory itself is preserved — only the bundled
    // template that init wrote was deleted. The user's other custom
    // workflows (or the dev tree's bundled presets) survive.
    expect(existsSync(path.join(projectRoot, 'workflows'))).toBe(true);
    expect(existsSync(path.join(projectRoot, 'workflows', 'default.json'))).toBe(false);
  });

  it('preserves a customised workflow JSON', () => {
    // Overwrite default.json with hand-edited content so it no longer
    // byte-matches the bundled template. Destroy must leave it alone.
    writeFileSync(
      path.join(projectRoot, PATHS.workflows, 'default.json'),
      '{"customised": true}\n',
      'utf-8',
    );
    const removed = removeArtifacts(projectRoot, PATHS, {
      keepMarkdown: true,
      keepAudit: true,
    });
    expect(removed).not.toContain(path.join('workflows', 'default.json'));
    expect(existsSync(path.join(projectRoot, 'workflows', 'default.json'))).toBe(true);
  });

  it('preserves a non-empty skills directory', () => {
    writeFileSync(path.join(projectRoot, PATHS.skills, 'my-skill.md'), '# Skill\n', 'utf-8');
    const removed = removeArtifacts(projectRoot, PATHS, {
      keepMarkdown: true,
      keepAudit: true,
    });
    expect(removed).not.toContain('skills');
    expect(existsSync(path.join(projectRoot, 'skills'))).toBe(true);
  });

  it('also removes markdown trees when keepMarkdown=false', () => {
    removeArtifacts(projectRoot, PATHS, { keepMarkdown: false, keepAudit: true });
    expect(existsSync(path.join(projectRoot, 'backlog'))).toBe(false);
    expect(existsSync(path.join(projectRoot, 'sprints'))).toBe(false);
    expect(existsSync(path.join(projectRoot, 'roadmap'))).toBe(false);
    expect(existsSync(path.join(projectRoot, 'memory'))).toBe(false);
    expect(existsSync(path.join(projectRoot, '.audit'))).toBe(true);
  });

  it('also removes the audit log when keepAudit=false', () => {
    removeArtifacts(projectRoot, PATHS, { keepMarkdown: true, keepAudit: false });
    expect(existsSync(path.join(projectRoot, '.audit'))).toBe(false);
    expect(existsSync(path.join(projectRoot, 'backlog'))).toBe(true);
  });

  it('skips paths that do not exist without raising', () => {
    rmSync(path.join(projectRoot, 'AGENTS.md'));
    rmSync(path.join(projectRoot, 'workflows'), { recursive: true });
    const removed = removeArtifacts(projectRoot, PATHS, {
      keepMarkdown: true,
      keepAudit: true,
    });
    expect(removed).not.toContain('AGENTS.md');
    expect(removed).not.toContain(path.join('workflows', 'default.json'));
    expect(removed).toContain('mnema.config.json');
  });
});
