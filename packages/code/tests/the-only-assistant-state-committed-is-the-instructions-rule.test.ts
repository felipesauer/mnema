// @reads-the-tree
/**
 * THE ONLY ASSISTANT STATE COMMITTED IS THE RULES FILE MNEMA WRITES. The `.claude/` directory is
 * a maintainer's local state (agents, skills, permissions, worktrees) and the root `.gitignore`
 * ignores it, with one exception: `.claude/rules/mnema-instructions.md`, the file
 * `mnema instructions` writes for Claude Code. Any other file under `.claude/` in the index
 * is accused, so an exception written too wide cannot publish a local file unseen.
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ALLOWED = ['.claude/rules/mnema-instructions.md'];

const strangers = (tracked: readonly string[]): string[] =>
  tracked.filter((file) => file.startsWith('.claude/') && !ALLOWED.includes(file));

const tracked = (): string[] =>
  execFileSync('git', ['ls-files', '-z', '--', '.claude'], { cwd: REPO, encoding: 'utf-8' })
    .split('\0')
    .filter((file) => file !== '');

describe('the only assistant state committed is the instructions rule', () => {
  it('finds nothing else under .claude/ in the index', () => {
    expect(strangers(tracked())).toEqual([]);
  });

  it('accuses a second file under .claude/, and any file in a subdirectory of it', () => {
    expect(
      strangers([
        '.claude/rules/mnema-instructions.md',
        '.claude/rules/other.md',
        '.claude/agents/implementar.md',
        '.claude/settings.json',
        'docs/claude.md',
      ]),
    ).toEqual(['.claude/rules/other.md', '.claude/agents/implementar.md', '.claude/settings.json']);
  });

  it('ignores the rest of .claude/ and keeps the one rules file visible', () => {
    const ignored = (path: string): boolean => {
      try {
        execFileSync('git', ['check-ignore', '--no-index', '-q', path], { cwd: REPO });
        return true;
      } catch {
        return false;
      }
    };
    expect(ignored('.claude/rules/mnema-instructions.md')).toBe(false);
    expect(ignored('.claude/rules/other.md')).toBe(true);
    expect(ignored('.claude/agents/x.md')).toBe(true);
    expect(ignored('.claude/worktrees/x/y')).toBe(true);
    expect(ignored('.claude/settings.local.json')).toBe(true);
  });
});
