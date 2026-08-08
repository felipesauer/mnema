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
  inPty as drive,
  endOf,
  type Fixture,
  opensAConsole,
  type Ran,
  type Step,
} from './support/pty.js';
import { screenOf } from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
/** `packages/code/src`, for the guard that reads the surface's own source. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** What the opening always says, whatever the terminal is like. */
const OPENED = 'a session over this project';
/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';
/** The caret's home: the prompt and the space after it, which is what a caller types past. */
const AFTER_THE_PROMPT = `${PROMPT} `;

/**
 * The glyphs the drawing is made of: the ink of the tall form, the box's side, and the run
 * a rule is made of.
 *
 * Named by their code points rather than typed, like every other unusual byte in this
 * repository's sources: a rule is one keystroke away from a pipe and a run from a hyphen,
 * and a character a reader cannot tell from a neighbouring one is a character an edit
 * destroys without anybody seeing it happen. A raw Ctrl-C got into the first draft of this
 * very file, which is the twenty-fourth time on this bench.
 */
const INK = '\u2588';
const RISING = '\u2571';
const FALLING = '\u2572';
const UPRIGHT = '\u2502';
const FRAME = '\u2502';
const RUN = '\u2500';

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
 * What an ASCII mark is inked as — the same four substitutions the module makes, spelled
 * here by code point for the reason the module spells them: a glyph a reader cannot tell
 * from its neighbour is a glyph an edit destroys without anybody seeing it happen. The
 * first is the file's own {@link INK}, so the two cannot come to name different blocks.
 */
const INKS: readonly (readonly [string, string])[] = [
  ['#', INK],
  ['/', RISING],
  ['\\', FALLING],
  ['|', UPRIGHT],
];

