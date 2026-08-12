/**
 * THE OPENING FITS THE SCREEN — how many rows the console spends before the caller has
 * typed anything, and where it leaves the caret.
 *
 * IT CAME OUT OF USE: *"the console's UX is too broken"*. Measured against the reference it
 * was drawn from rather than argued about — this console's own opening, on a real
 * pseudo-terminal, replayed onto a screen (`support/screen.ts`) — and three of the eight
 * defects that measurement found are what this file holds:
 *
 *   - THE OPENING TOOK THE SCREEN. Twenty-two of twenty-four rows on an ordinary terminal,
 *     which leaves TWO for the record a session exists to read. So the count is asserted at
 *     three sizes, and it is a count of what is DRAWN rather than of what was written: a
 *     row that scrolled away is not a row the caller has.
 *   - THE CARET OPENED THREE ROWS BELOW THE PROMPT, and corrected itself on the first
 *     keystroke. That discrepancy is the instrument: the opening and the frame after one
 *     key are compared with each other, so a caret that is wrong in the same way twice
 *     cannot pass by agreeing with itself.
 *   - THE NAME DEGRADED BY WIDTH AND NOT BY HEIGHT. Five rows of art on a terminal four
 *     rows tall is a drawing whose top is in the scrollback before the session has said
 *     anything. The threshold is the drawing's OWN height, and it is searched for here
 *     rather than written down.
 *
 * AND THE ONE ABOUT WHAT WENT: the box had a second section that named the word listing
 * the verbs, and it went — the row under the prompt says where every word is, and it says
 * it in the place that does not scroll away. What may not happen is the INFORMATION going
 * with the copy, so one case opens a session, finds the word nowhere on the page, and then
 * presses the key that lists it.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { bannerFor } from '../src/presentation/banner.js';
import { renderPlain } from '../src/presentation/plain.js';
import { theSessionsOwnWords } from '../src/repl/session.js';
import { ABOUT, LEAVE, PREFIX } from '../src/session-words.js';
import { VERSION } from '../src/version.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import {
  aFrameAfter,
  arrivedSince,
  inPty as drive,
  endOf,
  type Fixture,
  opensAConsole,
  type Ran,
  type Step,
} from './support/pty.js';
import { codeOnly } from './support/reading-source.js';
import { screenOf } from './support/screen.js';

/** This package's own tests — the corpus the guard over the pty drivers enumerates. */
const TESTS = fileURLToPath(new URL('.', import.meta.url));

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
/** `packages/code/src`, for the guard that reads the surface's own source. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** What the opening always says, whatever the terminal is like. */
const OPENED = 'a session over this project';
/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';
/**
 * The first words of the one sentence the session lands UNDER the panel — the last row the
 * opening draws, and what bounds it from below now that no bottom edge does.
 */
const UNDER_THE_PANEL = 'It runs the';
/** The caret's home: the prompt and the space after it, which is what a caller types past. */
const AFTER_THE_PROMPT = `${PROMPT} `;

/**
 * The glyph the drawings are inked with, and the run a rule is made of.
 *
 * Named by their code points rather than typed, like every other unusual byte in this
 * repository's sources: a rule is one keystroke away from a pipe and a run from a hyphen,
 * and a character a reader cannot tell from a neighbouring one is a character an edit
 * destroys without anybody seeing it happen. A raw Ctrl-C got into the first draft of this
 * very file, which is the twenty-fourth time on this bench.
 *
 * \u26a0\ufe0f THREE OF THEM WERE THE ISOMETRIC DRAWING'S, and they are gone with it: the two
 * diagonals, and the vertical \u2014 which was the same glyph as the box's own side, one character
 * in two roles, and four cases of this surface had to be taught to tell a row of the art from a
 * row of the box because of it. What draws the name now holds no frame glyph at all.
 *
 * \u26a0\ufe0f AND THE BOX'S SIDE WAS A CONSTANT OF THIS FILE. The frame is gone, so what it was here for
 * \u2014 telling a row inside the box from a row of it \u2014 has no subject at all; the rows of the
 * opening are bounded by what is above and below them instead.
 */
const INK = '\u2588';
const RUN = '\u2500';

/**
 * EVERY GLYPH THE DRAWINGS MAY BE MADE OF, each named by its code point \u2014 the eight blocks
 * and shades, and nothing else.
 *
 * THIS IS THE GUARD THAT REPLACED THE MASK, and it is stronger than the mask was. Every form
 * of the name used to be written as an ASCII mask, on the argument that a reader of the source
 * sees the FORM in characters an editor renders at one width; the biggest drawing is inked
 * with eight different blocks, and at eight marks a mask is unreadable \u2014 measured, by writing
 * it out (` ###_ _###% ###_    # %#####`). So the drawing is written out and the eight are
 * ENUMERATED instead, here and in the module's own doc: a ninth non-ASCII byte anywhere in
 * that file is accused, which is a stronger statement than "the masks are ASCII" ever made.
 *
 * The names are the Unicode ones, so a reader can check a code point against the standard
 * rather than against this file.
 */
const THE_EIGHT: readonly { readonly name: string; readonly glyph: string }[] = [
  { name: 'UPPER HALF BLOCK', glyph: '\u2580' },
  { name: 'LOWER HALF BLOCK', glyph: '\u2584' },
  { name: 'FULL BLOCK', glyph: INK },
  { name: 'LEFT HALF BLOCK', glyph: '\u258c' },
  { name: 'RIGHT HALF BLOCK', glyph: '\u2590' },
  { name: 'LIGHT SHADE', glyph: '\u2591' },
  { name: 'MEDIUM SHADE', glyph: '\u2592' },
  { name: 'DARK SHADE', glyph: '\u2593' },
];

/** Ctrl-C, which abandons the row being typed. Spelled as an escape, for the same reason. */
const CLEARS_THE_LINE = '\u0003';

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
let environment: NodeJS.ProcessEnv;
const before = { cwd: process.cwd(), env: { ...process.env } };

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-opening-'));
  project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  // The bytes a session prints may not depend on the developer's shell.
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  process.chdir(project);

  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  await run(['init'], io);
  await run(['task', 'the task the opening is counted over'], io);

  environment = {
    ...process.env,
    HOME: join(sandbox, 'home'),
    XDG_DATA_HOME: join(sandbox, 'data'),
    TERM: 'xterm-256color',
  };
  delete environment.MNEMA_RUN;
}, 180_000);

afterAll(() => {
  process.chdir(before.cwd);
  process.env = before.env;
  rmSync(sandbox, { recursive: true, force: true });
});

/** The fixture every case below drives the built binary over. */
const fixture = (): Fixture => ({
  cli: CLI,
  verb: REPL_VERB,
  project,
  scratch: sandbox,
  environment,
});

/** Runs `mnema repl` on a pseudo-terminal of a given size. */
async function inPty(options: {
  readonly columns: number;
  readonly rows: number;
  readonly steps: readonly Step[];
}): Promise<Ran> {
  return drive(fixture(), options);
}

/** The step every session begins with: the console open, and its first frame DRAWN. */
const opens: Step = opensAConsole(PROMPT);

/** The step every session ends with. */
const leaves: Step = {
  types: `${LEAVE}\r`,
  until: (bytes) => bytes.lastIndexOf(PROMPT) > bytes.indexOf(LEAVE),
  what: 'left',
};

// ---------------------------------------------------------------------------
// The four forms, and the ladder they make across a terminal
// ---------------------------------------------------------------------------

/**
 * A PAGE THAT COSTS NOTHING, so nothing but the WIDTH can decide which drawing is answered.
 *
 * ⚠️ HOLDING THE HEIGHT STILL USED TO BE ENOUGH. The name gave way when the drawing was
 * taller than the terminal, so a tall enough terminal kept the biggest form whatever else
 * was on the page. It gives way when the PAGE stops fitting now, and what a page costs is
 * answered by whoever composes one (`presentation/banner.ts`) — so a case about the width
 * holds the other axis still by answering that a page costs no rows at all. No console
 * answers that; every case about widths alone needs it.
 */
const COSTS_NOTHING = (): number => 0;

/** The drawing a terminal of a given width gets when the page it is on is free. */
const drawnAcross = (columns: number): string[] =>
  bannerFor({ columns, rows: ROOMY, needs: COSTS_NOTHING }).map(renderPlain);

/** How wide a drawing is: its widest row. */
const widthOf = (form: readonly string[]): number =>
  Math.max(...form.map((row) => [...row].length));

/**
 * A terminal with room for every form of the name, on each measurement.
 *
 * They are the OTHER axis in each case below, held still so that the one under test is the
 * only thing that moves — never a threshold, which is what is searched for.
 */
const WIDE = 200;
const ROOMY = 40;

/**
 * What an ASCII mark is inked as — the same substitution the module makes, spelled here by
 * code point for the reason the module spells it: a glyph a reader cannot tell from its
 * neighbour is a glyph an edit destroys without anybody seeing it happen. It is the file's
 * own {@link INK}, so the two cannot come to name different blocks.
 *
 * ⚠️ THERE WERE FOUR, and three of them were the isometric drawing's. That drawing is not a
 * mask any more — it is not in the file at all — so the substitutions it needed went with it
 * and one entry is what the masks that are left need.
 */
const INKS: readonly (readonly [string, string])[] = [['#', INK]];

/** The glyphs a drawing may hold, and nothing else may. */
const GLYPHS: readonly string[] = THE_EIGHT.map(({ glyph }) => glyph);

/**
 * EVERY DRAWING THERE IS, biggest first — walked off the module rather than written down.
 *
 * A form is what a width answers with, so the forms are what the answers CHANGE at: the
 * ladder is walked from a terminal wider than anything down to one with no width at all,
 * and each new answer is a form. Written out here instead, this list would be a second copy
 * of the art, and the first thing it would do is go stale.
 */
