/**
 * THE RED SAYS WHAT HAPPENED — the instrument accusing itself before it accuses the
 * product.
 *
 * IT CAME OUT OF A FLAKE THAT COST THREE REVIEWS. Cases of this surface went red in the
 * whole suite and green on their own, always with an ASSERTION and never with a timeout,
 * and always by ONE ROW: `expected 22 to be 21`, `expected 25 to be 24`, the row above the
 * prompt not being a rule. An off-by-one is what a reader gets; what produced it is not in
 * the message, and three deliveries in a row paid to find that out again.
 *
 * WHAT A REPLAY ASSUMES, AND NEVER CHECKED. A case drives the built binary on a
 * pseudo-terminal it asked to be a certain size, and then replays the bytes onto a screen
 * of THAT size (`support/screen.ts`). Two different numbers are at work: the one the case
 * asked for, and the one the process read off the device. Nothing compared them. When they
 * differ, every row under the first thing that folds is out — and the case fails on the
 * count, which mentions no size at all.
 *
 * SO THE PREMISES ARE ASSERTED WHERE THEY ARE USED, and there are three of them:
 *
 *   - THE DEVICE BECAME THE SIZE THE CASE ASKED FOR (`support/pty.ts`). The only place a
 *     HEIGHT is observable — nothing draws one.
 *   - THE PAGE WAS DRAWN AT THE WIDTH IT IS BEING READ AT (`support/screen.ts`). The box is
 *     drawn corner to corner and the rules run the whole way across, so the width is ON the
 *     page; it is measured off the drawing rather than taken from the number that was asked
 *     for, which is what makes the two comparable at all.
 *   - THE MODEL PERFORMED EVERY SEQUENCE IT WAS GIVEN. A scroll it did not perform is a
 *     page one row out, silently.
 *
 * NOTHING HERE IS ABOUT THE PRODUCT. Every case below is built out of bytes composed by
 * hand, because a race does not answer a single run and the arithmetic does.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sizedTo, theDeviceWasTheSizeAskedFor } from './support/pty.js';
import { everyWidthDrawnOn, screenOf } from './support/screen.js';

/** `packages/code/tests`, for the guard that reads the instrument's own callers. */
const TESTS = fileURLToPath(new URL('.', import.meta.url));

/**
 * One escape byte and one bell, spelled as escapes so that no control byte enters a
 * source file — the same reason every other unusual byte in this repository is spelled
 * that way, and the first draft of this very file had two raw ones in it.
 */
const ESC = '\u001b';
const BELL = '\u0007';

/**
 * The glyphs a frame is drawn with, spelled by code point — like every other unusual byte
 * in this repository's sources, and for the reason `support/screen.ts` gives where it names
 * the same four: a corner is one keystroke away from its mirror.
 */
const TOP_LEFT = '\u256d';
const TOP_RIGHT = '\u256e';
const BOTTOM_LEFT = '\u2570';
const BOTTOM_RIGHT = '\u256f';
const RUN = '\u2500';

/**
 * A CONSOLE'S PAGE, AS BYTES, DRAWN AT A GIVEN WIDTH — the smallest thing that has the two
 * shapes the measurement is made of.
 *
 * The box, corner to corner with a title cutting its top edge in two, and a rule under it
 * with no corners at all. It is the drawing this product opens with, reduced to what is
 * being measured: a delivery that changed the box would change this, which is the point.
 */
function aPageDrawn(columns: number): string {
  const title = ' a session ';
  const top = TOP_LEFT + RUN + title + RUN.repeat(columns - 3 - title.length) + TOP_RIGHT;
  const bottom = BOTTOM_LEFT + RUN.repeat(columns - 2) + BOTTOM_RIGHT;
  const rule = RUN.repeat(columns);
  return [top, bottom, rule, 'mnema>', rule].join('\r\n');
}

