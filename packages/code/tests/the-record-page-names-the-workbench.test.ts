/**
 * The page in `.mnema/` says nothing there is edited by hand, and that was the whole folder. With
 * `workbench/` beside the record (the person's notes, which no reader enumerates: `FORMAT.md`
 * section 4) the sentence holds for everything BUT that folder, and the page says which, so the
 * person who opens the folder is not told to leave their own notes alone, and an agent is not told
 * the notes are proof.
 */

import { describe, expect, it } from 'vitest';
import { RECORD_README } from '../src/commands/the-record-page.js';

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