function everyForm(): readonly (readonly string[])[] {
  const forms: string[][] = [];
  for (let columns = WIDE; columns >= 0; columns -= 1) {
    const form = drawnAcross(columns);
    const last = forms[forms.length - 1];
    if (last === undefined || last.join('\n') !== form.join('\n')) forms.push(form);
  }
  return forms;
}

/** How many drawings of the name there are. Four, and the count is the design. */
const HOW_MANY_FORMS = 4;

describe('the name has four drawings, and the widest that fits across is the one drawn', () => {
  it('is four of them, each narrower than the one before it and none taller', () => {
    // THE LADDER, as a property of the module: each form is strictly narrower than the one
    // above it — two forms of one width would mean one of them is never chosen — and none is
    // taller than the one above it, which is what makes "biggest first" one order rather
    // than two that could disagree.
    const forms = everyForm();
    expect(forms).toHaveLength(HOW_MANY_FORMS);
    for (let at = 1; at < forms.length; at += 1) {
      const above = forms[at - 1] as readonly string[];
      const here = forms[at] as readonly string[];
      expect(widthOf(here), `form ${at} is not narrower`).toBeLessThan(widthOf(above));
      expect(here.length, `form ${at} is taller than the one above it`).toBeLessThanOrEqual(
        above.length,
      );
    }
    // AND THE BIGGEST ONE DID NOT PUSH THE FIVE-ROW ONE OUT — through two changes of what the
    // biggest one IS. The band between them is what a form covers, so the second is what a
    // terminal too narrow for the first gets: narrower than the widest and wider than the
    // letterspacing, and a delivery that replaced the SECOND rather than the first would leave
    // nothing between them.
    const [biggest, second] = forms as readonly (readonly string[])[];
    expect((biggest as readonly string[]).length).toBeGreaterThan(
      (second as readonly string[]).length,
    );
    expect(widthOf(second as readonly string[])).toBeLessThan(80);
  });

  it('gives each form up at the width its own drawing stops fitting at', () => {
    // THE THRESHOLD IS THE ART'S OWN WIDTH, searched for rather than written down: at its
    // own width a form is drawn, and one column narrower it is not.
    //
    // THE FLOOR IS THE ONE EXCEPTION AND IT IS THE POINT OF IT: it is answered at every
    // width there is, including widths narrower than itself, because the one thing this
    // banner exists to say may not be dropped. So the ladder is walked down to it and the
    // case below is where it is asserted.
    const forms = everyForm();
    for (const form of forms.slice(0, -1)) {
      const own = widthOf(form);
      expect(drawnAcross(own), `${own} columns`).toEqual(form);
      expect(drawnAcross(own - 1), `${own - 1} columns`).not.toEqual(form);
    }
    // Not vacuous: there really are forms above the floor, so the loop ruled on something.
    expect(forms.length, 'there is nothing above the floor').toBeGreaterThan(1);
  });

  it('still says the name in a terminal too narrow for anything', () => {
    // The floor, and the one thing that may not be dropped — said as the promise rather
    // than as the value, so whichever drawing is narrowest, it names the product.
    for (const columns of [4, 1, 0]) {
      expect(
        drawnAcross(columns).join('').split(' ').join('').toLowerCase(),
        `${columns}`,
      ).toContain('mnema');
    }
    // Not vacuous: the width really is what chose that, and a wide terminal answers with
    // something else.
    expect(drawnAcross(WIDE)).not.toEqual(drawnAcross(0));
  });

  it('never pads a row at its end, and draws nothing but the eight named glyphs', () => {
    // TWO PROPERTIES THE REST OF THE SURFACE DEPENDS ON, and neither is visible to a reader.
    //
    //   - NO ROW ENDS IN A BLANK. The layout trims the end of every row it writes, so a form
    //     padded on the right would arrive somewhere narrower than the arithmetic that chose
    //     it thinks it is — and the generator the biggest drawing came from pads.
    //   - EVERY GLYPH IS ASCII OR ONE OF THE EIGHT. ⚠️ IT USED TO BE *ONE OF THE FOUR*, and
    //     the four were substitutions: every form was an ASCII mask, so an unusual byte in a
    //     drawing could only have come from the table that inks one. The biggest drawing is
    //     written out now, blocks and all, and what replaces that reasoning is the
    //     enumeration itself ({@link THE_EIGHT}) — asked of the drawing here, and of the
    //     module's own bytes below.
    for (const form of everyForm()) {
      for (const row of form) {
        expect(row, 'a row is padded at its end').toBe(row.replace(/[ \t]+$/, ''));
        for (const glyph of row) {
          const named = glyph.codePointAt(0) as number;
          expect(
            named < 0x80 || GLYPHS.includes(glyph),
            `an unnamed glyph is drawn: ${JSON.stringify(glyph)}`,
          ).toBe(true);
        }
      }
    }
    // NOT VACUOUS: the drawings really are made of those glyphs rather than of ASCII alone,
    // so the enumeration is ruling on something. Every one of the eight is used, which is
    // what makes a ninth the only thing the guard below can be about.
    const drawn = new Set([...everyForm().flat().join('')].filter((g) => g.codePointAt(0) >= 0x80));
    expect([...drawn].sort(), 'a named glyph is drawn nowhere').toEqual([...GLYPHS].sort());
  });

  it('holds those eight code points in the module and no other unusual byte', () => {
    // THE GUARD THE MASK USED TO BE, over the bytes of the source rather than over the
    // drawing. What the doctrine is against is a character a reader cannot SEE — an escape, a
    // NUL, a zero-width space — and the enumeration is what makes "no other" checkable now
    // that a drawing is written out instead of masked.
    //
    // OVER THE CODE AND NOT OVER THE PROSE, because every doc in this repository is English
    // with a dash and a warning sign in it. That is the same split every scan on this surface
    // makes, and the case below proves this one makes it.
    const code = withoutComments(readFileSync(BANNER, 'utf-8'));
    const unusual = new Set([...code].filter((glyph) => (glyph.codePointAt(0) as number) >= 0x80));
    expect([...unusual].sort(), 'an unnamed byte is in the module').toEqual([...GLYPHS].sort());
    // Not vacuous in either direction: there really are unusual bytes to find, and a ninth
    // glyph — or an invisible one, which is what this exists for — would be accused.
    expect(unusual.size).toBe(THE_EIGHT.length);
    const ninth = '▖';
    expect(GLYPHS, 'the ninth glyph of the probe is one of the eight').not.toContain(ninth);
    const relapse = new Set(
      [...`const A = '${ninth}';`].filter((g) => (g.codePointAt(0) ?? 0) >= 0x80),
    );
    expect([...relapse]).toEqual([ninth]);
  });
});

// ---------------------------------------------------------------------------
// The mask in the source and the drawing that comes back are one artifact
// ---------------------------------------------------------------------------

/** Where the drawings are written down, as masks. */
const BANNER = join(SRC, 'presentation', 'banner.ts');

/**
 * Every mask written down in the source, as its rows.
 *
 * READ OFF THE SOURCE rather than exported for a test, because what is under test is the
 * thing a person edits: the mask is the artifact and the drawing is derived from it, so a
 * golden of the drawing would be a second copy of the art with nothing holding the two
 * together. Anything that changes a mask changes what this reads.
 */
