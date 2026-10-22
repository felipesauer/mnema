/**
 * The page in `.mnema/` says nothing there is edited by hand, and that was the whole folder. With
 * `workbench/` beside the record (the person's notes, which no reader enumerates: `FORMAT.md`
 * section 4) the sentence holds for everything BUT that folder, and the page says which, so the
 * person who opens the folder is not told to leave their own notes alone, and an agent is not told
 * the notes are proof.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../src/commands/doctor.js';
import { runInit } from '../src/commands/init.js';
import {
  RECORD_README,
  RECORD_README_BEFORE_THE_WORKBENCH,
  whatIsMissing,
} from '../src/commands/the-record-page.js';

/** The page as prose: its lines joined, so a clause wrapped at a line end is one clause. */
const prose = RECORD_README.split('\n')
  .map((line) => line.trim())
  .join(' ');

describe('the page in the record', () => {
  it('still says the signed bytes are never edited by hand or reformatted', () => {
    expect(prose).toContain('is edited by hand or reformatted');
    expect(prose).toContain('a formatter that rewrites one byte of it breaks the proof');
  });

  it('names workbench/ as the one exception: the notes of the person, not proof', () => {
    expect(prose).toContain('except `workbench/`');
    expect(prose).toMatch(/`workbench\/`[^.]*notes[^.]*not part of the proof/);
  });

  it('says which part of the notes is committed and which stays on this machine', () => {
    expect(prose).toContain('`workbench/shared/` is committed');
    expect(prose).toContain('`workbench/local` never is');
  });
});

/**
 * A RECORD FOUNDED BEFORE THE WORKBENCH has the page that said nothing in the folder is edited by
 * hand. The bytes an earlier `init` wrote are known exactly: those, and only those, are replaced by
 * the page above, and a page somebody edited is left as it is.
 */
describe('a page an earlier init wrote', () => {
  let sandbox: string;
  let repo: string;
  const env = () => ({ home: join(sandbox, 'home') });
  const page = () => join(repo, '.mnema', 'README.md');
  const doctor = () =>
    runDoctor({
      cwd: repo,
      env: env(),
      processEnv: { PATH: '' },
      running: { file: join(sandbox, 'mnema'), version: '9.9.9' },
    })
      .findings.filter((one) => one.topic === 'record-page')
      .map((one) => one.line);

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-page-'));
    repo = join(sandbox, 'repo');
    mkdirSync(repo, { recursive: true });
    expect('refused' in runInit({ cwd: repo, env: env() })).toBe(false);
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('is those bytes exactly, and says the whole folder is never edited by hand', () => {
    expect(RECORD_README_BEFORE_THE_WORKBENCH).toContain('Nothing here is edited by hand');
    expect(RECORD_README_BEFORE_THE_WORKBENCH).not.toContain('workbench');
  });

  it('is named by doctor, which writes nothing, and replaced by init, which says so', () => {
    writeFileSync(page(), RECORD_README_BEFORE_THE_WORKBENCH);
    expect(whatIsMissing(repo)).toMatchObject({ readme: false, readmeIsEarlier: true });
    const lines = doctor();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('.mnema/README.md an earlier mnema init wrote');
    expect(readFileSync(page(), 'utf-8')).toBe(RECORD_README_BEFORE_THE_WORKBENCH);

    expect(runInit({ cwd: repo, env: env() })).toMatchObject({
      created: false,
      completed: { readme: false, readmeIsEarlier: true },
    });
    expect(readFileSync(page(), 'utf-8')).toBe(RECORD_README);
    expect('completed' in runInit({ cwd: repo, env: env() })).toBe(false);
    expect(doctor()).toEqual([]);
  });

  it('is left as it is where a person edited it', () => {
    const edited = `${RECORD_README_BEFORE_THE_WORKBENCH}\nOur own line.\n`;
    writeFileSync(page(), edited);
    expect(whatIsMissing(repo).readmeIsEarlier).toBeUndefined();
    expect('completed' in runInit({ cwd: repo, env: env() })).toBe(false);
    expect(readFileSync(page(), 'utf-8')).toBe(edited);
  });
});