/**
 * A DRAWN PAGE, PUT ON A SCREEN OF A GIVEN WIDTH — padded when it is narrower than one and
 * WRAPPED when it is wider, which is what a terminal does with a row that does not stop.
 *
 * A FIXTURE AND NOT A SECOND MODEL, and the difference matters: {@link screenOf} refuses a
 * page drawn at a width it is not being read at, which is the whole point of it — so the
 * cases that measure the disagreement cannot go through it, and lay the rows out here
 * instead. It is four lines because that is all a screen of blanks is.
 */
function laidOutOn(page: string, columns: number): readonly string[] {
  const rows: string[] = [];
  for (const line of page.split('\r\n')) {
    for (let at = 0; at < line.length || at === 0; at += columns) {
      rows.push(line.slice(at, at + columns).padEnd(columns, ' '));
    }
  }
  return rows;
}

describe('a screen says what width it was drawn at, and refuses to be read at another', () => {
  it('accuses a page drawn at 120 and replayed at 110, and names both numbers', () => {
    // THE WHOLE POINT, ON BYTES BUILT BY HAND. A race does not answer a single run — that
    // is why the flake this closes survived three deliveries — but the arithmetic does: a
    // page 120 columns across, read onto a screen 110 wide, is a page whose every row folds
    // and whose every count is out. What comes back has to be that sentence and not a
    // number.
    let said = '';
    try {
      screenOf(aPageDrawn(120), 110, 40);
    } catch (accused) {
      said = (accused as Error).message;
    }
    expect(said, 'a screen replayed at the wrong width said nothing').not.toBe('');
    expect(said, 'the accusation does not say what the screen was read at').toContain('110');
    expect(said, 'the accusation does not say what the page was drawn at').toContain('120');
    // AND IT SAYS WHICH OF THE TWO THINGS WENT WRONG, which is the difference between a
    // diagnosis and a puzzle: the device's own size is answered somewhere else, and the
    // message says where, so a reader knows which half to look at.
    expect(said, 'the accusation does not send the reader to the other half').toContain('pty.ts');
    expect(said, 'the accusation lets the off-by-one read as the finding').toContain('SYMPTOM');
  });

  it('says nothing about a page drawn at the width it is read at', () => {
    // THE OTHER SIDE, and without it the case above passes on an instrument that accuses
    // every screen there is.
    expect(() => screenOf(aPageDrawn(110), 110, 40)).not.toThrow();
    expect(() => screenOf(aPageDrawn(80), 80, 24)).not.toThrow();
  });

  it('measures the drawing rather than the number it was asked for', () => {
    // ⚠️ THE MUTATION THIS CASE IS THE OTHER HALF OF: a measurement that answered `columns`
    // would agree with the replay about every page there is, and the guard above would be
    // vacuous while looking exactly the same. So the measurement is asked to MOVE while the
    // screen it is read on stands still — the box is drawn one column narrower, and the
    // answer follows the box.
    const wide = everyWidthDrawnOn(laidOutOn(aPageDrawn(90), 200));
    const narrower = everyWidthDrawnOn(laidOutOn(aPageDrawn(89), 200));
    expect(wide, 'the measurement is not the drawing').toContain(90);
    expect(narrower, 'the measurement did not follow the drawing').toContain(89);
    expect(wide, 'the measurement answers two widths for one drawing').not.toContain(89);
    // And it is not the screen's number either, which is the same for both.
    expect(wide, 'the measurement is the number it was asked for').not.toContain(200);
  });

  it('reads a frame WIDER than the screen, off the row it carried on to', () => {
    // THE DIRECTION A REPLAY HIDES. A page narrower than the screen ends in blanks and is
    // easy to see; one WIDER than it does not stop at the edge — it carries on at the first
    // column of the row below, which is what a terminal does. Measured across the fold, so
    // the guard catches the case where the process thought it had MORE room than the case
    // gave it, which is the direction that folds every row under it.
    const drawn = everyWidthDrawnOn(laidOutOn(aPageDrawn(130), 100));
    expect(drawn, 'a frame wider than the screen was not measured').toContain(130);
    // Not vacuous: the drawing really did fold, so this was read across a row boundary.
    expect(laidOutOn(aPageDrawn(130), 100).length).toBeGreaterThan(
      aPageDrawn(130).split('\r\n').length,
    );
  });

  it('counts an edge the title cuts in two as no width at all', () => {
    // THE WRONG WITNESS IS WORSE THAN NONE. The box's TOP edge is a run, a title, and
    // another run — two runs that are each SHORTER than the terminal. Counted, they would
    // be widths nothing was drawn at, and one of them landing on the replay's own number
    // would silence a true accusation for good.
    const drawn = everyWidthDrawnOn(screenOf(aPageDrawn(120), 120, 10).rows);
    expect(drawn, 'a page with a box measured nothing').not.toHaveLength(0);
    for (const width of drawn) expect(width, `a partial edge was counted as ${width}`).toBe(120);
  });

  it('says nothing about a page with no frame on it', () => {
    // A SCREEN THE BOX HAS SCROLLED OFF says nothing about a width, and an instrument that
    // guessed would be inventing one. This is the honest silence, and it is asserted so that
    // a later change cannot turn it into an accusation about every plain page there is.
    expect(() => screenOf('the record, and nothing drawn around it', 80, 24)).not.toThrow();
    expect(everyWidthDrawnOn(['nothing here', 'nor here'])).toHaveLength(0);
  });
});