function masksIn(source: string): readonly (readonly string[])[] {
  const masks: string[][] = [];
  for (const block of source.matchAll(/_MASK: readonly string\[\] = \[([\s\S]*?)\n?\];/g)) {
    const rows = [...(block[1] as string).matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((row) =>
      (row[1] as string).replace(/\\(.)/g, '$1'),
    );
    masks.push(rows);
  }
  return masks;
}

/**
 * THE ART, AS A SECOND COPY — the nine rows of the biggest drawing, written out.
 *
 * ⚠️ IT IS A GOLDEN AND IT IS HERE BECAUSE A ROUND TRIP COULD NOT BE ONE. While the biggest
 * form was a mask, the mask in the source and the drawing that came back were ONE artifact:
 * the second was the first with four substitutions made, so a mark changed in the mask
 * changed both and they went on agreeing. Measured rather than reasoned — a mutation that
 * turned one stroke of the first letter round left the whole suite green. What makes an edit
 * to the art LOUD is a copy that does not derive from it.
 *
 * ⚠️ AND THE COPY WAS ASCII, AND THIS IS WHERE THAT STOPS. The reason given was *the copy is
 * ASCII for the same reason the mask is: a reader sees the shape, and a diff shows which
 * stroke moved* — and the drawing this now holds is inked with eight blocks and shades, whose
 * mask a reader cannot see the shape in at all (` ###_ _###% ###_    # %#####`, measured by
 * writing it). So the copy is the GLYPHS, which is what keeps the half of the argument that
 * was load-bearing: a reader sees the shape and a diff shows which block moved. What guards
 * the bytes instead of the mask is the enumeration ({@link THE_EIGHT}), which is asked of this
 * file's own copy as much as of the module's.
 *
 * Changing the drawing is meant to change this. That is the whole of what it is for.
 */
const THE_BIGGEST_DRAWING: readonly string[] = [
  ' ███▄ ▄███▓ ███▄    █ ▓█████  ███▄ ▄███▓ ▄▄▄',
  '▓██▒▀█▀ ██▒ ██ ▀█   █ ▓█   ▀ ▓██▒▀█▀ ██▒▒████▄',
  '▓██    ▓██░▓██  ▀█ ██▒▒███   ▓██    ▓██░▒██  ▀█▄',
  '▒██    ▒██ ▓██▒  ▐▌██▒▒▓█  ▄ ▒██    ▒██ ░██▄▄▄▄██',
  '▒██▒   ░██▒▒██░   ▓██░░▒████▒▒██▒   ░██▒ ▓█   ▓██▒',
  '░ ▒░   ░  ░░ ▒░   ▒ ▒ ░░ ▒░ ░░ ▒░   ░  ░ ▒▒   ▓▒█░',
  '░  ░      ░░ ░░   ░ ▒░ ░ ░  ░░  ░      ░  ▒   ▒▒ ░',
  '░      ░      ░   ░ ░    ░   ░      ░     ░   ▒',
  '       ░            ░    ░  ░       ░         ░  ░',
];

describe('every drawing but the biggest is a mask inked, and every mask is ASCII', () => {
  it('reconstructs each masked drawing from the mask beside it, byte for byte', () => {
    const masks = masksIn(readFileSync(BANNER, 'utf-8'));
    const forms = everyForm();
    // The instrument first: a mask was found for every form but the biggest, in the same
    // order — a regular expression that matched nothing would otherwise pass this whole case
    // by having nothing to compare.
    //
    // ⚠️ IT USED TO BE ONE MASK PER FORM. The biggest drawing is written out rather than
    // masked, because eight marks is a mask a reader cannot see the shape in — so the masks
    // are the forms UNDER it, and what holds the biggest one is the copy above and the
    // enumeration of the eight glyphs.
    expect(masks, 'the masks were not found in the source').toHaveLength(forms.length - 1);

    for (const [at, mask] of masks.entries()) {
      // THE MASK IS ASCII TO THE BYTE. It is what a reader edits, and an editor renders
      // every character of it at one width — which is the whole reason the art is written
      // this way rather than as the drawing.
      for (const glyph of mask.join('\n')) {
        expect(glyph.codePointAt(0) as number, `mask ${at} is not ASCII`).toBeLessThan(0x80);
      }
      // AND NO ROW OF IT ENDS IN A BLANK, asserted on the mask as well as on the drawing:
      // the padding the drawing would carry is padding somebody left in the mask.
      for (const row of mask) {
        expect(row, `mask ${at} is padded at its end`).toBe(row.replace(/[ \t]+$/, ''));
      }
      // THE ROUND TRIP: the mask, with every mark inked, is the drawing the module answers
      // with. A mark added to a mask and not to the table below comes back as itself and
      // this goes red, and so does a drawing that stopped being made of its mask. The masks
      // are the forms UNDER the biggest one, so each is compared with the form after it.
      const inked = mask.map((row) =>
        INKS.reduce((drawing, [mark, glyph]) => drawing.split(mark).join(glyph), row),
      );
      expect(inked, `mask ${at} does not draw form ${at + 1}`).toEqual(forms[at + 1]);
    }
  });

  it('draws the art this file has a copy of, block for block', () => {
    // THE ONE ASSERTION NOTHING DERIVED CAN MAKE. While the biggest form was a mask, both
    // sides of the round trip above came out of that mask, so a mark changed in the source
    // changed both — measured, and the suite stayed green. This compares the drawing with a
    // copy that derives from nothing at all.
    const biggest = everyForm()[0] as readonly string[];
    expect(biggest, 'the biggest drawing is not the art this file has a copy of').toEqual(
      THE_BIGGEST_DRAWING,
    );
    // Not vacuous: the copy really is the biggest form and not, say, the floor, and it is the
    // drawing rather than a mask of one — every row of it holds a glyph no mask may hold.
    expect(biggest.length).toBe(THE_BIGGEST_DRAWING.length);
    expect(biggest.length).toBeGreaterThan(1);
    for (const row of THE_BIGGEST_DRAWING) {
      expect(
        [...row].some((glyph) => GLYPHS.includes(glyph)),
        row,
      ).toBe(true);
    }
  });

  it('would accuse a mask that was padded, and one that was not ASCII', () => {
    // The other vacuous form: a reader whose pattern stopped matching. Composed against what
    // somebody would actually write, so the case above cannot pass because the extraction
    // silently found nothing.
    const padded = masksIn("const A_MASK: readonly string[] = [\n  '#  ',\n];");
    expect(padded).toHaveLength(1);
    expect((padded[0] as readonly string[])[0]).toBe('#  ');
    const escaped = masksIn("const B_MASK: readonly string[] = [\n  '/\\\\|',\n];");
    expect((escaped[0] as readonly string[])[0]).toBe('/\\|');
    // And the inking really changes something, or the round trip above compares a mask
    // with itself.
    expect(INKS.reduce((row, [mark, glyph]) => row.split(mark).join(glyph), '#')).not.toBe('#');
  });
});

// ---------------------------------------------------------------------------
// The instrument: what "the console opened" means, and what it may not mean
// ---------------------------------------------------------------------------

describe('a session has opened when its frame is finished, not when its prompt is written', () => {
  it('answers no to a prompt with a frame still in flight, and yes at the boundary', () => {
    // ⚠️ THE INSTRUMENT WAITED FOR THE PROMPT, and a prompt is written in the MIDDLE of a
    // frame — the rows under it and the caret's own position come after. Three cases of this
    // surface went red on it during this delivery, none of them about a prompt: a caret one
    // row below the one it opens on, and the input area's two rules missing from a screen
    // replayed from half a frame. The opening is a third taller on a terminal with room for
    // the biggest drawing, which is what made the split reads likely enough to see.
    //
    // ⛔ AND IT IS PINNED HERE RATHER THAN BY A MUTATION OF THE SUITE. Putting the old
    // condition back leaves every case GREEN on a quiet machine — it is a race, and a race
    // does not answer a single run. What is deterministic is the predicate itself, so that
    // is what is asserted: the bytes of a frame that has not ended, and the bytes of one
    // that has.
    const frame = '\u001b[?2026h';
    const drawn = '\u001b[?2026l';
    const opened = aFrameAfter(PROMPT);

    // The prompt is there and the frame it is in has not ended: the rows under it are still
    // coming. This is exactly what the old condition answered yes to.
    expect(opened(`${frame}box${PROMPT}`), 'a frame still being written read as open').toBe(false);
    // The frame ended, but another one is already in flight behind it — the bytes do not end
    // at a boundary, so a screen replayed from them is half a frame.
    expect(
      opened(`${frame}box${PROMPT}${drawn}${frame}more`),
      'a frame in flight read as open',
    ).toBe(false);
    // A frame that ended before the prompt was written says nothing about the prompt's own.
    expect(opened(`${frame}box${drawn}${PROMPT}`), 'an older frame read as this one').toBe(false);
    // And the one shape that IS open: the prompt, then the end of the frame it is in, and
    // nothing after it.
    expect(opened(`${frame}box${PROMPT}${drawn}`), 'a finished frame did not read as open').toBe(
      true,
    );
  });

  it('ends the step where its question said yes, not where the buffer had got to', async () => {
    // ⚠️ THE PREDICATE WAS THE HALF THAT WAS WRONG, AND THE CUT POINT WAS THE OTHER. The
    // question was asked at one instant and the length was taken at another, after a pause
    // that only watched the stream stop growing — so a write that stalled MID-FRAME for
    // longer than the pause ended the step at a point the question would have refused. That
    // is what stayed red in the whole suite and green on its own after the predicate was
    // fixed: the correction had reached the site, and there were two sites.
    //
    // ⛔ AND IT IS PINNED ON BYTES BUILT BY HAND rather than on a run. A race does not answer
    // a single run — measured on this very delivery, six runs of the affected files went
    // green with the broken condition in place. What is deterministic is the arithmetic: a
    // stream that stops mid-frame may not be a cut point, and one that stops at a boundary
    // must be.
    const frame = '\u001b[?2026h';
    const drawn = '\u001b[?2026l';
    const opened = aFrameAfter(PROMPT);

    // The stream, as it arrives. It reaches a point the question APPROVES, then the next
    // frame begins — inside the pause, which is what made the old reading take its length —
    // and only later does that frame end.
    const approved = `${frame}box${PROMPT}${drawn}`;
    const midFrame = `${approved}${frame}more`;
    const finished = `${midFrame}${drawn}`;
    let stream = approved;
    const arriving = [
      setTimeout(() => {
        stream = midFrame;
      }, 20),
      setTimeout(() => {
        stream = finished;
      }, 300),
    ];

    const cut = await endOf(
      { until: opened, what: 'opened its console' },
      () => stream,
      () => false,
    );
    for (const timer of arriving) clearTimeout(timer);

    // THE INVARIANT, and it is the whole of the fix: the bytes up to the cut are bytes the
    // step's own question says yes about.
    expect(opened(stream.slice(0, cut)), 'the step ended somewhere its question refuses').toBe(
      true,
    );
    // NOT VACUOUS, and this is what the old reading would have answered: the length the
    // buffer had reached when it went quiet is a point mid-frame, and it is REFUSED.
    expect(midFrame.length, 'the stream never grew past the point it approved').toBeGreaterThan(
      approved.length,
    );
    expect(opened(midFrame), 'the mid-frame point is not the trap it is meant to be').toBe(false);
    expect(cut, 'the step ended at the point the old reading would have taken').not.toBe(
      midFrame.length,
    );
    expect(cut).toBe(finished.length);
  });

  it('⚠️ refuses a sentence the OPENING said, and takes the same sentence from the verb', async () => {
    // ⚠️ THE OTHER WAY A STEP ENDS TOO EARLY, and it is not about frames at all: the string it
    // waits for is one THE PANEL ALREADY WROTE. The opening prints the record's verdict on
    // every page there is, so three steps that typed `verify` and waited for *"local integrity
    // verified"* anywhere in the stream were satisfied by the drawing — and the case they fed
    // asserted the ECHO, which is the one thing only a caller can put on a page. It went red
    // once in two runs of the whole suite and green three times out of three on its own.
    //
    // ⛔ AND IT IS PINNED ON BYTES BUILT BY HAND, for the reason the case above is: a race does
    // not answer a single run. What is deterministic is the predicate — a sentence that was
    // already there when the step began is not this step's answer, and the same sentence
    // arriving after it is.
    const said = 'local integrity verified';
    // The opening, as far as this case is concerned: it says the sentence, and nothing has
    // been typed.
    const opening = `box${said}(T1/T2/T4)${PROMPT} `;
    const since = opening.length;

    // ⚠️ WHAT THE OLD PREDICATE ANSWERED, written out here rather than imported, because it is
    // what this case exists to refuse: over the whole stream, the opening alone says yes.
    const overTheWholeStream = (bytes: string): boolean => bytes.includes(said);
    expect(overTheWholeStream(opening), 'the opening does not say it, so there is no trap').toBe(
      true,
    );

    // THE PROMISE: the step's own question says NO on bytes in which only the opening said it.
    const answered = arrivedSince(said);
    expect(answered(opening, since), 'the opening answered a step it did not cause').toBe(false);

    // AND YES once the verb has answered — so this is a predicate that discriminates rather
    // than one that refuses everything.
    const echoed = `${opening}verify\r\n`;
    const whole = `${echoed}public: ${said}(T1/T2/T4)\r\n`;
    expect(answered(whole, since), 'the verb answered and the step did not notice').toBe(true);

    // AND THE STEP REALLY WOULD HAVE BEEN CUT BEFORE THE ECHO, which is the defect rather than
    // the predicate: with the old question the step ends on `opening`, where the echo the case
    // asserts is not yet on the page. Asked of {@link endOf}, so it is the instrument's own
    // answer and not an argument about it.
    const cut = await endOf(
      { until: overTheWholeStream, what: 'answered' },
      () => opening,
      () => false,
      since,
    );
    expect(cut, 'the old question did not end the step on the opening').toBe(opening.length);
    expect(opening.slice(0, cut)).not.toContain(`${PROMPT} verify`);
    // And the fixed question, on the same stream, refuses that cut point.
    expect(answered(opening.slice(0, cut), since)).toBe(false);
  });

  it('⚠️ asks every wait about what the caller caused, in each of the drivers that wait', () => {
    // ⚠️ THE OTHER HALF, AND IT SCORED ZERO. The question above is only as good as the number
    // handed to it, and mutating the DRIVER to hand `0` instead of where the step began left
    // every case green — the rule was proved in the predicate and unguarded in the three
    // places that feed it. This is the site count, and there are THREE: the shared instrument
    // and two files that drive a pty of their own.
    //
    // ⚠️ FOUND BY THE DISCRIMINANT, AND THE FIRST DISCRIMINANT WAS TOO NARROW. It was
    // `step.until(` — *a driver is a file that asks a STEP its own question* — and that named
    // three. Two more drive a pty without a step at all, and one of them waits for
    // *"local integrity verified"* in four places, which is the very sentence the panel writes.
    // What every pty driver DOES have is the size check, because a reading taken against a
    // device of unknown size is not a reading (`support/pty.ts`); so that is the discriminant,
    // and it named five. ⚠️ IT NAMES FOUR NOW: the copy in `the-page-follows-the-terminal.test.ts`
    // went back to the shared instrument, because a step that has to WAIT — an absence is waited
    // OUT, not watched for — is something the copy had no way to express. The rule is unchanged
    // and one site fewer holds it.
    // ⚠️ AND THREE NOW, which is the count going down for a blunter reason:
    // `a-page-that-opens-clean.test.ts` is GONE. Its whole subject was a page opened by scrolling
    // the caller's own screen into their scrollback, and the console draws on a screen of its own
    // — there is no page of theirs to carry away and nothing the file could still be asking. What
    // replaced it drives the pty through the shared instrument
    // (`the-screen-is-ours.test.ts`), which is why the list did not grow to make up for it.
    const drivers = readdirSync(TESTS)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => ({ name, source: readFileSync(join(TESTS, name), 'utf-8') }))
      .concat(
        readdirSync(join(TESTS, 'support'))
          .filter((name) => name.endsWith('.ts'))
          .map((name) => ({
            name: join('support', name),
            source: readFileSync(join(TESTS, 'support', name), 'utf-8'),
          })),
      )
      .filter(({ source }) => codeOnly(source).includes('theDeviceWasTheSizeAskedFor('));
    expect(drivers.map(({ name }) => name).sort(), 'a pty driver appeared or went away').toEqual([
      join('support', 'pty.ts'),
      'the-console-on-ink.test.ts',
      'the-screen-says-what-it-was-drawn-at.test.ts',
    ]);

    // WHICH OF THEM WAIT FOR SOMETHING THE CALLER CAUSED, which is what the rule is about. One
    // of the three does not: it writes bytes at a decoder and asserts what came back, so it has
    // no marker to be answered early about. It is NAMED rather than filtered out silently — a
    // driver that stopped waiting would otherwise leave this list quietly.
    const WAITS_FOR_NOTHING_THE_CALLER_CAUSED = 'the-screen-says-what-it-was-drawn-at.test.ts';
    const waiting = drivers.filter(({ name }) => name !== WAITS_FOR_NOTHING_THE_CALLER_CAUSED);
    expect(
      codeOnly(
        drivers.find(({ name }) => name === WAITS_FOR_NOTHING_THE_CALLER_CAUSED)?.source as string,
      ),
      `${WAITS_FOR_NOTHING_THE_CALLER_CAUSED} started waiting for something, so it needs the rule`,
    ).not.toContain('until(() =>');
    // AND THE OTHER TWO BOTH USE THE ONE RULE. This is the A3 half: one function that says what
    // the question means, and every driver that waits asks it.
    for (const { name, source } of waiting) {
      expect(codeOnly(source), `${name}: waits without the rule`).toContain('arrivedSince(');
    }

    // ⚠️ AND IT IS READ AFTER THE DEVICE IS SETTLED, not anywhere in the file. The first draft
    // of this guard compared against the whole source and accused the shared instrument for
    // DEFINING `resizedTo` above the loop that calls it — an instrument that accuses the
    // innocent, which this bench has now paid for twice. The scope is what the driver does once
    // it has a device of a known size, which is the same boundary in every shape rather than a
    // loop only some of them have.
    const drivingIn = (source: string): string => {
      const code = codeOnly(source);
      // ⚠️ THE CALL AND NOT THE NAME. Anchoring on the bare name put the scope at the shared
      // instrument's own DEFINITION of the check, above every function in the file, so the
      // definition of `resizedTo` fell inside the scope and this guard accused the innocent for a
      // third time. An instrument that can accuse three ways needs its own cases.
      const at = code.indexOf('await theDeviceWasTheSizeAskedFor(');
      expect(at, 'a driver that never awaited the size of its device').toBeGreaterThan(-1);
      // ⚠️ AND IT ENDS WHERE THE DRIVER DOES. Running the scope to the end of the FILE swept in
      // everything below it, and one of these files holds cases driven in process — on a pair of
      // fake streams rather than on a device — which wait for the opening on purpose and have no
      // keystroke to be scoped against. The guard accused them: a fourth way to accuse the
      // innocent, and the third caught by its own cases. Every driver hands the terminal back in
      // a `finally`, so that is the end of the body that drives one.
      const ends = code.indexOf('} finally {', at);
      expect(ends, 'a driver that never gives the terminal back').toBeGreaterThan(at);
      return code.slice(at, ends);
    };

    /**
     * WHAT EACH `step.until(…)` IS HANDED, one string per call.
     *
     * ⚠️ IT WAS A REGULAR EXPRESSION and it read the wrong thing: `[^)]*` stops at the FIRST
     * close paren, so `step.until(arriving.text(), since)` came back as `arriving.text(` — an
     * argument list with no comma in it, and the guard accused a driver that was correct. The
     * parens are walked instead, which is the only way to read a call whose arguments are
     * themselves calls.
     */
    const askedIn = (loop: string): string[] => {
      const asked: string[] = [];
      const call = 'step.until(';
      for (let at = loop.indexOf(call); at !== -1; at = loop.indexOf(call, at + 1)) {
        let depth = 1;
        let end = at + call.length;
        while (end < loop.length && depth > 0) {
          if (loop[end] === '(') depth += 1;
          if (loop[end] === ')') depth -= 1;
          end += 1;
        }
        asked.push(loop.slice(at + call.length, end - 1));
      }
      return asked;
    };

    for (const { name, source } of waiting) {
      const driving = drivingIn(source);
      // THE NUMBER IS READ OFF THE STREAM, and that is what the mutation broke: a driver that
      // assigned a constant satisfied every other reading of this rule.
      expect(driving, `${name}: the starting point is not read off the stream`).toContain(
        'const since = arriving.text().length;',
      );
      // AND THE READING COMES BEFORE THE DOING — the resize, the other process and the
      // keystroke are all the caller's own, so a number taken after any of them already
      // includes what the step caused.
      const read = driving.indexOf('const since = arriving.text().length;');
      for (const doing of ['resizedTo(device', 'await step.does()', 'stdin.write(']) {
        const at = driving.indexOf(doing);
        if (at === -1) continue;
        expect(read, `${name}: the starting point is taken after \`${doing}\``).toBeLessThan(at);
      }
      // AND EVERY QUESTION A STEP IS ASKED IS HANDED THE NUMBER, in the drivers that have steps.
      // Asked over the whole file rather than over the loop, and the difference is a real one this
      // guard's own non-vacuity check found: the shared instrument READS the number in its loop and
      // ASKS the question one function up ({@link endOf}), while the local driver that still has
      // steps of its own does both inline.
      const asking = askedIn(codeOnly(source));
      for (const asked of asking) {
        expect(asked, `${name}: a step was asked its question without where it began`).toContain(
          ', since',
        );
      }
      // ⚠️ AND NOTHING AFTER THE FIRST KEYSTROKE READS THE WHOLE STREAM. This is the half that
      // scored ZERO: reverting one driver's wait to the unscoped form left every other
      // reading of this rule satisfied — the number was still read, still before the writing,
      // and the rule was still imported. What is more, the compiler did not catch the local it
      // orphaned, because `tsc -b` does not type-check tests at all.
      //
      // A WAIT BEFORE THE CALLER HAS DONE ANYTHING MAY read the whole stream — that is how a
      // driver knows the console opened, and the opening is exactly what it is waiting for. A
      // wait AFTER may not, because by then the whole stream contains the opening.
      const typed = driving.indexOf('stdin.write(');
      if (typed !== -1) {
        for (const unscoped of ['arriving.text().includes(', 'terminal.bytes().includes(']) {
          expect(
            driving.slice(typed),
            `${name}: a wait after the first keystroke reads the whole stream`,
          ).not.toContain(unscoped);
        }
      }
    }
    // NOT VACUOUS, IN FOUR DIRECTIONS: the scope really would refuse a driver that read the
    // number nowhere, the walker really reads a call whose argument is itself a call, the
    // one-argument form really is told from the two-argument one, and the drivers that have
    // steps really were asked something — a walker that found nothing would have approved them
    // all in silence.
    expect(
      drivingIn('await theDeviceWasTheSizeAskedFor(x); child.stdin.write(k); } finally {'),
    ).not.toContain('const since =');
    expect(askedIn('step.until(now)')).toEqual(['now']);
    expect(askedIn('step.until(arriving.text(), since)')).toEqual(['arriving.text(), since']);
    // AND THE UNSCOPED-WAIT CHECK REALLY ACCUSES, on the exact shape it exists to refuse: a
    // read of the whole stream written after a keystroke.
    const wouldBeAccused = 'child.stdin.write(k); await until(() => arriving.text().includes(m));';
    expect(
      wouldBeAccused.slice(wouldBeAccused.indexOf('stdin.write(')),
      'the check cannot accuse the shape it exists for',
    ).toContain('arriving.text().includes(');
    expect(
      waiting
        .filter(({ source }) => askedIn(codeOnly(source)).length > 0)
        .map(({ name }) => name)
        .sort(),
      'the drivers that ask a step its question changed',
    ).toEqual([join('support', 'pty.ts')]);
  });
});

