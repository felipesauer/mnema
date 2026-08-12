/**
 * THE PROSE CARRIES ITS OWN EMPHASIS. Two glyphs — the alarm and the no-entry sign — stood at
 * the head of six hundred comments in this workspace, and nothing here writes them any more.
 *
 * WHERE THIS COMES FROM. They were counted once: six hundred and twelve of them, across
 * fifty-eight files, and the count is the whole argument. A marker that appears six hundred
 * times marks nothing — the eye stops seeing it, and the paragraph it stands over is read at
 * the same weight as every other paragraph. It grew that way for a reason worth naming: each
 * session copied the style of the file it was editing, so the glyph spread by imitation rather
 * than by anybody deciding it earned its place.
 *
 * AND THE EMPHASIS DID NOT LIVE IN THE GLYPH ANYWAY. Five hundred and forty-nine of the six
 * hundred stood immediately before a clause already written in capitals, which is how this
 * repository has always carried a thesis; the glyph was decoration on top of emphasis that was
 * already there. The remainder were rewritten so the sentence says what the glyph was standing
 * in for, rather than being deleted along with it.
 *
 * SO THE RULE IS A BAN, over everything the workspace ships:
 *
 *   - THE SOURCES OF ALL FOUR PACKAGES, which is the obvious half.
 *   - THE CASES, which is the half that matters: three hundred and sixty-three of the six
 *     hundred lived in cases, so a scan that skipped them would pass over most of the tree
 *     while reporting zero.
 *   - WHAT THE PACKAGES PUBLISH AND WHAT THE PRODUCT PRINTS — the manifests, the READMEs, the
 *     golden files, and CI's own. None held one, and a ban that reached only sources would not
 *     be able to say so.
 *
 * WHAT IT DOES NOT COVER, said out loud rather than left to be discovered: whether the sentence
 * left where a glyph was still says what the glyph was there to say. That question is about
 * prose, and no scan reads prose — it is answered by review, and it was.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The workspace root — this file is `packages/code/tests/…`. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** This file, which the scan reaches and must not accuse. */
const HERE = fileURLToPath(import.meta.url);

/**
 * The two glyphs, spelled by CODE POINT. Written out, each would sit in this file's own source,
 * the scan would find itself, and the guard would be red the day it was written and switched
 * off the day after — so the one file in the workspace allowed to name them names them in a
 * form no editor renders.
 */
const ALARM = 0x26a0;
const NO_ENTRY = 0x26d4;
const CARRIED_BY_A_GLYPH = new RegExp(
  `[${String.fromCodePoint(ALARM)}${String.fromCodePoint(NO_ENTRY)}]`,
  'u',
);

/** The extensions text is carried in here — sources, manifests, CI's, and what is published. */
const TEXT = /\.(ts|mts|cts|js|mjs|cjs|json|ya?ml|md|txt)$/;

/**
 * EVERYTHING THE WORKSPACE SHIPS, ASKED OF THE WORKSPACE ITSELF rather than of a walk with a
 * list of directories to skip. What is tracked and what is merely present-and-not-ignored are
 * both here, so a file written this minute is covered before anybody stages it; what git ignores
 * is out, which is the point — the workbench and the local notes are somebody's own prose, and a
 * guard that reddened on those would be a guard switched off by the end of the week.
 *
 * IT CANNOT GO VACUOUS BY FAILING. If this comes back with nothing at all, the counts below say
 * so out loud instead of a scan over an empty list reporting no glyphs anywhere.
 */
const SCANNED: readonly string[] = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: ROOT, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 },
)
  .split('\n')
  .filter((where) => where !== '' && TEXT.test(where))
  .map((where) => join(ROOT, where));

/** What each scanned file is, relative to the root, paired with the text it holds. */
const READ = SCANNED.map((file) => ({
  where: file.slice(ROOT.length),
  text: readFileSync(file, 'utf-8'),
}));

