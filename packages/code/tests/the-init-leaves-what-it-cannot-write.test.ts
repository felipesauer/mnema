/**
 * A FILE THE WRITE WOULD REFUSE IS A FILE THE PLAN LEAVES (`commands/instructions.ts`, `peekInstructions`;
 * `init/plan.ts`): read-only, a directory in its place, no permission on its folder. The plan says `leave` with the
 * reason and never promises a write that then fails; the founding writes nothing there and exits 0, and what it
 * says names the explicit command that adds the block once the permission is fixed (plain `mnema instructions`
 * would not, under ADR-177). `--yes` and `--hosts detected` are one function of what was found.
 */

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../src/commands/doctor.js';
import { type CliIo, run } from '../src/program.js';

let sandbox: string;
let home: string;
let repo: string;
const kept = { cwd: process.cwd(), home: process.env.HOME };

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-cannot-write-'));
  home = join(sandbox, 'home');
  repo = join(sandbox, 'repo');
  mkdirSync(home);
  mkdirSync(repo);
  process.env.HOME = home;
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(kept.cwd);
  if (kept.home === undefined) delete process.env.HOME;
  else process.env.HOME = kept.home;
  rmSync(sandbox, { recursive: true, force: true });
});

async function alone(argv: readonly string[]): Promise<{ out: string; failed: boolean }> {
  const out: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => out.push(line),
    fail: () => {
      failed = true;
    },
  };
  await run(argv, io);
  return { out: out.join('\n'), failed };
}

const read = (path: string) => readFileSync(join(repo, path), 'utf-8');

describe('files that cannot be written', { timeout: 60_000 }, () => {
  beforeEach(() => {
    writeFileSync(join(repo, 'CLAUDE.md'), '# Claude, mine\n');
    writeFileSync(join(repo, 'AGENTS.md'), '# Agents, mine\n');
    chmodSync(join(repo, 'CLAUDE.md'), 0o444);
    chmodSync(join(repo, 'AGENTS.md'), 0o444);
  });

  it('are shown by the plan as `leave` with the reason, and never as a write', async () => {
    const dry = await alone(['init', '--dry-run']);
    expect(dry.failed).toBe(false);
    expect(dry.out).toMatch(/leave\s+CLAUDE\.md\s+\(read-only\)/);
    expect(dry.out).toMatch(/leave\s+AGENTS\.md\s+\(read-only\)/);
    expect(dry.out).not.toMatch(/add to\s+(CLAUDE|AGENTS)\.md/);
  });

  it('are left as they were, exit 0, and the founding names the explicit command', async () => {
    const founded = await alone(['init']);
    expect(founded.failed).toBe(false);
    expect(read('CLAUDE.md')).toBe('# Claude, mine\n');
    expect(read('AGENTS.md')).toBe('# Agents, mine\n');
    expect(founded.out).toContain('`mnema instructions --hosts claude`');
    expect(founded.out).toContain('`mnema instructions --hosts codex`');
    expect(founded.out).not.toContain('--all-hosts');
    expect(founded.out).not.toContain('`mnema instructions` tries again');
  });

  it('get the block from the host form once the permission is fixed, and are then chosen', async () => {
    await alone(['init']);
    chmodSync(join(repo, 'CLAUDE.md'), 0o644);
    chmodSync(join(repo, 'AGENTS.md'), 0o644);
    await alone(['instructions', '--hosts', 'claude,codex']);
    expect(read('CLAUDE.md')).toContain('mnema:begin');
    expect(read('AGENTS.md')).toContain('mnema:begin');
    const check = await alone(['instructions', '--check']);
    expect(check.failed).toBe(false);
    expect(check.out).not.toContain('holds no mnema instructions');
    const doctor = runDoctor({
      cwd: repo,
      env: { home },
      processEnv: { PATH: '' },
      running: { file: join(sandbox, 'mnema'), version: '9.9.9' },
    }).findings.filter((one) => one.topic === 'instructions' && one.state === 'attention');
    expect(doctor).toEqual([]);
  });
});

describe('the narrow form that adds the block', { timeout: 60_000 }, () => {
  it('writes the host it names and nothing to a file the person left unchecked under another host', async () => {
    writeFileSync(join(repo, 'CLAUDE.md'), '# Claude, mine\n');
    writeFileSync(join(repo, 'GEMINI.md'), '# Gemini, mine\n');
    await alone(['init', '--hosts', 'cursor']);
    const before = {
      gemini: read('GEMINI.md'),
      cursor: read('.cursor/rules/mnema-instructions.mdc'),
    };
    const ran = await alone(['instructions', '--hosts', 'claude']);
    expect(ran.failed).toBe(false);
    expect(read('CLAUDE.md')).toContain('mnema:begin');
    expect(read('GEMINI.md')).toBe(before.gemini);
    expect(read('.cursor/rules/mnema-instructions.mdc')).toBe(before.cursor);
    expect(() => readFileSync(join(repo, 'AGENTS.md'), 'utf-8')).toThrow();
  });

  it('refuses a host it does not know, and the options it cannot be given with', async () => {
    await alone(['init', '--hosts', 'none']);
    const unknown = await alone(['instructions', '--hosts', 'pi']);
    expect(unknown.failed).toBe(true);
    expect(unknown.out).toContain('HOSTS_NOT_UNDERSTOOD');
    for (const other of ['--check', '--remove', '--all-hosts']) {
      const refused = await alone(['instructions', '--hosts', 'claude', other]);
      expect(refused.failed, other).toBe(true);
    }
  });
});

describe('the other things a write refuses', { timeout: 60_000 }, () => {
  it('a directory in the place of the file is left, with the reason', async () => {
    mkdirSync(join(repo, 'AGENTS.md'));
    const dry = await alone(['init', '--dry-run']);
    expect(dry.out).toMatch(/leave\s+AGENTS\.md\s+\(a directory is in its place\)/);
  });

  it('a folder that cannot be written leaves the file it would hold', async () => {
    mkdirSync(join(repo, '.cursor'));
    chmodSync(join(repo, '.cursor'), 0o555);
    try {
      const dry = await alone(['init', '--hosts', 'cursor', '--dry-run']);
      expect(dry.out).toMatch(
        /leave\s+\.cursor\/rules\/mnema-instructions\.mdc[\s\u2502]+\(no permission on its folder\)/,
      );
    } finally {
      chmodSync(join(repo, '.cursor'), 0o755);
    }
  });
});

describe('what was found', { timeout: 60_000 }, () => {
  it('is one function for --yes and --hosts detected: the same plan', async () => {
    mkdirSync(join(repo, '.cursor'));
    writeFileSync(join(repo, 'AGENTS.md'), '# Mine\n');
    writeFileSync(join(repo, 'GEMINI.md'), '# Gemini\n');
    const yes = await alone(['init', '--yes', '--dry-run']);
    const detected = await alone(['init', '--hosts', 'detected', '--dry-run']);
    expect(yes.out).toBe(detected.out);
    expect(yes.out).toContain('AGENTS.md');
  });

  it('marks a person’s file only under a checked row: GEMINI.md with no codex row found is not added to', async () => {
    mkdirSync(join(repo, '.cursor'));
    writeFileSync(join(repo, 'GEMINI.md'), '# Gemini\n');
    const dry = await alone(['init', '--yes', '--dry-run']);
    expect(dry.out).not.toContain('GEMINI.md');
  });
});