// ---------------------------------------------------------------------------
// The count: how much of the screen the console spends, and whether it FITS
// ---------------------------------------------------------------------------

/**
 * WHERE THE PAGE IS ON A SCREEN: the first row with anything on it, and the last.
 *
 * ⚠️ IT WAS ONE NUMBER — *how many rows from the top have anything on them* — and it was the
 * same as the page's own height for as long as the page was drawn from the top of the screen.
 * That is what the delivery which anchored the input at the FOOT falsified
 * (`repl/page.ts`, `tests/the-prompt-sits-at-the-foot.test.ts`): the page is placed with as
 * many blank rows as it takes for the input area to end on the last row the layout leaves, so
 * counting from the top answers *how tall the terminal is*, near enough, at every size. The
 * two rows are returned rather than the count, and every reading below says which end it
 * means — a count from the top cannot be written by accident any more.
 *
 * ⚠️ AND THE TWO ROWS ARE NO LONGER A HEIGHT EITHER, which the delivery that moved those blank
 * rows UNDER the box falsified in turn: they are between the page and the input now, so the
 * distance from the first drawn row to the last is the whole screen bar the row the layout keeps
 * — at every size, whatever is drawn. What the first row is still good for is whether the top of
 * the opening is on the screen at all; how much the console SPENDS is counted instead
 * ({@link openedAt}).
 */
