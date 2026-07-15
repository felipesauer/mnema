import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createCli } from '@/cli/index.js';

/**
 * A first-time user's `mnema --help` must show only the everyday command
 * set, not the full ~45-command flat list — the advanced/recovery/plumbing
 * commands are hidden from that list but stay fully registered and runnable
 * (hiding only removes them from help). `mnema help --all` (surfaced through
 * a `--all` token anywhere in argv) reveals every command. This mirrors the
 * subcommand-level curation in hidden-recovery-commands.test.ts, one level up
 * at the top-level command list.
 */

// The everyday set surfaced by default (must be present in `mnema --help`).
const COMMON = [
  'init',
  'task',
  'sprint',
  'epic',
  'decision',
  'note',
  'search',
  'query',
  'inbox',
  'focus',
  'history',
  'doctor',
  'upgrade',
  'mcp',
  'serve',
];

// A sample of the advanced/recovery set (hidden by default, shown under --all).
const ADVANCED_SAMPLE = ['audit', 'migration', 'migrate', 'destroy', 'project', 'stats', 'evolve'];

function topLevelHelp(argv: string[]): string {
  const saved = process.argv;
  // createCli reads process.argv to decide whether --all was requested.
  process.argv = ['node', 'mnema', ...argv];
  try {
    // outputHelp() (not helpInformation()) is what renders addHelpText('after'),
    // so the footer is only observable this way.
    const cli = createCli();
    let out = '';
    cli.configureOutput({ writeOut: (s) => (out += s) });
    cli.outputHelp();
    return out;
  } finally {
    process.argv = saved;
  }
}

function registeredNames(argv: string[]): string[] {
  const saved = process.argv;
  process.argv = ['node', 'mnema', ...argv];
  try {
    return createCli().commands.map((c) => c.name());
  } finally {
    process.argv = saved;
  }
}

describe('top-level --help common/advanced split', () => {
  it('shows every common command in the default help', () => {
    const help = topLevelHelp(['--help']);
    for (const name of COMMON) {
      const entry = new RegExp(`^\\s+${name}(?:\\|\\S+)? \\[args`, 'm');
      expect(entry.test(help), `${name} must be visible in the default help`).toBe(true);
    }
  });

  it('hides the advanced/recovery commands from the default help', () => {
    const help = topLevelHelp(['--help']);
    for (const name of ADVANCED_SAMPLE) {
      // Match the command's own help entry (`  <name> [args...]`) at the start
      // of a line, not a substring of another command's description (e.g. the
      // word "project" inside "…in the current directory").
      const entry = new RegExp(`^\\s+${name}(?:\\|\\S+)? \\[args`, 'm');
      expect(entry.test(help), `${name} must be hidden from the default help`).toBe(false);
    }
  });

  it('points at the hidden set with a footer', () => {
    const help = topLevelHelp(['--help']);
    expect(help).toMatch(/more advanced\/recovery command\(s\) are hidden/);
    expect(help).toContain('mnema help --all');
  });

  it('reveals every command under --all, with no footer', () => {
    const help = topLevelHelp(['--help', '--all']);
    for (const name of [...COMMON, ...ADVANCED_SAMPLE]) {
      const entry = new RegExp(`^\\s+${name}(?:\\|\\S+)? \\[args`, 'm');
      expect(entry.test(help), `${name} must be visible under --all`).toBe(true);
    }
    expect(help).not.toMatch(/more advanced\/recovery command\(s\) are hidden/);
  });

  it('keeps advanced commands registered (runnable) whether or not they are shown', () => {
    // Registration is independent of visibility: the stub exists in both modes.
    for (const mode of [['--help'], ['--help', '--all']]) {
      const names = registeredNames(mode);
      for (const name of ADVANCED_SAMPLE) {
        expect(names, `${name} must stay registered in mode ${mode.join(' ')}`).toContain(name);
      }
    }
  });
});