describe('a screen refuses bytes it cannot replay, rather than replaying part of them', () => {
  it('accuses a sequence outside the family it understands', () => {
    // `ESC M` scrolls the page BACKWARDS. Stepped over, it leaves a screen that is right
    // everywhere except by a row — the one kind of wrong nothing on the page shows.
    expect(() => screenOf(`one${ESC}Mtwo`, 40, 10)).toThrow(/outside the CSI family/);
    // AND THE ONE THAT PRINTS TEXT NOBODY WROTE: an operating-system command carries a
    // string, and a model that steps over one byte draws the rest of it onto the page.
    expect(() => screenOf(`${ESC}]0;a window title${BELL}`, 40, 10)).toThrow(/outside the CSI/);
  });

  it('accuses a CSI final it does not act on, and names it', () => {
    // `S` scrolls the page up by a line. It is in no case of the model, so the model did not
    // do it — and every row of the answer is one out, quietly.
    expect(() => screenOf(`a${ESC}[2Sb`, 40, 10)).toThrow(/ESC\[2S/);
    // `L` opens a row and pushes everything under it down. Named for the same reason.
    expect(() => screenOf(`a${ESC}[Lb`, 40, 10)).toThrow(/does not act on/);
  });

  it('says nothing about colour, nor about a mode being switched', () => {
    // THE NON-VACUITY OF THE OTHER SIDE, and it is what the list is FOR: SGR changes how a
    // glyph looks and never where one goes, and a private sequence is a mode. A guard that
    // accused these would accuse every frame this product writes.
    const painted = screenOf(`${ESC}[36mblue${ESC}[39m`, 40, 10);
    expect(painted.rows[0], 'colour was drawn onto the page').toBe(`blue${' '.repeat(36)}`);
    expect(() => screenOf(`${ESC}[?25l${ESC}[?2026h${ESC}[?2026l`, 40, 10)).not.toThrow();
    // AND A SLICE TAKEN MID-SEQUENCE IS NOT AN UNKNOWN SEQUENCE: an escape that is the last
    // byte there is has nothing after it to have been misread.
    expect(() => screenOf(`a${ESC}`, 40, 10)).not.toThrow();
  });
});

describe('the device says its size in one piece, or the instrument says it does not know', () => {
  it('never reads a half-written answer as a size', async () => {
    // ⚠️ THE INSTRUMENT ACCUSED AN INNOCENT SESSION, once in ten runs of the whole suite:
    // `the terminal the session opened on is undefinedx0`. A redirection CREATES the file
    // and fills it afterwards, and the wait was for the NAME — so the answer read was an
    // empty one, and an empty one parses as a size nobody has.
    //
    // Two things closed it and both are asserted: the runner RENAMES the answer into place,
    // which is atomic within a directory, and the wait is for the CONTENT rather than for
    // the name. One of them alone is a race that comes back.
    const here = mkdtempSync(join(tmpdir(), 'mnema-said-'));
    const lines = sizedTo(24, 80, here).join('\n');
    expect(lines, 'the answer is written straight into the name it is read from').toContain('mv ');
    expect(lines, 'the answer is not written aside first').toContain('.part');

    // AND THE WAIT IS FOR THE CONTENT: an empty answer left where the reader looks does not
    // end the wait, and what comes back says it does not know rather than naming a size.
    writeFileSync(join(here, 'size'), '');
    const said = await theDeviceWasTheSizeAskedFor(here, 24, 80).catch((accused: Error) => accused);
    expect((said as Error).message, 'an empty answer was read as a size').toContain(
      'never said how big',
    );
    expect((said as Error).message, 'an empty answer became a number').not.toContain('undefined');
    // Not vacuous: the same reader answers a COMPLETE one without complaint.
    writeFileSync(join(here, 'size'), '24 80\n');
    await expect(theDeviceWasTheSizeAskedFor(here, 24, 80)).resolves.toBeUndefined();
    rmSync(here, { recursive: true, force: true });
  }, 30_000);
});

// ---------------------------------------------------------------------------
// A1: everything that hands a program a terminal of a chosen size
// ---------------------------------------------------------------------------

/** Every `.ts` file this surface is tested by, recursively. */
function testsUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...testsUnder(path));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found;
}