function thePageOn(screen: { readonly rows: readonly string[] }): {
  readonly first: number;
  readonly last: number;
} {
  const drawn = screen.rows.map((row) => row.trim().length > 0);
  return { first: drawn.indexOf(true), last: drawn.lastIndexOf(true) };
}

/**
 * WHAT A CONSOLE OPENED AT A SIZE SHOWS: which of the drawings is on it, how many rows it
 * spends, and whether the whole of the opening is still on the screen.
 *
 * WHOLE IS THE PROMISE THIS FILE IS NAMED AFTER, and it is read off the first row the page
 * is DRAWN on rather than off a count: an opening taller than the screen loses its top, and its
 * top is the first row of the MARK. What the drawing is is asked of the module that draws it, so
 * a case cannot come to look for a glyph the art stopped using.
 *
 * ⚠️ IT WAS THE ROW THAT NAMES THE BUILD, and the frame is what made that the top: the version
 * was on the box's top border, so the highest row of the opening and the row naming the build
 * were one row. The build is beside the mark now — so the top is the art, and that the build is
 * on the screen at all is asked separately.
 *
 * ⚠️ AND BEFORE THAT IT WAS ROW ZERO, which the anchoring falsified: the rows above the page are
 * blank, so `rows[0]` is drawn on no terminal with room to spare and this read would answer
 * *cut* on every one of them ({@link thePageOn}).
 */
async function openedAt(
  columns: number,
  rows: number,
): Promise<{
  readonly drawing: readonly string[];
  readonly spent: number;
  readonly whole: boolean;
  readonly named: boolean;
}> {
  const ran = await inPty({ columns, rows, steps: [opens, leaves] });
  const screen = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
  expect(screen.text, `${columns}x${rows}: the session never opened`).toContain(PROMPT);
  // WHICH DRAWING IS ON THE SCREEN: the biggest one all of whose rows are, walked off the
  // module rather than recognised by a glyph — a case that looked for one glyph could not
  // tell the letterspaced form from the typed one.
  const drawing =
    everyForm().find((form) => form.every((row) => screen.text.includes(row.trimEnd()))) ??
    ([] as readonly string[]);
  const page = thePageOn(screen);
  return {
    drawing,
    // HOW MANY ROWS THE CONSOLE DRAWS ON, which is what it costs a reader.
    //
    // ⚠️ IT WAS THE DISTANCE FROM THE FIRST DRAWN ROW TO THE LAST, and that was the same number
    // for as long as the page and the input area were next to each other. The delivery that put
    // the emptiness BETWEEN them falsified it: corner to corner is the whole screen now, at
    // every size. Counted rather than spanned, the table below did not move by a row — which is
    // the finding, and it is the same one the anchoring produced: where the page sits has
    // changed twice now, and what it costs has not changed at all.
    spent: screen.rows.filter((row) => row.trim().length > 0).length,
    whole: drawing.length > 0 && (screen.rows[page.first] as string).includes(drawing[0] as string),
    // AND THE BUILD IS ON THE SCREEN, which used to be the same question as the one above and is
    // a second one now: a page cut at the bottom rather than at the top would keep its art.
    named: screen.text.includes(`v${VERSION}`),
  };
}

/**
 * WHAT THE CONSOLE SPENDS BEFORE THE CALLER HAS TYPED ANYTHING, at three sizes — measured
 * on a real terminal, and the number this delivery moves.
 *
 * `takes` is a MEASURING STICK: it is not derived from anything, so a delivery that adds a
 * row to the opening has to come here and say so, which is the whole point of writing it
 * down.
 *
 * ⚠️ THERE WAS A FOURTH COLUMN AND IT IS GONE. It held what the same measurement answered
 * before an earlier delivery, and every row asserted the count had gone DOWN. What falsified
 * it is the art: a drawing the name is asked for can be taller than the one before it, so on
 * a terminal with room for it the opening is BIGGER than it was, on purpose. The promise that
 * replaces "it got smaller" is the one the file is named after and the one a reader can
 * check — the opening FITS, whole, with the input area under it.
 *
 * ⚠️ AND THE COUNT MOVED IN BOTH DIRECTIONS AT ONCE, which is the achado of the delivery that
 * changed the drawing. The new art is SMALLER on both measurements — nine rows by fifty
 * columns against eleven by seventy — and *smaller art costs fewer rows* is nonetheless false:
 *
 *   - AT A HUNDRED AND TWENTY COLUMNS the box fits two columns again (the threshold is the
 *     content's, and it fell from 124 to 104), so the record's three rows are shared with the
 *     drawing's nine instead of added to them: 24 rows to 18.
 *   - AT EIGHTY BY TWENTY-FOUR the count went UP, 18 to 22, and the mechanism is the whole
 *     reason: eleven rows of art did not fit that screen and gave way to the five-row block,
 *     and nine rows DO fit. A terminal that used to be given the small drawing is given the
 *     big one. The opening is still whole and there is still a row over — what a reader loses
 *     is four rows of the record, and what they gain is the mark. It is a declared cost.
 *
 * ⚠️ AND THE DELIVERY THAT TOOK THE FRAME OFF MOVED EVERY ROW OF THE TABLE DOWN, which is the
 * first time it has moved in one direction. Measured on the same fixture with the output wiped on
 * both sides: 18 to 15 at a hundred and twenty by forty, and 22 to 20 at both of the others. Two
 * things account for it and they are worth separating, because only the first is rows the console
 * stopped drawing:
 *
 *   - THE BOX'S TWO EDGES AND ITS ARRANGEMENT. Beside the mark the panel is as tall as the taller
 *     of the drawing and the text, and the drawing is the taller: NINE rows of chrome, which is
 *     the height of the art and the floor under this whole table. Under the mark it is the art
 *     plus the text, one row less than it was — the bottom edge.
 *   - AND ONE ROW THAT IS STILL DRAWN AND IS NO LONGER COUNTED. The stacked arrangement has a
 *     margin over the record's section; with a border that row was `│ … │` and this count read it
 *     as drawn, and it is genuinely blank now. So one of the two rows at eighty by twenty-four is
 *     the console drawing less and the other is this instrument seeing what was always there.
 *
 * ⚠️ AND THE TWO SHORT SIZES FELL AGAIN, BY NINE AND BY EIGHT, while the tall one did not move
 * a row — which is the shape of this delivery in one table. What the arrangement at the top may
 * hold is a SHARE of the screen now (`repl/panel.ts`, `panelFor`), and a drawing whose
 * arrangement wants more than its share gives way to a smaller drawing (`repl/session.ts`, the
 * question `bannerFor` is asked). At eighty by twenty-four the nine-row art cost fifteen rows of
 * arrangement, which is more than a third of the screen, so the letterspaced name is drawn
 * instead and the whole opening costs eleven rows rather than twenty. At a hundred and twenty by
 * forty the art fits inside the share, nothing gives way, and the count is the one it has been
 * through three deliveries.
 *
 * ⚠️ AND WHAT THE LEFTOVER ROWS ARE HAS MOVED TWICE, while every number in the table stayed
 * put. They used to be the rows UNDER the page — screen a reader still had, which is what
 * "leaves" meant. The delivery that anchored the input at the foot spent them as blank rows
 * ABOVE it, and the one after that moved them UNDER THE BOX, which is where they are: between
 * what the page says and the row being typed (`repl/page.ts`). What is left over is the same
 * COUNT all three times and it has not been the same thing since the first: the room a session
 * has before it starts scrolling is nil once the page is anchored, since a page whose flow
 * reaches the foot scrolls on the next line said. That the table did not move through either
 * move is the finding: both changed where the page sits, and neither changed what it costs.
 *
 * The three sizes are the ordinary one (eighty by twenty-four, which is the size every
 * terminal has had since before they were on screens), a common laptop window, and a large
 * one — the last because a count that only held where the defect was measured is a count
 * that moved a case rather than the product.
 */
