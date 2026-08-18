/**
 * `one-line.ts` DEPENDS ON NOTHING, asserted over its source.
 *
 * That is the whole property the module exists to have. The rule of the line is wanted by
 * twenty-two modules of this surface, and several of them are DECLARED — loaded by
 * commander before it has routed a word — so whatever this module imports, every
 * invocation of every verb pays for, including `mnema --version`, which reads nothing.
 * While the rule lived beside a framing that asks `@mnema/copilot` what a pattern's state
 * means, that price was one package, and it was paid twice by two slices that discovered
 * it only when the floor guard went red: a refusal site and a reading's phrase, both
 * fixed with an import inside a branch rather than at the cause.
 *
 * SO THE ASSERTION IS ABSENCE, AND ABSENCE IS THE ASSERTION THAT ROTS. A guard that
 * looked for one bad specifier would pass the day somebody imports a different one; a
 * guard that read the import list would pass on a file whose imports it could no longer
 * parse. This one strips the comments and then asserts the CODE holds no `import`, no
 * `from`, and no `require` at all — which catches a static import, a dynamic one, a
 * re-export, a CJS require, and the one that will actually be proposed: a type-only
 * import, which is erased and costs nothing at runtime and is exactly the argument that
 * admits the first edge back.
 *
 * THE COMMENTS HAVE TO BE STRIPPED AND THE STRIPPING HAS TO BE PROVED. The module's own
 * doc says the word `import` a dozen times, so a scan that read the file whole would be
 * red for the sentence explaining why it is green — and a stripper that ate too much
 * would be green for a file with a real import in it. Both directions are asserted on
 * source this file owns.
 *
 * AND THE MODULE HAS TO STILL BE THE MODULE. A file emptied of everything satisfies
 * "imports nothing" perfectly. What it exports is asserted beside the absence, so the
 * property is about the thing rather than about the empty set.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The module this file is about. */
const MODULE = fileURLToPath(new URL('./one-line.ts', import.meta.url));
/** A module of this package that really does import things — the non-vacuity witness. */
const IMPORTS_THINGS = fileURLToPath(new URL('./served-patterns.ts', import.meta.url));

/** A newline, built rather than typed, so no literal in this file spans two lines. */
const LF = String.fromCharCode(10);

/**
 * The source with every comment removed — block and line — so prose about an import is
 * not an import.
 *
 * Offsets are not preserved and do not need to be: what this file asserts is the
 * PRESENCE or absence of a word, never a position.
 */
function code(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    if (source[i] === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== LF) i += 1;
      continue;
    }
    if (source[i] === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

/** Every way a module can name something outside itself, found in `source`'s code. */
function reaches(source: string): string[] {
  const body = code(source);
  return [
    ...(body.match(/\bimport\b/g) ?? []),
    ...(body.match(/\bfrom\s*['"]/g) ?? []),
    ...(body.match(/\brequire\b/g) ?? []),
  ];
}

describe('the rule of the line needs nothing', () => {
  it('declares no import, of any kind, of anything', () => {
    // Not "no @mnema/*", and not "no package": NOTHING. A node builtin is a load too, a
    // relative import is how the last edge would arrive dressed as harmless, and a
    // type-only import is the one somebody will argue for — it is erased, so it costs
    // nothing, right up to the day the clause stops being type-only and nobody notices
    // because there was never a line to change.
    expect(reaches(readFileSync(MODULE, 'utf-8'))).toEqual([]);
  });

  it('is still the module that holds the rule', () => {
    // An empty file passes the assertion above. This is what keeps that from being the
    // cheapest way to make this suite green.
    const source = readFileSync(MODULE, 'utf-8');
    expect(source).toContain('export function oneLine(text: string): string {');
    expect(source).toContain("export const A_PERSON = 'a person';");
  });

  it('sees an import where there is one', () => {
    // The scan's own non-vacuity, against the module the rule moved OUT of — which
    // imports the copilot, and is the reason the rule moved.
    expect(reaches(readFileSync(IMPORTS_THINGS, 'utf-8')).length).toBeGreaterThan(0);
  });

  it('reads each shape a reach can take, and no comment about one', () => {
    // Every form on input this test owns, so the absence above is about the file rather
    // than about a syntax this scan stopped recognizing.
    expect(reaches("import { oneLine } from './x.js';")).not.toEqual([]);
    expect(reaches("import type { Thing } from './x.js';")).not.toEqual([]);
    expect(reaches("import * as all from './x.js';")).not.toEqual([]);
    expect(reaches("import './x.js';")).not.toEqual([]);
    expect(reaches("export { thing } from './x.js';")).not.toEqual([]);
    expect(reaches("export * from './x.js';")).not.toEqual([]);
    expect(reaches("const { thing } = await import('./x.js');")).not.toEqual([]);
    expect(reaches("const thing = require('./x.js');")).not.toEqual([]);

    // And the other direction: the module's doc is full of the word, and prose is not a
    // load. Both comment shapes, because the doc uses one and the code uses the other.
    const doc = `/**${LF} * A static import would put the copilot on the floor.${LF} */`;
    expect(reaches(doc)).toEqual([]);
    expect(reaches("// import { oneLine } from './x.js';")).toEqual([]);
    // The stripper does not eat code that follows a comment, which is how it would pass
    // the file for the wrong reason.
    expect(reaches(`/** doc */${LF}import { oneLine } from './x.js';`)).not.toEqual([]);
  });
});
