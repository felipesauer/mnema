/**
 * A LINE IS AS WIDE AS THE COLUMNS IT TAKES — the authority, on the values that broke it.
 *
 * IT WAS A COUNT OF CODE POINTS. The debt this closes was written down as *East Asian Ambiguous
 * glyphs counted as one column (7 of them)*, with the note *none of which appears in the
 * vocabulary*, and measuring it found the note false and the debt aimed at the smaller half:
 * there are fifteen Ambiguous characters in this product's own source, the em dash appears 1625
 * times, the banner's full block 140 — and under all of it, East Asian WIDE, which is not
 * ambiguous at all. Measured on the built binary before `width.ts` existed:
 *
 *   | line              | widthOf | columns |
 *   |-------------------|--------:|--------:|
 *   | `decisão`         |       7 |       7 |
 *   | `決定を記録する`      |       7 |      14 |
 *   | `é` (e + U+0301)  |       2 |       1 |
 *   | one CSI sequence  |      11 |       0 |
 *
 * A RECORD'S CONTENT IS THE CALLER'S, which is what makes the middle row a defect rather than a
 * curiosity: a decision titled in Japanese is ordinary, and every terminal there is drew it at
 * twice the width the frame's arithmetic thought.
 *
 * WHAT IS ASSERTED HERE, and why each case is here rather than covered by the one above it:
 *
 *   - WIDE IS TWO, on the value the measurement was made on, and glyph by glyph as well — so
 *     the number is a property of each character and not an accident of one string.
 *   - AND THE ZERO, both of its kinds. A combining mark adds no cell (the half a naive
 *     implementation gets wrong in the OTHER direction, by counting code points), and a control
 *     sequence adds none either (the half that was already right and had to stay).
 *   - THE CONVENTION FOR AMBIGUOUS, DECLARED — one column, on the glyphs this surface really
 *     writes, read from where they are written. It is the authority's choice and not this
 *     product's, and it is asserted so that the day the authority changes its default, this
 *     surface is told rather than redrawn. The banner's seven glyphs have their own house
 *     (`tests/the-name-in-full-blocks.test.ts`, which asks the product's own measurement of
 *     each).
 *   - THE PARTS SUM TO THE WHOLE. Everything that folds rests on it: the fold walks glyphs and
 *     compares the running total against a width the panel measured off the same text, so a
 *     glyph-by-glyph count that disagreed with the whole-string count would break a page in a
 *     place nothing on it explains.
 *   - AND NOT ONE LINE THIS SURFACE WRITES CHANGED WIDTH, which is the non-regression said as a
 *     property rather than trusted to a green run: the corpus is the recorded transcripts
 *     themselves, and for every line of them the new count and the count of code points it
 *     replaced are the same number. That is WHY the goldens hold without being regenerated.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CUT, NOBODY, PICK } from '../repl/palette.js';
import { SESSION_WORDS, WHAT_EACH_WORD_DOES } from '../session-words.js';
import { subjectLine } from './detail.js';
import { column } from './items.js';
import type { Line } from './line.js';
import { renderPlain, widthOf } from './plain.js';
import {
  cutTo,
  glyphsOf,
  howManyAreRemembered,
  padTo,
  widestOf,
  widthOfText,
  withoutSequences,
} from './width.js';

/** One escape byte, written as an escape so no control byte enters a source file. */
const ESC = '\u001b';

/** A sequence a FIELD may hold — magenta, which the styled renderer never writes. */
const A_SEQUENCE = `${ESC}[35m`;

/**
 * A TITLE A CALLER REALLY WRITES, and the string the defect was measured on.
 *
 * Seven characters, seven code points, fourteen cells: `決定を記録する` is *record the decision*
 * in Japanese. Every one of its glyphs is East Asian WIDE, which is a property of the character
 * rather than of a terminal — so fourteen is the answer everywhere, and it was seven.
 */
const A_CJK_TITLE = '決定を記録する';

/** How wide that title is on a screen, written down rather than computed. */
const FOURTEEN = 14;

/**
 * `e` FOLLOWED BY COMBINING ACUTE ACCENT — one thing on a screen, two code points.
 *
 * Spelled as a pair rather than typed as `é`, because the precomposed character is one code
 * point and would pass a count of code points: what this is for is the decomposed form, which
 * is what a caller's own text arrives as when their editor or their keyboard produced it.
 */
const A_COMBINED_E = 'e\u0301';