/**
 * What a file that drives a pseudo-terminal of its own does, and what a file that changes
 * the size of one while a session is running on it does.
 *
 * ⚠️ SPELLED IN PIECES, AND THAT IS NOT DECORATION. Written whole, each of these needles is
 * in THIS file — so the scan below found itself, called itself a driver and demanded that it
 * size a terminal it never opens. An instrument that accuses is the other half of an
 * instrument that stays silent, and this bench has had both; a needle assembled at run time
 * is in no source, so the scan can only find the thing it is looking for. The case under
 * them asserts exactly that.
 */
const DRIVES_A_TERMINAL = `spawn('${'script'}'`;
const RESIZES_A_TERMINAL = `'-${'F'}'`;

describe('everything that gives a session a terminal of a chosen size checks that it got one', () => {
  it('is these four drivers, and a fifth would be accused', () => {
    // ⚠️ A1, AND THE ACHADO IS THE COUNT. The instrument's own header says it is ONE file
    // because it is one instrument — and there are FOUR programs that hand a session a
    // terminal, each with its own runner and its own `stty`. Three of them replay screens.
    // Found by the discriminant rather than by a list, which is exactly why the number is
    // four and not the one the header describes.
    const driving = testsUnder(TESTS)
      .filter((file) => readFileSync(file, 'utf-8').includes(DRIVES_A_TERMINAL))
      .map((file) => file.slice(TESTS.length))
      .sort();
    expect(driving).toEqual(
      [
        'a-page-that-opens-clean.test.ts',
        'support/pty.ts',
        'the-console-on-ink.test.ts',
        'the-page-follows-the-terminal.test.ts',
      ].sort(),
    );
    // AND EVERY ONE OF THEM ASKS THE DEVICE WHAT IT BECAME, through the one function that
    // knows how — a driver that wrote its own `stty rows` line and never read it back is
    // the state all four were in, and the state a fifth would arrive in.
    for (const file of driving) {
      const source = readFileSync(join(TESTS, file), 'utf-8');
      expect(source, `${file} sizes its terminal without saying so`).toContain('sizedTo(');
      expect(source, `${file} never asks what the device became`).toContain(
        'theDeviceWasTheSizeAskedFor(',
      );
    }
    // AND THE LINE ITSELF IS WRITTEN IN ONE PLACE. Four runners each spelled their own
    // `stty rows … cols …`, which is how four programs come to size a terminal four ways
    // and only one of them read the answer back. Asserted as a COUNT rather than as an
    // absence, because the one file that still holds it is the one that exports the rule.
    const spelling = driving.filter((file) =>
      readFileSync(join(TESTS, file), 'utf-8').includes(`stty ${'rows'} `),
    );
    expect(spelling, 'the sizing line is spelled in more than one place').toEqual([
      join('support', 'pty.ts'),
    ]);
    // The scan really read something, and the instrument itself is one of the four.
    expect(driving.length, 'no driver was found at all').toBeGreaterThan(0);
    expect(driving, 'the shared instrument is not among them').toContain('support/pty.ts');
    // AND THE SCAN DOES NOT ACCUSE ITSELF, which is the whole reason its two needles are
    // assembled rather than written: with either of them spelled out, this file is a source
    // that "drives a terminal" and the case above demanded it size one it never opens.
    const own = readFileSync(join(TESTS, 'the-screen-says-what-it-was-drawn-at.test.ts'), 'utf-8');
    expect(own, 'the scan can find itself').not.toContain(DRIVES_A_TERMINAL);
    expect(own, 'the resize scan can find itself').not.toContain(RESIZES_A_TERMINAL);
    // And the needles really are what the drivers are found by, or the two lines above are
    // true of anything at all.
    expect(
      readFileSync(join(TESTS, 'support', 'pty.ts'), 'utf-8'),
      'the needle is not what a driver is made of',
    ).toContain(DRIVES_A_TERMINAL);
  });

  it('and every driver that resizes one reads back what it became', () => {
    // THE OTHER HALF OF THE SAME RULE: a size set while the session is running is a size
    // nobody checked either, and it is set from OUTSIDE the runner, so the file the runner
    // wrote says nothing about it.
    const resizing = testsUnder(TESTS)
      .filter((file) => {
        const source = readFileSync(file, 'utf-8');
        return source.includes(DRIVES_A_TERMINAL) && source.includes(RESIZES_A_TERMINAL);
      })
      .map((file) => file.slice(TESTS.length))
      .sort();
    expect(resizing, 'nothing resizes a terminal any more').not.toHaveLength(0);
    for (const file of resizing) {
      expect(
        readFileSync(join(TESTS, file), 'utf-8'),
        `${file} resizes without reading back`,
      ).toContain('resizedTo(');
    }
  });

  it('and every screen there is comes out of the one function that checks its width', () => {
    // A3, SAID AS A PROPERTY OF THE SOURCES. The width guard is inside {@link screenOf}
    // rather than at the three dozen places that call it, so a case written tomorrow cannot
    // be a site that forgot — and this is what would go red if a second way of building a
    // screen appeared beside it.
    const replaying = testsUnder(TESTS).filter((file) =>
      readFileSync(file, 'utf-8').includes('screenOf('),
    );
    expect(replaying.length, 'nothing replays a screen any more').toBeGreaterThan(1);
    for (const file of replaying) {
      const source = readFileSync(file, 'utf-8');
      if (file.endsWith(join('support', 'screen.ts'))) continue;
      expect(source, `${file.slice(TESTS.length)} builds a screen of its own`).toContain(
        "from './support/screen.js'",
      );
    }
    // And the one function really does check, which is the assertion the loop above rests
    // on: the guard is named inside the body that every one of those callers reaches.
    const instrument = readFileSync(join(TESTS, 'support', 'screen.ts'), 'utf-8');
    const body = instrument.slice(instrument.indexOf('export function screenOf'));
    expect(body.slice(0, body.indexOf('\n}\n')), 'the one function stopped checking').toContain(
      'theWidthIsTheOneItWasDrawnAt(',
    );
  });
});
