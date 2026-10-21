/**
 * `mnema instructions` through the program, in a throwaway project under a HOME of its own: one line
 * a file, a non-zero exit where a file is refused or a check finds one without the block, and the
 * founding's block that a repeated `mnema init` never puts back once the person took it out
 * (`mnema doctor` says so, and the verb is what puts it back).
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../src/commands/doctor.js';
import { INSTRUCTIONS_BLOCK } from '../src/instructions-block.js';
import { buildProgram, type CliIo } from '../src/program.js';

let sandbox: string;
let repo: string;
const cwdBefore = process.cwd();
const homeBefore = process.env.HOME;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-instructions-verb-'));
  process.env.HOME = join(sandbox, 'home');
  mkdirSync(process.env.HOME, { recursive: true });
  repo = join(sandbox, 'repo');
  mkdirSync(repo);
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(cwdBefore);
  if (homeBefore === undefined) delete process.env.HOME;
  else process.env.HOME = homeBefore;
  rmSync(sandbox, { recursive: true, force: true });
});

/** What `mnema <args>` prints, and whether it exited non-zero. */
async function mnema(...args: string[]): Promise<{ text: string; failed: boolean }> {
  const lines: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => void lines.push(line),
    err: (line) => void lines.push(line),
    fail: () => {
      failed = true;
    },
  };
  const { program } = buildProgram(io, args);
  await program.parseAsync(args, { from: 'user' });
  return { text: lines.join('\n'), failed };
}

const agents = () => readFileSync(join(repo, 'AGENTS.md'), 'utf-8');

function doctorSays(): string[] {
  return runDoctor({
    cwd: repo,
    env: { home: join(sandbox, 'home') },
    processEnv: { PATH: '' },
    running: { file: join(sandbox, 'mnema'), version: '9.9.9' },
  })
    .findings.filter((one) => one.topic === 'instructions')
    .map((one) => one.line);
}

describe('mnema instructions', () => {
  it('refuses outside a project, and writes nothing', async () => {
    const { text, failed } = await mnema('instructions');
    expect(failed).toBe(true);
    expect(text).toMatch(/project/i);
  });

  it('is not put back by a second init once the person took it out; doctor says so, and the verb puts it back', async () => {
    writeFileSync(join(repo, 'AGENTS.md'), '# Ours\n');
    await mnema('init');
    expect(agents()).toBe(`# Ours\n\n${INSTRUCTIONS_BLOCK}`);
    expect(doctorSays()).toEqual([]);

    writeFileSync(join(repo, 'AGENTS.md'), '# Ours\n');
    await mnema('init');
    expect(agents()).toBe('# Ours\n');
    expect(doctorSays()).toEqual([
      'AGENTS.md holds no mnema instructions: `mnema instructions` adds them after what it holds.',
    ]);

    const check = await mnema('instructions', '--check');
    expect(check.failed).toBe(true);
    expect(check.text).toContain('AGENTS.md holds no mnema instructions');

    const write = await mnema('instructions');
    expect(write.failed).toBe(false);
    expect(write.text).toContain('Added the mnema instructions to AGENTS.md, after what it holds.');
    expect(agents()).toBe(`# Ours\n\n${INSTRUCTIONS_BLOCK}`);
    expect((await mnema('instructions', '--check')).failed).toBe(false);
  });

  it('takes the block out and leaves the person’s file as it was', async () => {
    writeFileSync(join(repo, 'AGENTS.md'), '# Ours\n');
    await mnema('init');
    const removed = await mnema('instructions', '--remove');
    expect(removed.failed).toBe(false);
    expect(removed.text).toContain('Took the mnema instructions out of AGENTS.md');
    expect(agents()).toBe('# Ours\n');
  });

  it('leaves an edited block as it is, says so, and exits non-zero', async () => {
    await mnema('init');
    const edited = agents().replace('call `governing_rules`', 'call `governing_rules` twice');
    writeFileSync(join(repo, 'AGENTS.md'), edited);
    const write = await mnema('instructions');
    expect(write.failed).toBe(true);
    expect(write.text).toContain('Left AGENTS.md as it is');
    expect(agents()).toBe(edited);
  });
});