/** The four glyphs a drawing may hold, and nothing else may. */
const GLYPHS: readonly string[] = INKS.map(([, glyph]) => glyph);

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
    // AND THE ISOMETRIC ONE JOINED WITHOUT PUSHING THE FIVE-ROW ONE OUT. The band between
    // them is what a form covers, so the second is the one an ordinary terminal gets: it is
    // narrower than the widest and wider than the letterspacing, and a delivery that
    // replaced rather than added would leave nothing between them.
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

  it('never pads a row at its end, and inks nothing but the four named glyphs', () => {
    // TWO PROPERTIES THE REST OF THE SURFACE DEPENDS ON, and neither is visible to a reader.
    //
    //   - NO ROW ENDS IN A BLANK. The layout trims the end of every row it writes, so a form
    //     padded on the right would arrive somewhere narrower than the arithmetic that chose
    //     it thinks it is — and the generator the isometric drawing came from pads.
    //   - EVERY GLYPH IS ASCII OR ONE OF THE FOUR. The masks in the source are ASCII to the
    //     byte and the substitutions are named by code point, so a drawing that came back
    //     with a fifth unusual character is a character somebody typed into a mask.
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
 * THE ART, AS A SECOND COPY — the eleven rows of the biggest drawing, as the mask a person
 * edits.
 *
 * ⚠️ IT IS A GOLDEN AND IT IS HERE BECAUSE A ROUND TRIP COULD NOT BE ONE. The mask in the
 * source and the drawing that comes back are ONE artifact: the second is the first with four
 * substitutions made, so a mark changed in the mask changes both and they go on agreeing.
 * Measured rather than reasoned — a mutation that turned one stroke of the first letter
 * round left the whole suite green. What makes an edit to the art LOUD is a copy that does
 * not derive from it, and the copy is ASCII for the same reason the mask is: a reader sees
 * the shape, and a diff shows which stroke moved.
 *
 * Changing the drawing is meant to change this. That is the whole of what it is for.
 */
const THE_BIGGEST_DRAWING: readonly string[] = [
  '      ___           ___           ___           ___           ___',
  '     /  /\\         /  /\\         /  /\\         /  /\\         /  /\\',
  '    /  /::|       /  /::|       /  /::\\       /  /::|       /  /::\\',
  '   /  /:|:|      /  /:|:|      /  /:/\\:\\     /  /:|:|      /  /:/\\:\\',
  '  /  /:/|:|__   /  /:/|:|__   /  /::\\ \\:\\   /  /:/|:|__   /  /::\\ \\:\\',
  ' /__/:/_|::::\\ /__/:/ |:| /\\ /__/:/\\:\\ \\:\\ /__/:/_|::::\\ /__/:/\\:\\_\\:\\',
  ' \\__\\/  /~~/:/ \\__\\/  |:|/:/ \\  \\:\\ \\:\\_\\/ \\__\\/  /~~/:/ \\__\\/  \\:\\/:/',
  '       /  /:/      |  |:/:/   \\  \\:\\ \\:\\         /  /:/       \\__\\::/',
  '      /  /:/       |__|::/     \\  \\:\\_\\/        /  /:/        /  /:/',
  '     /__/:/        /__/:/       \\  \\:\\         /__/:/        /__/:/',
  '     \\__\\/         \\__\\/         \\__\\/         \\__\\/         \\__\\/',
];

describe('the drawing is the mask inked, and the mask is ASCII', () => {
  it('reconstructs every drawing from the mask beside it, byte for byte', () => {
    const masks = masksIn(readFileSync(BANNER, 'utf-8'));
    const forms = everyForm();
    // The instrument first: as many masks were found as there are drawings, in the same
    // order — a regular expression that matched nothing would otherwise pass this whole case
    // by having nothing to compare.
    expect(masks, 'the masks were not found in the source').toHaveLength(forms.length);

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
      // this goes red, and so does a drawing that stopped being made of its mask.
      const inked = mask.map((row) =>
        INKS.reduce((drawing, [mark, glyph]) => drawing.split(mark).join(glyph), row),
      );
      expect(inked, `mask ${at} does not draw form ${at}`).toEqual(forms[at]);
    }
  });

  it('draws the art this file has a copy of, stroke for stroke', () => {
    // THE ONE ASSERTION THE ROUND TRIP ABOVE CANNOT MAKE. Both sides of it come out of the
    // same mask, so a mark changed in the source changes both — measured, and the suite
    // stayed green. This compares the drawing with a copy that derives from nothing.
    const biggest = everyForm()[0] as readonly string[];
    expect(biggest, 'the biggest drawing is not the art this file has a copy of').toEqual(
      THE_BIGGEST_DRAWING.map((row) =>
        INKS.reduce((drawing, [mark, glyph]) => drawing.split(mark).join(glyph), row),
      ),
    );
    // Not vacuous: the copy really is the biggest form and not, say, the floor.
    expect(biggest.length).toBe(THE_BIGGEST_DRAWING.length);
    expect(biggest.length).toBeGreaterThan(1);
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
    expect(INKS.reduce((row, [mark, glyph]) => row.split(mark).join(glyph), '#/\\|')).not.toBe(
      '#/\\|',
    );
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
});

// ---------------------------------------------------------------------------
// The count: how much of the screen the console spends, and whether it FITS
// ---------------------------------------------------------------------------

/** How many rows from the top of a screen have anything on them. */
function rowsDrawn(screen: { readonly rows: readonly string[] }): number {
  return screen.rows.map((row) => row.trim().length > 0).lastIndexOf(true) + 1;
}

/**
 * WHAT A CONSOLE OPENED AT A SIZE SHOWS: which of the drawings is on it, how many rows it
 * spends, and whether the whole of the opening is still on the screen.
 *
 * WHOLE IS THE PROMISE THIS FILE IS NAMED AFTER, and it is read off the FIRST row rather
 * than off a count: an opening taller than the screen loses its top, and its top is the
 * title. What the title is is asked of the product — it is the only line of the opening that
 * names the build — so a case cannot come to look for a sentence the session stopped
 * saying.
 */
async function openedAt(
  columns: number,
  rows: number,
): Promise<{
  readonly drawing: readonly string[];
  readonly spent: number;
  readonly whole: boolean;
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
  return {
    drawing,
    spent: rowsDrawn(screen),
    whole: (screen.rows[0] as string).includes(`v${VERSION}`),
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
 * before the previous delivery, and every row asserted the count had gone DOWN. What
 * falsified it is this one: the drawing the name was asked for is eleven rows tall, so on a
 * terminal with room for it the opening is BIGGER than it was, on purpose. The promise that
 * replaces "it got smaller" is the one the file is named after and the one a reader can
 * check — the opening FITS, whole, with the input area under it.
 *
 * The three sizes are the ordinary one (eighty by twenty-four, which is the size every
 * terminal has had since before they were on screens), a common laptop window, and a large
 * one — the last because a count that only held where the defect was measured is a count
 * that moved a case rather than the product.
 */
const THE_SCREEN: readonly { columns: number; rows: number; takes: number }[] = [
  { columns: 80, rows: 24, takes: 18 },
  { columns: 100, rows: 30, takes: 24 },
  { columns: 120, rows: 40, takes: 24 },
];

describe('the console leaves the screen to the record it was opened over', () => {
  for (const { columns, rows, takes } of THE_SCREEN) {
    it(`spends ${takes} rows of ${rows} at ${columns} columns, and leaves ${rows - takes}`, async () => {
      const opened = await openedAt(columns, rows);
      expect(opened.spent, `${columns}x${rows}: what the console spends`).toBe(takes);
      expect(rows - opened.spent, `${columns}x${rows}: what is left for the record`).toBe(
        rows - takes,
      );
      // AND IT FITS, which is what the count is for. Nothing of the opening is in the
      // scrollback before the caller has typed anything, and there is a row the layout can
      // keep — the boundary the input area is chosen by, asked of the whole page.
      expect(opened.whole, `${columns}x${rows}: the opening opened cut`).toBe(true);
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
 */
const A_LADDER_OF_HEIGHTS: readonly number[] = [24, 19, 18, 15];

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

  it('draws the biggest form on a terminal with the room for it, and not on one without', async () => {
    // THE ELO FOR THE FOURTH FORM, and the answer to the question the previous delivery's
    // mechanism failed: does this one ever fire on a screen a person has? Both halves in one
    // case, at ONE width, so the only thing that moved between them is the height.
    //
    // ⚠️ AND IT IS THE OPPOSITE FAILURE TO WATCH FOR. A drawing that is never chosen is the
    // same defect as a threshold that never fires, so the case that says where it IS chosen
    // has to say where it is NOT beside it.
    const biggest = drawnAcross(WIDE);
    const roomy = await openedAt(100, 30);
    expect(roomy.drawing, 'the biggest drawing is on no terminal at all').toEqual(biggest);
    expect(roomy.whole, 'the biggest drawing opened cut').toBe(true);

    const ordinary = await openedAt(100, 24);
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
    expect(rowsDrawn(opening)).toBeGreaterThan(promptRow(opening));
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

  it('and the name is the only one that rules on both', () => {
    // WHAT THIS DELIVERY CHANGED, said as a property of the source: the panel rules on a
    // width, the area and the palette on what they were already ruling on, and the name is
    // the one place that had to learn a second measurement — because it is the one drawing
    // that is neither reflowed nor scrolled.
    // ONE SPELLING OF THE OPERATOR, shared with the scan above: two regular expressions for
    // one rule is how the pair comes to disagree, and this one already did — the scan was
    // taught not to accuse a fat arrow and this copy was not.
    const rulesOn = (file: string, what: 'columns' | 'rows'): boolean =>
      new RegExp(`${AN_OPERATOR}${what}\\b`).test(
        withoutComments(readFileSync(join(SRC, file), 'utf-8')),
      );
    const banner = join('presentation', 'banner.ts');
    expect(rulesOn(banner, 'columns'), 'the name stopped ruling on the width').toBe(true);
    expect(rulesOn(banner, 'rows'), 'the name does not rule on the height').toBe(true);
    expect(rulesOn(join('repl', 'panel.ts'), 'rows'), 'the panel started ruling on height').toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// The drawing is what the page follows: nothing is drawn inside the box
// ---------------------------------------------------------------------------

describe('the box has one section in it, and the art is the only thing drawn', () => {
  it('holds no run of glyphs of its own on an ordinary terminal', async () => {
    // THE OTHER HALF OF WHAT THE SECOND SECTION TOOK: the rule that divided it from the
    // record. It measured its SIBLINGS rather than the column it looked like it divided —
    // 45 columns inside a column of 61, measured at 120 — and it went with the section
    // rather than being fixed, because one section has nothing to be divided from.
    //
    // Asked at eighty columns, where the box is STACKED and the drawing of the name is the
    // only run of glyphs inside the frame. `tests/the-page-follows-the-terminal.test.ts`
    // asks the same thing of the two-column form.
    const columns = 80;
    const rows = 24;
    const ran = await inPty({ columns, rows, steps: [opens, leaves] });
    const screen = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
    expect(screen.text, 'the session never opened').toContain(OPENED);
    // Every row of the box, which is every row between the frame's two ends.
    const inside = screen.rows.filter((row) => row.startsWith(FRAME));
    expect(inside.length, 'the box has no rows').toBeGreaterThan(3);
    for (const row of inside) {
      const middle = row.slice(1, -1);
      expect(
        [...middle].some((glyph) => glyph === RUN),
        `a run of glyphs is drawn inside the box: ${row}`,
      ).toBe(false);
    }
    // Not vacuous: the art really is inside the box, so the rows being read are the box's.
    expect(
      inside.some((row) => row.includes(INK)),
      'the mark is not inside the box',
    ).toBe(true);
  }, 180_000);
});
