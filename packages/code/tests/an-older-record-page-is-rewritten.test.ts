/**
 * A record founded by a published version keeps the README that version wrote, with the clone
 * address of its day. mnema replaces that page with the current one, and only when its bytes are
 * EXACTLY a page a published version wrote: a page a person edited, and the current page, are
 * left as they are.
 *
 * The old text below is typed here from the page the releases v0.1.2 to v0.1.5 shipped (read from
 * those tags), not computed from the current one.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RECORD_README } from '../src/commands/the-record-page.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

const PAGE_OF_THE_OLD_ADDRESS = [
  '# .mnema',
  '',
  "This is the project's mnema record: the signed, append-only log of the decisions behind the",
  'work, kept with the repository and committed with it.',
  '',
  '- The record changes as the work does, and each change goes in the same commit as the work',
  '  it describes.',
  '- Nothing here is edited by hand or reformatted. The record is signed bytes: a formatter that',
  '  rewrites one byte of it breaks the proof, so keep prettier and the like away from this folder.',
  '- Private keys are never here: the `.gitignore` in this folder keeps them out of git.',
  '',
  'To check it, run `mnema verify` in the project. Without installing anything, clone',
  'https://github.com/felipesauer/mnema and run',
  '`python3 packages/chain/verifier/mnema_verify.py record <this folder>`.',
  '',
].join('\n');

const SAID = 'replaced it with the current one';

let sandbox: string;
let repo: string;
let home: string;
const readme = () => join(repo, '.mnema', 'README.md');

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-older-page-'));
  repo = join(sandbox, 'repo');
  home = join(sandbox, 'home');
  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function mnema(...argv: string[]): { status: number | null; stdout: string; stderr: string } {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: repo,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

const everything = (out: { stdout: string; stderr: string }) => `${out.stdout}\n${out.stderr}`;
const record = () =>
  mnema('decision', 'record', 'Keep the parser small', 'It is read on every start');

describe('a README an earlier version wrote', () => {
  it('is replaced by the next signed write, once, with one line, and the record verifies', () => {
    expect(mnema('init').status).toBe(0);
    writeFileSync(readme(), PAGE_OF_THE_OLD_ADDRESS);
    const first = record();
    expect(first.status, first.stderr).toBe(0);
    expect(
      everything(first)
        .split('\n')
        .filter((l) => l.includes(SAID)),
    ).toHaveLength(1);
    expect(readFileSync(readme(), 'utf-8')).toBe(RECORD_README);
    expect(readFileSync(readme(), 'utf-8')).toContain('https://github.com/mnema-work/mnema');
    const second = mnema('decision', 'record', 'Keep the lexer small', 'It is read on every start');
    expect(everything(second)).not.toContain(SAID);
    expect(mnema('verify').status).toBe(0);
  }, 60_000);

  it('is replaced by mnema init on a founded project, and init says so', () => {
    expect(mnema('init').status).toBe(0);
    writeFileSync(readme(), PAGE_OF_THE_OLD_ADDRESS);
    const again = mnema('init');
    expect(again.status, again.stderr).toBe(0);
    expect(everything(again)).toContain('Replaced .mnema/README.md');
    expect(readFileSync(readme(), 'utf-8')).toBe(RECORD_README);
  }, 60_000);

  it('is left alone by a read', () => {
    expect(mnema('init').status).toBe(0);
    writeFileSync(readme(), PAGE_OF_THE_OLD_ADDRESS);
    for (const argv of [['verify'], ['status'], ['doctor']]) mnema(...argv);
    expect(readFileSync(readme(), 'utf-8')).toBe(PAGE_OF_THE_OLD_ADDRESS);
  }, 60_000);
});

describe('a README that is not a page mnema wrote', () => {
  it('is never touched when a person edited it, by a write or by init', () => {
    expect(mnema('init').status).toBe(0);
    const edited = `${PAGE_OF_THE_OLD_ADDRESS}\nOur team keeps the runbook at the wiki.\n`;
    writeFileSync(readme(), edited);
    const out = record();
    expect(out.status, out.stderr).toBe(0);
    expect(everything(out)).not.toContain(SAID);
    expect(mnema('init').status).toBe(0);
    expect(readFileSync(readme(), 'utf-8')).toBe(edited);
  }, 60_000);

  it('is never touched when it is the current page: same bytes, same modification time', () => {
    expect(mnema('init').status).toBe(0);
    const before = statSync(readme()).mtimeMs;
    const out = record();
    expect(out.status, out.stderr).toBe(0);
    expect(everything(out)).not.toContain(SAID);
    expect(mnema('init').status).toBe(0);
    expect(readFileSync(readme(), 'utf-8')).toBe(RECORD_README);
    expect(statSync(readme()).mtimeMs).toBe(before);
  }, 60_000);
});