describe('a paragraph carries its own weight, without a glyph to carry it', () => {
  it('is marked by neither glyph, anywhere the workspace ships', () => {
    const marked = READ.filter((file) => CARRIED_BY_A_GLYPH.test(file.text))
      .map((file) => file.where)
      .sort();
    expect(marked, 'a paragraph is leaning on a glyph again').toEqual([]);

    // THE SCAN REACHES THE WHOLE TREE, or the line above is true of nothing. Each half is
    // asserted on its own, because the halves are what a scan gets wrong: sources without
    // cases reports zero over a third of the files, and packages without the root reports it
    // over none of what is published.
    const reached = READ.map((file) => file.where);
    expect(reached.length, 'the workspace came back with almost nothing').toBeGreaterThan(400);
    for (const pkg of ['chain', 'code', 'copilot', 'core']) {
      expect(
        reached.filter((where) => where.startsWith(`packages/${pkg}/src/`)).length,
        `the source of @mnema/${pkg} was not read`,
      ).toBeGreaterThan(0);
    }
    expect(
      reached.filter((where) => where.endsWith('.test.ts')).length,
      'the cases, where most of them lived, were not read',
    ).toBeGreaterThan(100);
    expect(
      reached.filter((where) => where.startsWith('packages/code/tests/')).length,
      'the cases that live beside a package rather than inside its source were not read',
    ).toBeGreaterThan(0);
    expect(reached, 'the workspace’s own configuration was not read').toContain('vitest.config.ts');
    expect(reached, 'no manifest was read').toContain('package.json');
    expect(reached, 'what a package publishes was not read').toContain('packages/code/README.md');
    expect(reached, 'what the product prints was not read').toContain(
      'packages/code/src/cli.help.golden.txt',
    );
    expect(
      reached.filter((where) => where.startsWith('.github/')).length,
      'CI, which has prose of its own, was not read',
    ).toBeGreaterThan(0);

    // AND IT CANNOT FIND ITSELF. The glyphs are spelled by code point for exactly this: a file
    // is accused for leaning on one, never for naming what it bans.
    expect(readFileSync(HERE, 'utf-8'), 'the scan finds itself').not.toMatch(CARRIED_BY_A_GLYPH);
    expect(reached, 'the scan does not even reach itself').toContain(
      'packages/code/tests/the-prose-carries-its-own-emphasis.test.ts',
    );
  });

  it('and would find either of them, in a comment or in a case’s own name', () => {
    // Non-vacuity on text this case owns, one line per glyph and per place they were written —
    // and each built from a code point, because a sample spelled whole would put this file in
    // the list above.
    const alarm = String.fromCodePoint(ALARM);
    const noEntry = String.fromCodePoint(NO_ENTRY);
    expect(CARRIED_BY_A_GLYPH.test(` * ${alarm} IT USED TO SAY SOMETHING ELSE, and it did.`)).toBe(
      true,
    );
    expect(CARRIED_BY_A_GLYPH.test(`  // ${noEntry} IT MAY NOT READ THE RECORD.`)).toBe(true);
    expect(CARRIED_BY_A_GLYPH.test(`  it('${noEntry} draws the page', () => {`)).toBe(true);
    // The alarm carries a variation selector when an editor writes it, and the ban is on the
    // glyph rather than on one spelling of it. The selector is spelled by code point too: it
    // renders as nothing, and an invisible byte pasted into a source is a bill this repository
    // has paid four times.
    expect(CARRIED_BY_A_GLYPH.test(`${alarm}${String.fromCodePoint(0xfe0f)} DRESSED`)).toBe(true);
    // And it is not true of anything: a thesis in capitals is the form this rule EXISTS to
    // leave alone, and so is prose about the glyphs that says the word instead of drawing it.
    expect(CARRIED_BY_A_GLYPH.test(' * IT USED TO SAY SOMETHING ELSE, and it did.')).toBe(false);
    expect(CARRIED_BY_A_GLYPH.test('// a warning nobody reads is not a warning')).toBe(false);
  });
});