/**
 * THE RECORDED TRANSCRIPTS — every line this CLI writes for a person, pinned byte for byte.
 *
 * Read as the corpus of the non-regression rather than retyped, for the reason the whole bench
 * runs on: a line reworded next month travels into the case, and a copy would be a fixture
 * asserting what the surface said the month this was written.
 */
const THE_TRANSCRIPTS = [
  '../cli.help.golden.txt',
  '../cli.reads.golden.txt',
  '../cli.writes.golden.txt',
];

/** One line holding nothing but this text — the shape the width of a LINE is asked about. */
function lineOf(text: string): Line {
  return { indent: 0, parts: [{ role: 'field', text }] };
}

/**
 * EVERY NON-ASCII GLYPH THIS SURFACE WRITES OUTSIDE THE DRAWING OF THE NAME, read from where it
 * is written rather than retyped.
 *
 * The mark on a picked row and the mark that says a value was cut come from the module that owns
 * them; the separator between the parts of a heading comes from the renderer, by rendering one.
 * A list typed out here would be a list that stops agreeing with the surface the day a glyph
 * changes, which is the shape of fixture this bench pays for.
 */
function theGlyphsItWrites(): readonly string[] {
  const heading = renderPlain(subjectLine('a', 'b'));
  const written = `${PICK}${CUT}${NOBODY}${heading}`;
  return [...new Set([...written].filter((glyph) => glyph.codePointAt(0) !== undefined))].filter(
    (glyph) => (glyph.codePointAt(0) as number) > 0x7f,
  );
}

describe('East Asian Wide is two columns, which is a property of the character', () => {
  it('measures a title a caller writes at the width every terminal draws it', () => {
    // THE CASE OF THE DEFECT. Against the code this delivery replaces it answers 7.
    expect(widthOfText(A_CJK_TITLE)).toBe(FOURTEEN);
    // AND AS A LINE, which is the question the frame actually asks: the panel, the roll and the
    // fold all measure a composed LINE, and a width that were right about the string and wrong
    // about the line would be right about nothing anybody draws.
    expect(widthOf(lineOf(A_CJK_TITLE))).toBe(FOURTEEN);
  });

  it('says two of each of its glyphs, so the number is the character’s and not the string’s', () => {
    const glyphs = glyphsOf(A_CJK_TITLE);
    expect(glyphs.length).toBe(FOURTEEN / 2);
    for (const glyph of glyphs) {
      expect(glyph.width, JSON.stringify(glyph.bytes)).toBe(2);
    }
  });

  it('leaves what is beside it alone: the same sentence in Latin is its own length', () => {
    // NOT VACUOUS IN THE OTHER DIRECTION. A measurement that answered two for everything would
    // pass the case above and double every line of every report.
    expect(widthOfText('decisão')).toBe(7);
    expect(widthOfText('record the decision')).toBe('record the decision'.length);
  });
});

describe('and the zero — the half a naive count gets wrong the other way', () => {
  it('gives a combining mark no cell of its own', () => {
    // TWO CODE POINTS, ONE CELL. The old count answered 2, which is a page laid out around an
    // accent nobody draws in a column of its own.
    expect([...A_COMBINED_E].length).toBe(2);
    expect(widthOfText(A_COMBINED_E)).toBe(1);
    // AND IT IS ONE GLYPH, not two of which one is empty: a fold that broke between them would
    // put an accent alone at the start of a row.
    expect(glyphsOf(A_COMBINED_E).map((glyph) => glyph.bytes)).toEqual([A_COMBINED_E]);
  });

  it('gives a control sequence no cell at all, wherever it sits', () => {
    // A PAINTED LINE IS THE SAME WIDTH AS ITS PLAIN TWIN, which is what makes one function
    // enough for both renderers. The old count answered 11 for these five bytes and one letter.
    expect(widthOfText(A_SEQUENCE)).toBe(0);
    expect(widthOfText(`${A_SEQUENCE}x${ESC}[39m`)).toBe(1);
    // AND IT IS ONE GLYPH, whole: the bytes of a sequence measured one at a time would be four
    // columns of text nobody draws.
    const glyphs = glyphsOf(`${A_SEQUENCE}x`);
    expect(glyphs.map((glyph) => glyph.bytes)).toEqual([A_SEQUENCE, 'x']);
    expect(glyphs.map((glyph) => glyph.width)).toEqual([0, 1]);
  });

  it('tells a sequence from a break, which is the distinction the console rests on', () => {
    // A NEWLINE OCCUPIES NO COLUMN EITHER, and it is not an escape: a first draft of the
    // authority inferred "is a sequence" from "is no columns wide" and dropped every break out
    // of what a screen shows — measured, in two cases of `folded.test.ts`. So the two questions
    // are separate, and a caller reading rows still gets their rows.
    expect(withoutSequences(`a${A_SEQUENCE}\nb`)).toBe('a\nb');
    expect(glyphsOf('\n').map((glyph) => glyph.sequence)).toEqual([false]);
    expect(glyphsOf(A_SEQUENCE).map((glyph) => glyph.sequence)).toEqual([true]);
  });
});

