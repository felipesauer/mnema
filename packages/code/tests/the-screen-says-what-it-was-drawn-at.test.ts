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
 *   - THE STREAM ARRIVED WHOLE. ⚠️ AND THIS IS THE ONE THAT WAS ACTUALLY WRONG. A pty is
 *     read in chunks and five places decoded them one chunk at a time; a boundary inside the
 *     three bytes of a rule's glyph leaves two replacement characters where there was one,
 *     the row is a column too wide, the terminal folds it, and the page has a row nobody
 *     drew. Measured on a caught run: a rule of 100 columns came back 101 characters long.
 *     Fixed by one collector that keeps its decoder across chunks (`support/arriving.ts`) —
 *     and the guard STAYS, because it is what says out loud the day that stops working.
 *
 * NOTHING HERE IS ABOUT THE PRODUCT. Every case below is built out of bytes composed by
 * hand, because a race does not answer a single run and the arithmetic does.
 */

import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Arriving, decodedWhole } from './support/arriving.js';
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

/** What a decoder leaves behind when it is handed half a character. */
const HALF_A_CHARACTER = '\ufffd';

/**
 * The horizontal run a rule is drawn out of, spelled by code point — like every other unusual
 * byte in this repository's sources, and for the reason `support/screen.ts` gives where it names
 * the same glyph: a run is one keystroke away from a hyphen.
 *
 * ⚠️ THERE WERE FOUR MORE AND THEY WERE A FRAME'S CORNERS. The panel was a BOX and this fixture
 * drew one; the frame is gone from the product, so a fixture that kept drawing one would be
 * feeding the instrument a shape nothing can produce — which is how a branch stays green after
 * the thing it was for has been deleted.
 */
const RUN = '\u2500';

/**
 * A CONSOLE'S PAGE, AS BYTES, DRAWN AT A GIVEN WIDTH — the smallest thing that has the two
 * shapes the measurement is made of.
 *
 * Rows the width is NOT readable off — what the panel draws, which is text and art and holds no
 * run at all — and the two rules the input area sits between, which run the whole way across. It
 * is the drawing this product opens with, reduced to what is being measured: a delivery that
 * changed it would change this, which is the point.
 *
 * ⚠️ IT WAS A BOX: corner to corner, with a title cutting its top edge in two, and a rule under
 * it. All three shapes were the frame's — and the frame is what the delivery that took it off
 * removed from the product, so two of the instrument's three branches went with it
 * (`support/screen.ts`, {@link everyWidthDrawnOn}).
 */
