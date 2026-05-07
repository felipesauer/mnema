import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
};

describe('removeArtifacts', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-destroy-'));
    for (const dir of Object.values(PATHS)) {
      mkdirSync(path.join(projectRoot, dir), { recursive: true });
    }
    writeFileSync(path.join(projectRoot, 'mnema.config.json'), '{}', 'utf-8');
    writeFileSync(path.join(projectRoot, 'AGENTS.md'), '# x', 'utf-8');
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
      expect.arrayContaining(['.app', 'workflows', 'skills', 'mnema.config.json', 'AGENTS.md']),
    );
    expect(existsSync(path.join(projectRoot, '.app'))).toBe(false);
    expect(existsSync(path.join(projectRoot, 'mnema.config.json'))).toBe(false);
    expect(existsSync(path.join(projectRoot, 'backlog'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.audit'))).toBe(true);
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
    expect(removed).not.toContain('workflows');
    expect(removed).toContain('mnema.config.json');
  });
});