describe('the convention for Ambiguous is the authority’s, and it is declared', () => {
  it('takes every glyph this surface writes as one column', () => {
    // THE DECLARATION, AS A CASE. These characters are one cell or two depending on the reader's
    // locale and font, and this product cannot know which; the authority treats them as NARROW,
    // on the recommendation of the standard that defines the class (UAX #11: if the context
    // cannot be established reliably, they should be treated as narrow characters by default).
    // So the day that default changes, this surface is TOLD rather than quietly redrawn — the
    // risk is unchanged by the delivery and it is now the whole of the remaining debt.
    const glyphs = theGlyphsItWrites();
    // Read, rather than absent: a scan that found no glyph passes this saying nothing.
    expect(glyphs.length).toBeGreaterThan(2);
    for (const glyph of glyphs) {
      expect(widthOfText(glyph), `${JSON.stringify(glyph)} is not one column`).toBe(1);
    }
  });

  it('would tell this surface if the authority started counting them as two', () => {
    // NOT VACUOUS: the case above is about a CHOICE, so it has to be able to see the other one.
    // The em dash is Ambiguous and this asserts what the surface would look like under the wide
    // convention — one glyph, two cells — by asking about a character that is Wide outright.
    expect(widthOfText('—')).toBe(1);
    expect(widthOfText('決')).toBe(2);
  });
});

describe('the parts sum to the whole, which is what everything that folds rests on', () => {
  it('agrees with itself over text of every kind this surface holds', () => {
    const corpus = [
      'an ordinary line of a report',
      A_CJK_TITLE,
      A_COMBINED_E,
      `${A_SEQUENCE}painted${ESC}[39m`,
      `${A_CJK_TITLE} ${A_COMBINED_E} decisão`,
      renderPlain(subjectLine('a heading', 'and its subject')),
      PICK,
      CUT,
      '',
    ];
    for (const text of corpus) {
      const parts = glyphsOf(text).reduce((total, glyph) => total + glyph.width, 0);
      expect(parts, JSON.stringify(text)).toBe(widthOfText(text));
    }
  });
});

describe('a column is padded in columns, and cut in columns', () => {
  it('pads a wide value to the width the reading measures', () => {
    // THE DEFECT PADDING HAD. `padEnd` pads to a count of code UNITS, so a value two cells per
    // glyph was padded as though it were one and every column to the right of it started two
    // cells further along on that row than on the rows around it. One column of this surface
    // holds a value a caller wrote — the agent a run's cost is attributed to.
    expect(widthOfText(padTo(A_CJK_TITLE, 20))).toBe(20);
    expect(padTo('決定', 6)).toBe('決定  ');
    // AND IT NEVER CUTS: a value wider than the column pushes the rest of the line right, which
    // is ugly, where cutting it would be a lie.
    expect(padTo(A_CJK_TITLE, 4)).toBe(A_CJK_TITLE);
    // AND THE TABLE'S OWN FUNCTION IS THIS ONE, so the reports cannot pad by a second rule.
    expect(column(A_CJK_TITLE, 20)).toBe(padTo(A_CJK_TITLE, 20));
  });

  it('cuts to a width in whole glyphs, never to half of one', () => {
    expect(cutTo(A_CJK_TITLE, 5)).toBe('決定');
    expect(widthOfText(cutTo(A_CJK_TITLE, 5))).toBe(4);
    expect(cutTo(A_COMBINED_E, 1)).toBe(A_COMBINED_E);
    expect(cutTo(A_COMBINED_E, 0)).toBe('');
    expect(cutTo('an ordinary line', 6)).toBe('an ord');
  });

  it('measures the widest of a list, which is what a column of a table is worth', () => {
    expect(widestOf(['a', A_CJK_TITLE, 'four'])).toBe(FOURTEEN);
    expect(widestOf([])).toBe(0);
  });
});

