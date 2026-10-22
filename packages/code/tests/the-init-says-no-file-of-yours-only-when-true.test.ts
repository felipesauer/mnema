/**
 * `mnema init` says "mnema writes no file of yours" in the block about agents. That is true unless
 * the run has just added `.mnema/` to the repository's `.prettierignore` or written the mnema
 * instructions into a file a host reads, which the output says above it: then the block says "no
 * other file". Run in process, in a throwaway repository under a HOME of its own.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeInstructions } from '../src/commands/instructions.js';
import { buildProgram, type CliIo } from '../src/program.js';

let sandbox: string;
const cwdBefore = process.cwd();
const homeBefore = process.env.HOME;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-init-no-file-of-yours-'));
  process.env.HOME = join(sandbox, 'home');
  mkdirSync(process.env.HOME, { recursive: true });
});

afterAll(() => {
  process.chdir(cwdBefore);
  if (homeBefore === undefined) delete process.env.HOME;
  else process.env.HOME = homeBefore;
  rmSync(sandbox, { recursive: true, force: true });
});

/** What `mnema init` prints in a new repository, after `prepare` set it up. */
async function initPrints(name: string, prepare: (repo: string) => void): Promise<string> {
  const repo = join(sandbox, name);
  mkdirSync(repo);
  prepare(repo);
  process.chdir(repo);
  const lines: string[] = [];
  const io: CliIo = {
    out: (line) => void lines.push(line),
    err: (line) => void lines.push(line),
    fail: () => undefined,
  };
  const { program } = buildProgram(io, ['init']);
  await program.parseAsync(['init'], { from: 'user' });
  return lines.join('\n');
}

describe('the block about agents in what init prints', () => {
  it('says "no file of yours", exactly as before, when init touched nothing of theirs', async () => {
    // Every instructions file already holds this version's block: a clone of a repository that
    // committed them, founded again. Nothing outside `.mnema/` is written.
    const text = await initPrints('plain', (repo) => void writeInstructions(repo));
    expect(text).toContain('mnema writes no file of yours. In Claude Code');
    expect(text).not.toContain('no other file');
    expect(text).not.toContain('.prettierignore');
    expect(text).not.toContain('AGENTS.md,');
  });

  it('says "no other file" when init has just written the instructions, and names each file', async () => {
    const text = await initPrints('fresh', () => undefined);
    expect(text).toContain('Created AGENTS.md, with the mnema instructions.');
    expect(text).toContain('takes them out.');
    expect(text).toContain('mnema writes no other file of yours. In Claude Code');
    expect(text).not.toContain('mnema writes no file of yours');
  });

  it('says "no other file" when init has just written the .prettierignore, and says it did', async () => {
    const text = await initPrints('prettier', (repo) =>
      writeFileSync(join(repo, '.prettierignore'), 'dist\n'),
    );
    expect(text).toContain('.prettierignore');
    expect(text).toContain('mnema writes no other file of yours. In Claude Code');
    expect(text).not.toContain('mnema writes no file of yours');
  });
});