const THE_SCREEN: readonly { columns: number; rows: number; takes: number }[] = [
  { columns: 80, rows: 24, takes: 11 },
  { columns: 100, rows: 30, takes: 12 },
  { columns: 120, rows: 40, takes: 15 },
];

describe('the console spends only part of the screen it opens on', () => {
  for (const { columns, rows, takes } of THE_SCREEN) {
    it(`spends ${takes} rows of ${rows} at ${columns} columns, and leaves ${rows - takes}`, async () => {
      const opened = await openedAt(columns, rows);
      expect(opened.spent, `${columns}x${rows}: what the console spends`).toBe(takes);
      expect(rows - opened.spent, `${columns}x${rows}: what the page does not take`).toBe(
        rows - takes,
      );
      // AND IT FITS, which is what the count is for. Nothing of the opening is in the
      // scrollback before the caller has typed anything, and there is a row the layout can
      // keep — the boundary the input area is chosen by, asked of the whole page.
      expect(opened.whole, `${columns}x${rows}: the opening opened cut`).toBe(true);
      expect(opened.named, `${columns}x${rows}: the build is not on the screen`).toBe(true);
      expect(
        opened.spent,
        `${columns}x${rows}: the opening is taller than the screen`,
      ).toBeLessThan(rows);
    }, 180_000);
  }
});

// ---------------------------------------------------------------------------
// The art gives way so the opening fits, at heights a person's terminal has
// ---------------------------------------------------------------------------

/**
 * The heights a console is opened at, on an ordinary eighty-column terminal.
 *
 * They are HEIGHTS AND NOT THRESHOLDS: what is asserted below is a property of each of
 * them, and where one form gives way to the next is searched for rather than written here.
 * The shortest is the last one at which anything fits at all, which is a fact about this
 * product's own opening rather than about a terminal.
 *
 * ⚠️ THEY WERE 24, 19, 18 AND 15, and every one of them now draws the same thing — which is
 * what a delivery that moves a threshold does to a ladder written against the old one. The
 * drawing gives way when its ARRANGEMENT wants more than its share of the screen, and the share
 * is a third: at eighty columns the nine-row art needs a screen of forty-five rows to keep its
 * arrangement, the five-row art thirty-three, and the letterspaced name eighteen. So the ladder
 * is spread across the sizes those thresholds separate, and where each one is is still searched
 * for rather than written down ({@link theHeightItGivesWayAt}).
 */
const A_LADDER_OF_HEIGHTS: readonly number[] = [50, 40, 24, 16];

/**
 * THE SHORTEST SCREEN A GIVEN DRAWING IS STILL CHOSEN ON, at a width — searched by halving,
 * and `undefined` for a drawing this width never answers with.
 *
 * IT IS A SEARCH AND NOT A TABLE for the reason every threshold on this surface is searched
 * for: a number written here is a number that drifts away from the product the day the art or
 * the text beside it changes by a row. What makes halving honest is the property the case
 * asserts next to it — the ladder only ever gets simpler as the screen gets shorter — so
 * *is this screen at least as rich as that drawing* is monotone in the height.
 *
 * HOW RICH A DRAWING IS is its place in the module's own order, which is the same order the
 * width ladder is walked in ({@link everyForm}): the first is the biggest, and a page whose
 * drawing is earlier in that list is a page that answered with something richer.
 */
async function theHeightItGivesWayAt(
  drawing: readonly string[],
  columns: number,
): Promise<number | undefined> {
  const forms = everyForm();
  const wanted = forms.findIndex((form) => form.join('\n') === drawing.join('\n'));
  const richEnough = async (rows: number): Promise<boolean> => {
    const drawn = (await openedAt(columns, rows)).drawing;
    const at = forms.findIndex((form) => form.join('\n') === drawn.join('\n'));
    return at !== -1 && at <= wanted;
  };
  let low = 1;
  let high = 70;
  if (!(await richEnough(high))) return undefined;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (await richEnough(middle)) high = middle;
    else low = middle;
  }
  // AND IT IS THIS DRAWING RATHER THAN A RICHER ONE at the height found: the search is over
  // "at least as rich as", so the shortest screen for the biggest drawing is also a screen the
  // second one is never given.
  const drawn = (await openedAt(columns, high)).drawing;
  return drawn.join('\n') === drawing.join('\n') ? high : undefined;
}

describe('the drawing gives way so the page fits, rather than the page being cut', () => {
  it('never draws what the width alone allows, and the opening is whole at every height', async () => {
    // THE DEFECT THIS CLOSES, AND IT IS THE ONE THE PREVIOUS DELIVERY MEASURED: the name
    // gave way when the DRAWING was taller than the terminal, and no terminal is shorter
    // than a drawing — so the axis chose nothing and the opening was cut instead. What is
    // asserted here is the pair, at every height: the art the width alone would allow is NOT
    // what is drawn, and the whole opening is on the screen.
    const acrossEighty = drawnAcross(80);
    let gaveWay = 0;
    let smallest = Number.POSITIVE_INFINITY;
    for (const rows of A_LADDER_OF_HEIGHTS) {
      const opened = await openedAt(80, rows);
      expect(
        opened.drawing.length,
        `80x${rows}: no drawing at all is on the screen`,
      ).toBeGreaterThan(0);
      // THE OPENING IS WHOLE. This is the promise, and at three of these four heights the
      // product it was measured against opened with its own top already in the scrollback.
      expect(opened.whole, `80x${rows}: the opening opened cut`).toBe(true);
      if (opened.drawing.join('\n') !== acrossEighty.join('\n')) {
        gaveWay += 1;
        // AND THE OLD RULE WOULD HAVE KEPT IT, which is what makes this a change rather than
        // a restatement: the drawing the width allows is SHORTER than the terminal, so a
        // threshold that compared the drawing with the screen would have said yes.
        expect(
          acrossEighty.length,
          `80x${rows}: the old threshold would have given the art away here too`,
        ).toBeLessThanOrEqual(rows);
      }
      // AND THE LADDER GOES ONE WAY: a shorter terminal never gets a taller drawing.
      expect(
        opened.drawing.length,
        `80x${rows}: a shorter terminal got a taller drawing`,
      ).toBeLessThanOrEqual(smallest);
      smallest = opened.drawing.length;
    }
    // NOT VACUOUS IN EITHER DIRECTION: the art really gave way somewhere on the ladder, and
    // the ladder really moved — the drawing at the top of it is not the drawing at the
    // bottom, so this is not one answer asserted four times.
    expect(gaveWay, 'the art never gave way at any height on the ladder').toBeGreaterThan(0);
    expect(smallest, 'every height on the ladder drew the same drawing').toBeLessThan(
      (await openedAt(80, A_LADDER_OF_HEIGHTS[0] as number)).drawing.length,
    );
  }, 180_000);

  it('⛔ gives each drawing up at the height its own arrangement stops fitting in', async () => {
    // ⛔ THE AXIS THAT NEVER FIRED, EXERCISED. This module's own doc recorded the defect in as
    // many words — *the tallest form was five rows, `5 <= rows` is true on every terminal
    // anybody has, and the axis chose nothing at any size a person opens* — and the delivery
    // that answered it made the question *does the PAGE fit*, which a page whose arrangement had
    // already been given up answers YES to more easily than one that kept it. So the axis still
    // chose nothing, for a second reason, and there was no case here that could have said so.
    //
    // WHAT IT IS MEASURED AGAINST NOW is the arrangement's share of the screen: a drawing whose
    // arrangement would hold more than a third of the rows is a drawing this screen cannot
    // afford, whatever the page would cost with it gone (`repl/panel.ts`, `theShortestScreenFor`;
    // `repl/session.ts`, the question `bannerFor` is asked). That threshold fires at sizes people
    // really open, and this is the ladder it makes.
    //
    // SEARCHED, ONE ROW AT A TIME, AND NEVER WRITTEN DOWN — the same mould as the width ladder
    // above: at the height a drawing gives way at it is drawn, one row shorter it is not, and
    // the ladder only ever gets simpler as the screen gets shorter.
    const columns = 80;
    const ladder: { readonly drawing: readonly string[]; readonly at: number }[] = [];
    // EVERY DRAWING BUT THE FLOOR, which is the exception the width ladder makes for the same
    // reason: the name typed is answered at every height there is, including heights with no
    // room for an arrangement at all, because the one thing this banner exists to say may not be
    // dropped. Where the floor is answered is asserted under the loop instead.
    for (const form of everyForm().slice(0, -1)) {
      const at = await theHeightItGivesWayAt(form, columns);
      if (at === undefined) continue;
      ladder.push({ drawing: form, at });
      expect((await openedAt(columns, at)).drawing, `${at} rows`).toEqual(form);
      expect((await openedAt(columns, at - 1)).drawing, `${at - 1} rows`).not.toEqual(form);
    }
    // ⛔ MORE THAN ONE DRAWING IS REACHABLE BY THE HEIGHT ALONE, which is the whole of what was
    // missing: at one width, four heights, three different drawings. Before this delivery this
    // list would have had ONE entry — the biggest drawing, at the shortest screen that fits
    // anything at all — because nothing else could ever be chosen by a height.
    expect(ladder.length, 'the height chooses no drawing at any size').toBeGreaterThan(1);
    // AND THE LADDER GOES ONE WAY: a drawing further down the list gives way on a shorter
    // screen, so a taller terminal never gets a simpler drawing than a shorter one.
    for (let at = 1; at < ladder.length; at += 1) {
      expect(
        (ladder[at] as { at: number }).at,
        'a simpler drawing needs a taller screen than the one above it',
      ).toBeLessThan((ladder[at - 1] as { at: number }).at);
    }
    // AND THE FLOOR IS ANSWERED WHATEVER THE HEIGHT, which is what keeps the ladder total: the
    // name is still drawn on a screen too short for any arrangement at all.
    const tiny = await openedAt(columns, 10);
    expect(tiny.drawing.length, 'a screen too short for an arrangement drew nothing').toBe(1);
    expect(tiny.drawing.join('').toLowerCase(), 'the floor stopped saying the name').toContain(
      'mnema',
    );
  }, 300_000);

  it('draws the biggest form on a terminal with the room for it, and not on one without', async () => {
    // THE ELO FOR THE BIGGEST FORM, and the answer to the question an earlier delivery's
    // mechanism failed: does this one ever fire on a screen a person has? Both halves in one
    // case, at ONE width, so the only thing that moved between them is the height.
    //
    // ⚠️ AND IT IS THE OPPOSITE FAILURE TO WATCH FOR. A drawing that is never chosen is the
    // same defect as a threshold that never fires, so the case that says where it IS chosen
    // has to say where it is NOT beside it.
    //
    // ⚠️ THE SECOND HALF USED TO ASK AN ORDINARY TWENTY-FOUR-ROW TERMINAL, and the drawing is
    // what falsified that: nine rows of art fit a screen eleven did not, so a page a person
    // opens most often was on the side that KEPT the biggest form. The heights are a size and
    // its half rather than a threshold — where the form gives way is searched for in the ladder
    // above, one height at a time.
    //
    // ⚠️ AND BOTH SIZES MOVED WIDER, WHICH IS THE SAME CORRECTION SEEN FROM THE OTHER END. They
    // were a hundred columns, where the biggest art cannot stand BESIDE the text — the two
    // columns want a hundred and four — so its arrangement is the stacked one at fifteen rows,
    // and fifteen rows want a screen of forty-five to stay inside their share. A hundred and
    // twenty is a width where the biggest drawing costs nine rows rather than fifteen, so the
    // only thing that separates these two runs is the height, which is what the case says.
    const biggest = drawnAcross(WIDE);
    const roomy = await openedAt(120, 30);
    expect(roomy.drawing, 'the biggest drawing is on no terminal at all').toEqual(biggest);
    expect(roomy.whole, 'the biggest drawing opened cut').toBe(true);

    const ordinary = await openedAt(120, 24);
    expect(
      ordinary.drawing,
      'the biggest drawing was kept on a screen without the room',
    ).not.toEqual(biggest);
    expect(ordinary.whole, 'the opening opened cut once the art gave way').toBe(true);
    // Not vacuous: the two differ in HEIGHT alone, and the shorter one still draws something.
    expect(ordinary.drawing.length).toBeGreaterThan(0);
    expect(ordinary.drawing.length).toBeLessThan(biggest.length);
  }, 180_000);
});