describe('not one line this surface writes changed width', () => {
  it('answers for every line of the recorded transcripts exactly what the old count answered', () => {
    // THE NON-REGRESSION AS A PROPERTY RATHER THAN AS A HOPE. The goldens hold every line the CLI
    // writes for a person, byte for byte (`cli.golden.test.ts`), so they are the corpus: for each
    // of them the new count and the count of code points this delivery replaced are the same
    // number. That is WHY the goldens stayed green without being regenerated — every line of them
    // is printable ASCII or a punctuation this surface chose from the Ambiguous class, which the
    // authority takes as one column.
    //
    // AND THE VOCABULARY THE SESSION ANSWERS TO IS IN IT TOO, asked of the module that owns it.
    const lines = [
      ...THE_TRANSCRIPTS.flatMap((golden) =>
        readFileSync(new URL(golden, import.meta.url), 'utf-8').split('\n'),
      ),
      ...SESSION_WORDS,
      ...Object.values(WHAT_EACH_WORD_DOES),
    ].filter((line) => line !== '');
    // Read, rather than absent: a corpus that came back empty passes this saying nothing.
    expect(lines.length).toBeGreaterThan(300);
    for (const line of lines) {
      expect(widthOfText(line), line).toBe([...line].length);
    }
    // AND THE CORPUS REALLY HOLDS THE PUNCTUATION, or the paragraph above is about nothing: the
    // separator between the parts of a heading is not ASCII, and it is one column.
    expect(lines.some((line) => /[^\u0020-\u007e]/.test(line))).toBe(true);
  });
});

describe('the fast path and the segmenter answer the same thing', () => {
  it('agrees with a segmentation done independently, over text of every kind', () => {
    // THE SHORTCUT IS NOT TRUSTED. Printable ASCII is answered without segmenting, because
    // segmentation is what measuring costs (`width.ts`, `theGlyphsOfPlainText`) — so this walks
    // the same corpus the slow way, here, and refuses a disagreement. A shortcut that stopped
    // being true of ASCII goes red rather than quiet.
    //
    // NO SEQUENCES IN THIS CORPUS: an escape is grouped into one glyph by the authority and a
    // bare segmentation would not group it, so the two would differ by construction. What a
    // sequence costs has its own case above.
    const segmenter = new Intl.Segmenter();
    const corpus = [
      'an ordinary line of a report',
      A_CJK_TITLE,
      A_COMBINED_E,
      `${A_CJK_TITLE} and ${A_COMBINED_E} and 決`,
      'decisão · a heading',
      renderPlain(subjectLine('a heading', 'and its subject')),
      '',
    ];
    for (const text of corpus) {
      const independently = [...segmenter.segment(text)].map((each) => ({
        bytes: each.segment,
        width: widthOfText(each.segment),
        sequence: false,
      }));
      expect(glyphsOf(text), JSON.stringify(text)).toEqual(independently);
    }
    // Not vacuous: the corpus really holds text the fast path refuses and hands over.
    expect(corpus.some((text) => /[^\u0020-\u007e]/.test(text))).toBe(true);
  });
});

describe('what has been measured is remembered, and the memory is bounded', () => {
  it('answers the same on both sides of the ceiling being emptied', () => {
    // THE POLICY, AS A CASE. A record's content is a caller's, so the set of strings this can be
    // asked about is unbounded; the map is emptied at a ceiling rather than grown for ever, and
    // what has to survive that is the ANSWER. The ceiling is not read from the module — what is
    // asserted is that however many texts go through, the count stays bounded and every answer
    // is the one the authority gives.
    const before = widthOfText(A_CJK_TITLE);
    const held: number[] = [];
    for (let at = 0; at < 9000; at += 1) {
      widthOfText(`a line nobody has measured before, number ${at}`);
      held.push(howManyAreRemembered());
    }
    // IT WAS EMPTIED, or this case is about a map that never reached its ceiling.
    expect(Math.min(...held.slice(1))).toBeLessThan(Math.max(...held));
    // AND IT STAYED BOUNDED: the largest it ever got is far short of what went through it.
    expect(Math.max(...held)).toBeLessThan(9000);
    // AND THE ANSWERS DID NOT MOVE, on the value the whole delivery is about.
    expect(widthOfText(A_CJK_TITLE)).toBe(before);
    expect(widthOfText(A_CJK_TITLE)).toBe(FOURTEEN);
  });
});