function aPageDrawn(columns: number): string {
  const rule = RUN.repeat(columns);
  return ['MNEMA', 'mnema \u00b7 v0.0.0 \u00b7 a session', rule, 'mnema>', rule].join('\r\n');
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

describe('a screen keeps what left the top, because where a row went is the whole question', () => {
  /** Ten rows of text, each one naming itself, and nothing else on the page. */
  const rowsOf = (many: number): string =>
    Array.from({ length: many }, (_, at) => `row-${at}\r\n`).join('');

  it('feeds the scrollback on a SCROLL and on nothing else', () => {
    // A ROW GOES ABOVE WHEN IT IS PUSHED OFF THE TOP, and that is the only way there is. Each row
    // here ends with a newline, so eleven of them on a ten-row screen scroll it TWICE — the last
    // newline of the tenth row is already the first scroll — and the two that left are above.
    const scrolled = screenOf(rowsOf(11), 40, 10);
    expect(
      scrolled.above.map((row) => row.trim()),
      'the rows that left are not above, in the order they left',
    ).toEqual(['row-0', 'row-1']);
    expect(scrolled.text, 'the row that left is still on the screen').not.toContain('row-0');
    expect(scrolled.text, 'the rows that stayed are not on the screen').toContain('row-10');
    // AND ERASING THE SCREEN ADDS NOTHING TO IT, which is the difference the whole page design of
    // this product rests on: the rows it erases are simply not anywhere afterwards.
    const erased = screenOf(`${rowsOf(4)}${ESC}[2J`, 40, 10);
    expect(erased.text.trim(), 'the screen was not emptied').toBe('');
    expect(erased.above, 'erasing the screen fed the scrollback').toEqual([]);
  });

  it('⛔ empties the scrollback on the sequence that erases the history', () => {
    // ⚠️ THIS MODEL USED TO DO NOTHING AT ALL ABOUT `ESC[3J`, on the grounds that the scrollback is
    // not the screen and that this product refuses to write the sequence anyway. Both halves
    // stopped holding: the door translates it now rather than nobody writing it
    // (`src/repl/page.ts`, `theEraseAsAScroll`), so a case has to be able to tell a page that was
    // SCROLLED from one that was erased — and a model that shrugged at this would answer *the
    // caller's history is intact* for the very bytes that destroy it.
    const kept = screenOf(rowsOf(12), 40, 10);
    expect(kept.above.length, 'nothing was above to be destroyed').toBe(3);
    const gone = screenOf(`${rowsOf(12)}${ESC}[3J`, 40, 10);
    expect(gone.above, 'the history survived the sequence that erases it').toEqual([]);
    // AND IT LEAVES THE SCREEN ALONE, which is what it does on a terminal: it is the history it
    // takes, and a model that blanked the page here would be answering for `2J` instead.
    expect(gone.rows, 'the screen was erased with the history').toEqual([...kept.rows]);
  });
});

describe('a screen refuses a stream that was decoded in pieces, and says that is what it is', () => {
  it('accuses a run with a replacement character in it, and says what it costs', () => {
    // ⚠️ THE DEFECT THE WHOLE DELIVERY WENT LOOKING FOR, and it is the instrument's own. The
    // pty is read in chunks and every driver accumulated them one decode at a time, so a
    // chunk boundary inside the three bytes of a rule's glyph destroys it and leaves TWO
    // replacements where there was one character. The row is then one column wider than the
    // terminal, the terminal folds it, and the page has a row nobody drew.
    //
    // Caught by dumping the screen of a failing run: a rule 100 columns wide came back 101
    // characters long, and the extra column was on the row below as a single glyph. That row
    // is every symptom this family has.
    const half = HALF_A_CHARACTER;
    const rule = RUN.repeat(48) + half + half + RUN.repeat(49);
    let said = '';
    try {
      screenOf(`${aPageDrawn(100)}\r\n${rule}`, 100, 40);
    } catch (accused) {
      said = (accused as Error).message;
    }
    expect(said, 'a stream that lost a character said nothing').not.toBe('');
    expect(said, 'the accusation does not name what is in the stream').toContain('REPLACEMENT');
    expect(said, 'the accusation does not say what it costs').toContain('ONE COLUMN');
    // AND IT CLEARS THE PRODUCT, which is the half a reader needs most: the bytes the
    // console wrote were right, and what is wrong is the stream they were read out of.
    expect(said, 'the accusation leaves the product under suspicion').toContain(
      'The product wrote the right bytes',
    );
  });

  it('says nothing about a stream that arrived whole', () => {
    // The other side. A guard that accused every page there is would have made the whole
    // suite red rather than one run in three, which is a difference nobody would have had to
    // measure — but it is asserted, because that is what makes the case above mean anything.
    expect(() => screenOf(aPageDrawn(100), 100, 40)).not.toThrow();
  });
});

describe('a character that arrives in two chunks is one character', () => {
  /** A stream that hands over exactly the chunks a case says, and nothing else. */
  const arrivesAs = (...chunks: readonly Buffer[]): Arriving => {
    const stream = new EventEmitter();
    const arriving = decodedWhole();
    arriving.from(stream);
    for (const chunk of chunks) stream.emit('data', chunk);
    return arriving;
  };

  it('keeps the glyph a rule is made of, cut at either byte', () => {
    // ⛔ AND IT IS CUT BY HAND rather than by a chunk boundary that has to be waited for. The
    // defect this closes was red in about eight runs of the suite in ten and green in the
    // other two; a race does not answer a single run, and the arithmetic does. So the stream
    // is told exactly where to break, at every place there is to break a three-byte glyph.
    const written = `x${RUN}y`;
    const bytes = Buffer.from(written, 'utf-8');
    expect(bytes, 'the glyph is not three bytes long').toHaveLength(5);
    for (const cut of [2, 3]) {
      const arriving = arrivesAs(bytes.subarray(0, cut), bytes.subarray(cut));
      expect(arriving.text(), `a glyph cut after byte ${cut} did not survive`).toBe(written);
    }
    // AND THE WHOLE GLYPH IN ONE CHUNK IS UNCHANGED, so the case above is not passing on a
    // collector that has stopped collecting.
    expect(arrivesAs(bytes).text()).toBe(written);
  });

  it('is the half the old reading lost, and the screen would have accused it', () => {
    // NOT VACUOUS, and this is the whole evidence that the case above rules on something: the
    // way every reader used to do it — one decode per chunk — turns that same split into TWO
    // replacement characters where there was one glyph. The row is then a column wider than
    // the terminal, which is the row nobody drew.
    const written = `x${RUN}y`;
    const bytes = Buffer.from(written, 'utf-8');
    const perChunk = (cut: number): string =>
      bytes.subarray(0, cut).toString('utf-8') + bytes.subarray(cut).toString('utf-8');
    // EITHER CUT LOSES IT, and neither loses it quietly.
    for (const cut of [2, 3]) {
      expect(perChunk(cut), `a glyph cut after byte ${cut} survived the old reading`).not.toBe(
        written,
      );
      expect(perChunk(cut), `${cut}: the old reading left no replacement`).toContain(
        HALF_A_CHARACTER,
      );
      expect([...perChunk(cut)].length, `${cut}: the row did not come out wider`).toBeGreaterThan(
        [...written].length,
      );
    }
    // AND THE CUT THE CAUGHT RUN SHOWED is the one after TWO bytes of the glyph: a decoder
    // handed a valid-but-unfinished prefix answers with one replacement, and the byte left
    // over on the other side is a second — two characters where there was one, so the row is
    // exactly ONE column wider. That is the row nobody drew, arrived at by arithmetic.
    expect([...perChunk(3)], 'the caught run’s split is not one column wider').toHaveLength(
      [...written].length + 1,
    );
    // AND THE GUARD WOULD HAVE SAID SO, which is what makes it the proof this stays fixed:
    // the day a reader goes back to decoding one chunk at a time, the screen accuses it.
    expect(() => screenOf(perChunk(3), 40, 10)).toThrow(/REPLACEMENT CHARACTER/);
  });

  it('holds a decoder per stream rather than one between them', () => {
    // A character never spans two streams, so a partial sequence held for one may not be
    // finished by a byte off another — which is how two correct streams become one wrong
    // string. Both halves of the glyph go down ONE stream while the other is also being read.
    const bytes = Buffer.from(RUN, 'utf-8');
    const first = new EventEmitter();
    const second = new EventEmitter();
    const arriving = decodedWhole();
    arriving.from(first);
    arriving.from(second);
    first.emit('data', bytes.subarray(0, 1));
    second.emit('data', Buffer.from('!', 'utf-8'));
    first.emit('data', bytes.subarray(1));
    expect(arriving.text(), 'a stream finished another stream’s character').toBe(`!${RUN}`);
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

/**
 * What a file that READS BYTES OFF A STREAM does — and it is a different question from the
 * two above, which is the whole reason it is asked separately.
 *
 * ⚠️ THE LIST SAID FOUR DRIVERS AND THE DISCRIMINANT SAYS FIVE. A driver is a program that
 * spawns a terminal; the rule about decoding is about anything that takes bytes in CHUNKS,
 * and the fake terminal (`support/console.ts`) takes them without spawning anything. It
 * could not corrupt a character today — what is written into it is written whole — but "it
 * cannot happen here" is the premise this bench has been wrong with more than any other, and
 * a second way of turning bytes into text is a second way for one of them to be wrong.
 */
const READS_A_STREAM = `on('${'data'}'`;

/** What turning ONE chunk into text looks like — the shape the defect had, in five places. */
const PER_CHUNK = `.toString('${'utf-8'}')`;

/** A source with its comments taken out, so prose about a defect is not read as the defect. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

describe('everything that gives a session a terminal of a chosen size checks that it got one', () => {
  it('is these three drivers, and a fourth would be accused', () => {
    // ⚠️ A1, AND THE ACHADO IS THE COUNT. The instrument's own header says it is ONE file
    // because it is one instrument — and there were FOUR programs that hand a session a
    // terminal, each with its own runner and its own `stty`. Found by the discriminant rather
    // than by a list, which is exactly why the number was four and not the one the header
    // describes.
    // ⚠️ AND IT IS THREE NOW. The copy in `the-page-follows-the-terminal.test.ts` went back to
    // the shared instrument, and what made it worth taking out was a step that has to WAIT
    // rather than watch: an absence — no page carried away for a height — is waited OUT, so a
    // step needs to be able to do something before its question is asked, which the copy had no
    // way of expressing. The count going DOWN is what this case is for as much as it going up.
    const driving = testsUnder(TESTS)
      .filter((file) => readFileSync(file, 'utf-8').includes(DRIVES_A_TERMINAL))
      .map((file) => file.slice(TESTS.length))
      .sort();
    expect(driving).toEqual(
      ['a-page-that-opens-clean.test.ts', 'support/pty.ts', 'the-console-on-ink.test.ts'].sort(),
    );
    // AND EVERY ONE OF THEM ASKS THE DEVICE WHAT IT BECAME, through the one function that
    // knows how — a driver that wrote its own `stty rows` line and never read it back is
    // the state all four were in, and the state a fourth would arrive in.
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
    // The scan really read something, and the instrument itself is one of the three.
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

  it('and everything that reads bytes off a stream decodes them through the one collector', () => {
    // A1 AGAIN, BY ITS OWN DISCRIMINANT. The delivery that named this defect said the sites
    // were "the four drivers"; the discriminant says FIVE, because the fake terminal takes
    // bytes in chunks without spawning anything. The site the list did not have is the achado
    // — and it is the one that could not corrupt a character today, which is exactly the kind
    // this bench has been wrong about before.
    // ONE PLACE SUBSCRIBES TO CHUNKS, and it is the collector. Five files did before this —
    // the four drivers and the fake terminal, which the drivers' list does not have because
    // it spawns nothing. A sixth reader appears here and is accused.
    const reading = testsUnder(TESTS)
      .filter((file) => readFileSync(file, 'utf-8').includes(READS_A_STREAM))
      .map((file) => file.slice(TESTS.length))
      .sort();
    expect(reading, 'bytes are taken off a stream somewhere other than the collector').toEqual([
      join('support', 'arriving.ts'),
    ]);
    // AND EVERY DRIVER GOES THROUGH IT, found by the driver discriminant rather than by a
    // list — the four that spawn a terminal, and the fake one that does not.
    const collecting = testsUnder(TESTS)
      .filter((file) => readFileSync(file, 'utf-8').includes(DRIVES_A_TERMINAL))
      .map((file) => file.slice(TESTS.length));
    expect(collecting.length, 'no driver was found at all').toBeGreaterThan(0);
    for (const file of [...collecting, join('support', 'console.ts')]) {
      expect(
        readFileSync(join(TESTS, file), 'utf-8'),
        `${file} does not collect through the one decoder`,
      ).toContain('decodedWhole(');
    }
    // AND NOTHING TURNS ONE CHUNK INTO TEXT ON ITS OWN ANY MORE — read off the CODE rather
    // than off the prose, because two of these files describe the defect in words.
    const decoding = testsUnder(TESTS)
      .filter((file) => withoutComments(readFileSync(file, 'utf-8')).includes(PER_CHUNK))
      .map((file) => file.slice(TESTS.length));
    expect(decoding, 'something still decodes one chunk at a time').toEqual([
      'the-screen-says-what-it-was-drawn-at.test.ts',
    ]);
    // The scan cannot find itself: this file takes bytes off a stream in its own cases, so a
    // needle written whole would have put it in the first list.
    expect(
      readFileSync(join(TESTS, 'the-screen-says-what-it-was-drawn-at.test.ts'), 'utf-8'),
      'the stream scan can find itself',
    ).not.toContain(READS_A_STREAM);
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
    const inside = body.slice(0, body.indexOf('\n}\n'));
    // BOTH PREMISES, and both named here rather than one: they are two rules with one site
    // each, and a delivery that dropped either would leave the other looking like coverage.
    expect(inside, 'the one function stopped checking the width').toContain(
      'theWidthIsTheOneItWasDrawnAt(',
    );
    expect(inside, 'the one function stopped checking the stream').toContain(
      'theStreamWasDecodedWhole(',
    );
  });
});