// ---------------------------------------------------------------------------
// The caret opens where the caller is going to type
// ---------------------------------------------------------------------------

describe('the caret opens on the prompt, and the first keystroke does not move it there', () => {
  it('is on the row being typed before a key is pressed, and on the same row after one', async () => {
    // THE DEVICE THAT FOUND THE DEFECT. Measured at a hundred by thirty: the caret opened on
    // row 15 while the prompt was on row 12 — three rows below, where a terminal leaves it
    // after the last row of a frame — and the first keystroke corrected it. So the two
    // frames are compared WITH EACH OTHER: a case that only asked the opening could pass on
    // a console whose caret is wrong in the same way twice, and one that only asked the
    // frame after a key would have passed all along.
    const columns = 100;
    const rows = 30;
    const typed = 'v';
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        {
          types: typed,
          until: (bytes) => bytes.includes(`${AFTER_THE_PROMPT}${typed}`),
          what: 'echoed what was typed',
        },
        { types: CLEARS_THE_LINE, until: (bytes) => bytes.length > 0, what: 'abandoned the row' },
        leaves,
      ],
    });
    const at = (step: number) =>
      screenOf(ran.bytes.slice(0, ran.at[step] as number), columns, rows);
    const opening = at(0);
    const pressed = at(1);

    const promptRow = (screen: { readonly rows: readonly string[] }): number =>
      screen.rows.map((row) => row.includes(PROMPT)).lastIndexOf(true);
    expect(promptRow(opening), 'nothing on the opening is being typed on').toBeGreaterThan(0);

    // THE PROMISE: on both frames the caret is on the row the prompt is on, and it is just
    // past the prompt — where the caller's next character goes.
    expect(opening.cursor.row, 'the caret does not open on the prompt').toBe(promptRow(opening));
    expect(opening.cursor.column, 'the caret does not open past the prompt').toBe(
      [...AFTER_THE_PROMPT].length,
    );
    expect(pressed.cursor.row, 'the caret left the row after one key').toBe(promptRow(pressed));

    // AND THE TWO FRAMES AGREE, which is the discrepancy this case is made of: they used to
    // differ by exactly the rows the input area draws over the prompt.
    expect(pressed.cursor.row - promptRow(pressed)).toBe(opening.cursor.row - promptRow(opening));
    // Not vacuous: something really is drawn over the row being typed, so a caret left at
    // the end of the frame would have landed somewhere else.
    expect(promptRow(opening)).toBeGreaterThan(0);
    expect(thePageOn(opening).last).toBeGreaterThan(promptRow(opening));
  }, 180_000);
});

// ---------------------------------------------------------------------------
// What the box stopped saying is one keystroke away
// ---------------------------------------------------------------------------

describe('the word the box named is still there, behind the key that lists the words', () => {
  it('is nowhere on the opening, and on the screen as soon as the key is pressed', async () => {
    // WHAT THE SECOND SECTION TOOK WITH IT, asked as both halves in ONE run. The box used
    // to carry a section saying that a word lists the verbs; it was the third place this
    // console said so, and the only one a caller cannot get back to after ten reads. What
    // may not happen is the word becoming unreachable — so the same session is asked for it.
    const columns = 100;
    const rows = 40;
    const listed = theSessionsOwnWords().find((entry) => entry.word === ABOUT);
    expect(listed, `${ABOUT} is not one of the session's own words`).toBeDefined();
    const gloss = (listed as { description: string }).description;
    expect(gloss.length, 'the word has nothing to be listed with').toBeGreaterThan(3);

    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        {
          types: PREFIX,
          until: (bytes) => bytes.includes(gloss),
          what: 'listed the words the session answers to',
        },
        { types: CLEARS_THE_LINE, until: (bytes) => bytes.length > 0, what: 'abandoned the row' },
        leaves,
      ],
    });
    const opening = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
    const asked = screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, rows);

    // The instrument first: the opening really is on the screen.
    expect(opening.text, 'the session never opened').toContain(OPENED);
    // GONE FROM THE PAGE: neither the word nor the sentence the section said about it.
    expect(opening.text, `the opening still names ${ABOUT}`).not.toContain(ABOUT);
    expect(opening.text, 'the opening still carries the section').not.toContain(gloss);
    // AND ONE KEYSTROKE AWAY: the key the hint names opens the list, and the word is in it
    // with what it does beside it.
    expect(asked.text, `${PREFIX} did not list ${ABOUT}`).toContain(ABOUT);
    expect(asked.text, `${ABOUT} was listed without what it does`).toContain(gloss);
  }, 180_000);
});

// ---------------------------------------------------------------------------
// A1: everything that chooses an arrangement by the size of the terminal
// ---------------------------------------------------------------------------

/** Every `.ts` source of the product, recursively, tests excluded. */
function sourcesOf(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourcesOf(path));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

/** A source with its comments taken out, so prose cannot be read as code. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Whether a source RULES ON a measurement of the terminal — the discriminant, and it is a
 * comparison rather than a mention.
 *
 * Twenty-two modules of this surface name a width or a height; five decide something with
 * one. What tells them apart is the comparison itself: `<= columns` is a module asking
 * whether something fits, and every other mention is a module passing a number along.
 */
function rulesOnTheSize(source: string): boolean {
  return THE_COMPARISON.test(withoutComments(source));
}

/**
 * The comparison itself: an operator, then a measurement of the terminal.
 *
 * ⚠️ IT USED TO BEGIN `(<=|<|>=|>)` AND IT ACCUSED AN ARROW. `=> rows + 1` is a fat arrow
 * followed by an accumulator, and the `>` of it read as a module ruling on a height — the
 * panel started counting the rows an opening takes in this delivery, and the scan named it
 * as a fifth place that DECIDES by one. An instrument that accuses is the other half of an
 * instrument that stays silent, and this bench has had both. So the operator may not be the
 * tail of `=>` or of `!=`, and the two shapes are asserted below.
 */
