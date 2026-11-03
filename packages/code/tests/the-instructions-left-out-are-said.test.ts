/**
 * A PERSON'S OWN FILE LEFT WITHOUT THE BLOCK counts as not chosen, where another instructions file holds one
 * (`commands/instructions.ts`, `leftOut`): `mnema instructions --check`, `mnema doctor` and `mnema instructions`
 * without a terminal leave it alone and say so in one line, with the command that adds the block. The choice is read
 * from the disk and nothing is recorded. Where no file holds a block, nothing was left out and every file there is
 * expected, as it always was.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../src/commands/doctor.js';
import { leftOut, leftOutLine } from '../src/commands/instructions.js';
import { type CliIo, run } from '../src/program.js';

let sandbox: string;
let home: string;
let repo: string;
const kept = { cwd: process.cwd(), home: process.env.HOME };

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-leftout-'));
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

const doctorInstructions = () =>
  runDoctor({
    cwd: repo,
    env: { home },
    processEnv: { PATH: '' },
    running: { file: join(sandbox, 'mnema'), version: '9.9.9' },
  }).findings.filter((one) => one.topic === 'instructions');

describe('a CLAUDE.md left off where another file holds the block', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    writeFileSync(join(repo, 'CLAUDE.md'), '# Mine\n');
    await alone(['init', '--hosts', 'codex']);
  });

  it('is read from the disk as left out, and the line names it and the command', () => {
    expect(leftOut(repo)).toEqual(['CLAUDE.md']);
    expect(leftOutLine(['CLAUDE.md'])).toContain('`mnema instructions --all-hosts` adds it');
  });

  it('is not complained about by --check, which says the one line and exits clean', async () => {
    const check = await alone(['instructions', '--check']);
    expect(check.failed).toBe(false);
    expect(check.out).not.toContain('CLAUDE.md holds no mnema instructions');
    expect(check.out).toContain(leftOutLine(['CLAUDE.md']));
  });

  it('is not complained about by doctor, which says the one line as fine', () => {
    const found = doctorInstructions();
    expect(found.filter((one) => one.state === 'attention')).toEqual([]);
    expect(found.map((one) => one.line)).toContain(leftOutLine(['CLAUDE.md']));
  });

  it('is left byte for byte as it was by `mnema instructions` without a terminal, and the line is said', async () => {
    const ran = await alone(['instructions']);
    expect(readFileSync(join(repo, 'CLAUDE.md'), 'utf-8')).toBe('# Mine\n');
    expect(ran.out).toContain(leftOutLine(['CLAUDE.md']));
  });

  it('is written with --all-hosts, which is the command the line names', async () => {
    await alone(['instructions', '--all-hosts']);
    expect(readFileSync(join(repo, 'CLAUDE.md'), 'utf-8')).toContain('mnema:begin');
  });
});

describe('a project where no file holds a block', { timeout: 60_000 }, () => {
  it('has left nothing out: a CLAUDE.md there is expected, and written, as it always was', async () => {
    writeFileSync(join(repo, 'CLAUDE.md'), '# Mine\n');
    await alone(['init', '--hosts', 'none']);
    expect(leftOut(repo)).toEqual([]);
    const check = await alone(['instructions', '--check']);
    expect(check.out).toContain('CLAUDE.md holds no mnema instructions');
    await alone(['instructions']);
    expect(readFileSync(join(repo, 'CLAUDE.md'), 'utf-8')).toContain('mnema:begin');
  });
});