const AN_OPERATOR = String.raw`(?<![=!])(?:<=|<|>=|>)\s*(?:request\.)?`;
const THE_COMPARISON = new RegExp(`${AN_OPERATOR}(?:columns|rows)\\b`);

describe('everything that chooses a shape by the size of the terminal is one of five', () => {
  it('is these five modules, and a sixth would be accused', () => {
    // A1, BY THE DISCRIMINANT AND NOT BY A LIST FROM A HANDOFF. The rule this delivery
    // extends — *a form gives way at its own measurement, never at a number somebody chose*
    // — is applied in more than one place, so the places are FOUND rather than recalled.
    //
    // ⚠️ THE FOURTH IS THE ACHADO. The design of this delivery counted three: the name by
    // width, the panel by width, the input area by height. The palette is the fourth, and
    // it rules the same way — a row the terminal would fold is not drawn, and the threshold
    // is the row's own width.
    //
    // Each has a case that pins its threshold to the content:
    //   - `presentation/banner.ts`  — width: `the-name-and-the-hints.test.ts`; height: here.
    //   - `repl/panel.ts`           — `the-panel.test.ts`, at the width its content stops
    //                                  fitting at, and one column under it.
    //   - `repl/area.ts`            — `the-input-has-its-own-place.test.ts`, the ladder and
    //                                  the boundary that moves with the hint's own width.
    //   - `repl/palette.ts`         — `a-palette-for-the-words.test.ts`, over a grid of
    //                                  every room and every width.
    //
    // ⚠️ AND THE FIFTH IS THE ACHADO OF THE DELIVERY AFTER THIS ONE, found by this scan
    // rather than by anybody's list: `presentation/folded.ts`, the renderer that folds a
    // line to the terminal. It rules twice and both thresholds are the same rule again —
    // a row gives way when it is wider than the screen, and the hanging INDENT gives way
    // when there is no room for anything beside it — so it is the family this case is
    // about rather than an exception to it. Pinned by `presentation/folded.test.ts`: a
    // line as wide as the terminal comes out byte for byte, one column wider folds, and a
    // depth wider than the window drops the indent instead of losing the text.
    const ruling = sourcesOf(SRC)
      .filter((file) => rulesOnTheSize(readFileSync(file, 'utf-8')))
      .map((file) => file.slice(SRC.length + 1))
      .sort();
    expect(ruling).toEqual(
      [
        join('presentation', 'banner.ts'),
        join('presentation', 'folded.ts'),
        join('repl', 'area.ts'),
        join('repl', 'palette.ts'),
        join('repl', 'panel.ts'),
      ].sort(),
    );
    // The scan read something, and it would accuse a fifth module: the line somebody would
    // write to add one, and the two shapes that must NOT be accused — a module that only
    // carries a size, and prose about one.
    expect(sourcesOf(SRC).length).toBeGreaterThan(50);
    expect(rulesOnTheSize('const form = widthOf(drawing) <= columns ? drawing : nothing;')).toBe(
      true,
    );
    expect(rulesOnTheSize('const area = areaFor({ rows, columns, badge: 0 });')).toBe(false);
    expect(rulesOnTheSize('/* a form gives way when it is wider than columns */')).toBe(false);
    // AND THE THIRD SHAPE, which this delivery had to add because the scan accused it: an
    // arrow whose answer is named after a measurement is a module COUNTING, not deciding.
    expect(rulesOnTheSize('lines.reduce((rows, line) => rows + one(line), 0);')).toBe(false);
    expect(rulesOnTheSize('const tall = (): number => rows;')).toBe(false);
  });

  it('and two of them rule on both: the name, and the arrangement it is drawn in', () => {
    // ⚠️ THIS CASE WAS `AND THE NAME IS THE ONLY ONE THAT RULES ON BOTH`, and it asserted in as
    // many words that the panel did NOT rule on a height. The reason given was that the name is
    // "the one drawing that is neither reflowed nor scrolled" — and the panel is the other one.
    // WHAT FALSIFIED IT IS WHERE THE ARRANGEMENT ENDED UP: it is the fixed region at the top of
    // the screen, redrawn on every frame and never scrolled, so its rows are rows the session's
    // answers can never be given. Measured on this surface's own fixture at eighty by
    // twenty-four: fifteen rows of arrangement, five of input area, four left — and `/help`
    // showed the last four rows of what it printed with none of the verbs on the screen.
    //
    // SO THE PROPERTY IS THE PAIR RATHER THAN THE ONE, and it is still a property of the source:
    // the two things that are DRAWN AND HELD rule on both measurements, and the two that are
    // reflowed with what they are in — the input area's arrangement and the fold — rule on the
    // one they are cut by. The thresholds are different kinds and each says which it is: the
    // name and the fold give way at their own measurement, and the arrangement gives way across
    // at its content's width and down at a SHARE of the screen (`repl/panel.ts`, `A_THIRD`),
    // because nothing down there folds or is cut and no measurement of the drawing answers *how
    // much of a caller's screen may this hold for ever*.
    //
    // ONE SPELLING OF THE OPERATOR, shared with the scan above: two regular expressions for
    // one rule is how the pair comes to disagree, and this one already did — the scan was
    // taught not to accuse a fat arrow and this copy was not.
    const rulesOn = (file: string, what: 'columns' | 'rows'): boolean =>
      new RegExp(`${AN_OPERATOR}${what}\\b`).test(
        withoutComments(readFileSync(join(SRC, file), 'utf-8')),
      );
    const banner = join('presentation', 'banner.ts');
    const panel = join('repl', 'panel.ts');
    expect(rulesOn(banner, 'columns'), 'the name stopped ruling on the width').toBe(true);
    expect(rulesOn(banner, 'rows'), 'the name does not rule on the height').toBe(true);
    expect(rulesOn(panel, 'columns'), 'the arrangement stopped ruling on the width').toBe(true);
    expect(rulesOn(panel, 'rows'), 'the arrangement does not rule on the height').toBe(true);
    // AND THE OTHER THREE SPELL ONE MEASUREMENT EACH, which is what keeps the sentence above a
    // distinction rather than a list: a case that only named the two would be satisfied by every
    // module on this surface learning a second axis.
    //
    // ⛔ WHAT THIS SCAN SEES IS A MEASUREMENT NAMED IN THE COMPARISON, never a rule about one.
    // The input area really does give way by height — it is the reason it has forms at all — and
    // it is spelled against what is LEFT of the screen under the region above (`repl/area.ts`,
    // `within`), which no pattern over the words `columns` and `rows` can find. So the three
    // below are asserted as what they SPELL, and the instrument's own blindness is written here
    // rather than left for a reader to mistake for a finding.
    for (const one of [
      join('repl', 'area.ts'),
      join('repl', 'palette.ts'),
      join('presentation', 'folded.ts'),
    ]) {
      expect(rulesOn(one, 'columns'), `${one}: stopped spelling a rule on the width`).toBe(true);
      expect(rulesOn(one, 'rows'), `${one}: spells a rule on the height`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// The drawing is what the page follows: nothing on the panel is a rule
// ---------------------------------------------------------------------------

describe('the panel has one section in it, and the art is the only thing drawn', () => {
  it('holds no run of glyphs of its own on an ordinary terminal', async () => {
    // THE OTHER HALF OF WHAT THE SECOND SECTION TOOK: the rule that divided it from the
    // record. It measured its SIBLINGS rather than the column it looked like it divided —
    // 45 columns inside a column of 61, measured at 120 — and it went with the section
    // rather than being fixed, because one section has nothing to be divided from.
    //
    // Asked at eighty columns, where the text is UNDER the mark and the drawing of the name is
    // the only run of glyphs the panel draws. `tests/the-page-follows-the-terminal.test.ts` asks
    // the same thing of the arrangement that puts the text beside it.
    //
    // ⚠️ THE ROWS USED TO BE FOUND BY THE FRAME — every row beginning with the box's side — and
    // each was read between its two ends. There is no frame: the rows are the ones between the
    // top of the screen and the sentence the session lands under the panel, and they are read
    // whole. Which also means the two rules the INPUT area draws have to be outside them, and
    // they are: the sentence is above the emptiness and the rules are below it.
    const columns = 80;
    const rows = 24;
    const ran = await inPty({ columns, rows, steps: [opens, leaves] });
    const screen = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
    expect(screen.text, 'the session never opened').toContain(OPENED);
    const under = screen.rows.findIndex((row) => row.includes(UNDER_THE_PANEL));
    expect(under, 'no sentence under the panel').toBeGreaterThan(0);
    const opening = screen.rows.slice(0, under);
    expect(opening.length, 'the opening has no rows').toBeGreaterThan(3);
    for (const row of opening) {
      expect(
        [...row].some((glyph) => glyph === RUN),
        `a run of glyphs is drawn in the opening: ${row}`,
      ).toBe(false);
    }
    // Not vacuous, in two directions: the art really is in those rows, so what is being read is
    // the panel's — and the page really does draw a run somewhere, which is the input area's.
    //
    // ⚠️ THE ART WAS FOUND BY ITS INK, and a glyph is what this file's own header warns against
    // looking for: *a case that looked for one glyph could not tell the letterspaced form from
    // the typed one*. At this size the console draws the letterspaced name now — the nine-row
    // art's arrangement wants more than its share of twenty-four rows (`repl/panel.ts`) — and
    // there is not a block on the page. Which drawing it is is asked of the module that draws
    // them, so no case here has to know.
    const drawn = everyForm().find((form) =>
      form.every((row) => opening.some((page) => page.includes(row))),
    );
    expect(drawn, 'no drawing of the name is in the opening').toBeDefined();
    expect(
      screen.rows.slice(under).some((row) => [...row.trim()].every((glyph) => glyph === RUN)),
      'the input area drew no rule at all',
    ).toBe(true);
  }, 180_000);
});
