/**
 * THE OPENING FITS THE HEIGHT TOO — how much of a screen the region at the TOP of it may hold
 * for ever, and where the rest of the opening goes when it may not.
 *
 * IT CAME OUT OF A MEASUREMENT, and the measurement is the case below at eighty by twenty-four.
 * The arrangement at the top of the console is FIXED: it is drawn on every frame and it never
 * scrolls, so every row of it is a row the session's own answers can never be given. It was
 * chosen by the WIDTH alone, and on the screen every terminal has had since before they were on
 * screens that came to fifteen rows of twenty-four — sixty-two per cent of the page — with the
 * input area taking five and the reader left four. Asked what it runs, the console answered
 * with the last four rows of the answer and none of the verbs in it.
 *
 * WHAT THIS FILE HOLDS IS THE SECOND MEASUREMENT and the three promises around it:
 *
 *   - THE SAME LADDER, WALKED DOWN AS WELL AS ACROSS. There are three arrangements and no
 *     fourth: the richest that fits both ways is drawn, and the rung under the last one is the
 *     same lines landed on the roll. Asserted as a pure function of two numbers, so the rule
 *     can be read in one place without a terminal (`src/repl/panel.ts`, `panelFor`).
 *   - THE SHARE IS A NUMBER, AND IT IS ASSERTED AS ONE. Every other threshold on this surface
 *     is the content's own measurement; this one cannot be, because nothing down the screen is
 *     folded or cut and no measurement of the drawing answers *how much of a caller's screen
 *     may this hold*. So it is a third, it is written down here in this file's own arithmetic
 *     rather than imported from the module it rules, and it is asked of every size.
 *   - NOTHING IS LOST. What leaves the top goes on the ROLL, which is where everything else the
 *     session says goes — asserted by walking to the top of it and finding the drawing there.
 *
 * AND THE TALL SCREEN MAY NOT PAY FOR IT. A share is a bound and not a target: a terminal
 * with the room draws exactly what it drew before, so the last case here is the one that would
 * go red if the budget were spent as though it were a cost.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { bannerFor } from '../src/presentation/banner.js';
import { fact, subjectLine } from '../src/presentation/detail.js';
import { renderPlain } from '../src/presentation/plain.js';
import { THE_INSET } from '../src/repl/inset.js';
import { type Opening, openingFor, type PanelForm, panelFor } from '../src/repl/panel.js';
import { ABOUT } from '../src/session-words.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { ESC } from './support/console.js';
import {
  aFrameSince,
  inPty as drive,
  type Fixture,
  opensAConsole,
  type Ran,
  type Step,
} from './support/pty.js';
import { type Screen, theFirstScreenWhere, theFirstScreenWith } from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';

/** What the opening always says, whatever the terminal is like. */
const OPENED = 'a session over this project';

/**
 * The first words of the one sentence the session lands UNDER the arrangement — the oldest
 * line on the roll, and the FIRST words rather than the whole of it because a narrow terminal
 * folds it (`src/repl/session.ts`, `whatItRefuses`).
 */
const UNDER_THE_PANEL = 'It runs the';

/** The heading that CLOSES what `/help` answers — everything above it is the list of verbs. */
const CLOSES_THE_ANSWER = 'And it does not write';

/** What the chain says about a tree in order, and the opening's record section repeats. */
const VERIFIED = 'local integrity verified';

/**
 * The key that walks the roll to its oldest line, as a terminal sends it — built from the
 * escape spelled by its code point, like every control byte in this repository's sources: a
 * character a reader cannot see is a character an edit destroys without anybody noticing.
 */
const TO_THE_TOP = `${ESC}[H`;

/**
 * THE LAST WORD OF THE LAST SENTENCE `/help` SAYS — how a case knows the whole answer landed.
 *
 * ONE WORD AND NOT A PHRASE, because the product folds a row too wide for the terminal BETWEEN
 * words (`src/presentation/folded.ts`): a phrase can arrive split across two rows and be found
 * nowhere in the bytes of a frame, and a word cannot.
 */
const ENDS_THE_ANSWER = 'again';

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
/**
 * A PROJECT WHOSE OWN PATH IS WIDER THAN THE WINDOW — the fixture the floor of the ladder needs.
 *
 * THE LAST RUNG USED TO BE REACHED BY MAKING THE WINDOW SHORT, and that is the premise the
 * floor took away: a sixteen-row terminal draws no page at all now (`src/repl/floor.ts`), so a
 * case driven at one measures the screen that says so. The rung is still reachable and it is
 * reached by the OTHER measurement — the panel is given up when what it holds does not fit ACROSS
 * the window, and one of the things it holds is where the session is STANDING, which is a path.
 *
 * SO THE PATH IS THE FIXTURE. Nothing about the product is arranged for: a caller working in a
 * deeply nested directory on a window at the floor really does have an opening the arrangement
 * cannot hold, and what this case is about is that they lose nothing by it.
 */
let deep: string;
let environment: NodeJS.ProcessEnv;
const before = { cwd: process.cwd(), env: { ...process.env } };

beforeAll(async () => {
  // ITS OWN SANDBOX, and nothing of this repository's own record is touched: a case that
  // opened a session where it stands would be measuring a project it is also changing.
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-height-'));
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
  await run(['task', 'the task the opening is measured over'], io);

  // AND THE SECOND PROJECT, DEEP ENOUGH THAT ITS PATH DOES NOT FIT: the arrangement is chosen
  // against the widest row it holds, and the row that says where the session is standing is one of
  // them ({@link deep}).
  deep = join(
    sandbox,
    'a-directory-nested-deeply-enough-that-its-own-path',
    'does-not-fit-across-a-window-at-the-floor',
    'project',
  );
  mkdirSync(deep, { recursive: true });
  process.chdir(deep);
  await run(['init'], io);
  await run(['task', 'the task the floor of the ladder is measured over'], io);
  process.chdir(project);

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

/** Runs `mnema repl` on a pseudo-terminal of a given size, over one of the two projects. */
async function inPty(options: {
  readonly columns: number;
  readonly rows: number;
  readonly steps: readonly Step[];
  readonly project?: string;
}): Promise<Ran> {
  return drive({ ...fixture(), project: options.project ?? project }, options);
}

/** The step every session begins with: the console open, and its first frame DRAWN. */
const opens: Step = opensAConsole(PROMPT);

/** The caller asks what the session runs — the read this whole delivery came out of. */
const asks: Step = { types: `${ABOUT}\r`, until: aFrameSince(PROMPT), what: `asked ${ABOUT}` };

/** The caller walks the roll back to its oldest line. */
const walksToTheTop: Step = {
  types: TO_THE_TOP,
  until: aFrameSince(PROMPT),
  what: 'walked to the top of the roll',
};

/**
 * The step every session ends with.
 *
 * CTRL-D RATHER THAN THE WORD, and the reason is what is being read: the word is ECHOED onto
 * the roll, so the page a case is about would be one line further down than the page the
 * caller saw. The key leaves without saying anything, so the last frame drawn is the frame the
 * step before it caused.
 */
const leaves: Step = { types: '\u0004', until: () => true, what: 'left' };

/** Which row of a page holds something, and −1 when none does. */
function rowOf(screen: Screen, what: string): number {
  return screen.rows.findIndex((row) => row.includes(what));
}

// ---------------------------------------------------------------------------
// The rule, as a function of two numbers
// ---------------------------------------------------------------------------

/**
 * WHAT THE OPENING IS MADE OF, at the shape the product's own opening has — the one place in
 * this file that stands in for a session.
 *
 * IT IS THE SHAPE AND NOT A COPY. The mark is asked of the module that draws it, so the day
 * the art changes this changes with it; the three groups beside it are a row each of what the
 * session is and where it is standing, and a section of a heading and two trees, which is what
 * a project with a public tree and a private one has. Their WIDTHS are what decides the
 * arrangement across, and they are written here as the measurement they were taken at rather
 * than derived — a session's title is its build and its context, and a place is a path.
 *
 * WHAT TIES IT TO THE PRODUCT IS THE PAIR OF CASES ON A REAL TERMINAL BELOW, which ask the
 * same questions of a console opened on a pseudo-terminal over a real project. If this shape
 * ever stops being the product's, those go red — a table alone would go on answering about a
 * panel nobody has.
 */
const THE_DRAWING = bannerFor({ columns: 200, rows: 200, needs: () => 0 });
const OF_THE_PRODUCTS_SHAPE = {
  render: renderPlain,
  title: subjectLine('mnema  ·  v0.0.0  ·  a session over this project'),
  mark: THE_DRAWING,
  standing: [fact('/home/somebody/a-project · mnid:00000000')],
  record: [
    subjectLine('The record'),
    fact('public: local integrity verified (T1/T2/T4)'),
    fact('private: no record here'),
  ],
  beneath: [fact('It runs the 16 verbs that read the record, and refuses the ones that write.')],
} as const;

/** The drawing of the name as a screen receives it: its rows, with no row padded at its end. */
const ART: readonly string[] = THE_DRAWING.map((line) => renderPlain(line).trimEnd());

/**
 * EVERY DRAWING OF THE NAME THERE IS, biggest first — walked off the module rather than written
 * down.
 *
 * A form is what a width answers with, so the forms are what the answers CHANGE at: the ladder
 * is walked from a terminal wider than anything down to one with no width at all, and each new
 * answer is a form. The page is answered as costing nothing, which holds the HEIGHT out of it —
 * what is wanted here is the set of drawings, not which one a screen gets.
 *
 * Written out instead, this list would be a second copy of the art, and the first thing it would
 * do is go stale. It is the same walk `the-opening-fits-the-screen.test.ts` makes, for the same
 * reason.
 */
function everyDrawing(): readonly (readonly string[])[] {
  const forms: string[][] = [];
  for (let columns = 200; columns >= 0; columns -= 1) {
    const form = bannerFor({ columns, rows: 200, needs: () => 0 }).map((line) =>
      renderPlain(line).trimEnd(),
    );
    const last = forms[forms.length - 1];
    if (last === undefined || last.join('\n') !== form.join('\n')) forms.push(form);
  }
  return forms;
}

/** The arrangement this rule chooses for a terminal of a given size, and nothing else. */
const formAt = (columns: number, rows: number): PanelForm =>
  panelFor({ ...OF_THE_PRODUCTS_SHAPE, columns, rows }).form;

/** The whole opening at a size — the arrangement, what is landed, and what each costs. */
const openingAt = (columns: number, rows: number): Opening =>
  openingFor({ ...OF_THE_PRODUCTS_SHAPE, columns, rows });

/**
 * HOW MUCH OF THE SCREEN THE CHROME MAY TAKE: one row in three, rounded down.
 *
 * SPELLED HERE RATHER THAN IMPORTED, and that is the whole worth of this constant: the
 * module states the same rule as *three of them fit in the screen*, and a case that imported
 * its number would agree with it whatever it said. Two spellings of one decision is the one
 * duplication this bench asks for.
 */
const A_THIRD_OF = (rows: number): number => Math.floor(rows / 3);

/**
 * WHAT THE SEAM UNDER AN ARRANGEMENT COSTS: the rule that closes the top region, and the row of
 * breath between it and the first thing the session says.
 *
 * SPELLED HERE FOR THE REASON THE SHARE ABOVE IS: the module states the same two rows as a
 * constant of its own (`repl/panel.ts`, `THE_SEAM`), and a case that imported the number would
 * agree with it whatever it said.
 */
const THE_SEAM = 2;

/**
 * THE SEVEN GEOMETRIES OF THE INVENTORY, and what each of them gets.
 *
 * THEY ARE SIZES AND NEVER THRESHOLDS. Each is a window somebody really has — the terminal
 * every machine has had for fifty years, a laptop, a tmux pane, a full screen — and where a
 * form gives way is SEARCHED FOR in the case under this one rather than written down in it.
 *
 * FIVE OF THE SEVEN ANSWERED `stacked` OR `columns` BEFORE THIS DELIVERY, because the width
 * was the only question asked: at eighty by twenty-four the text went under the mark and
 * fifteen rows of the screen stopped being the reader's for the rest of the session. What
 * changed is the answer at the short sizes and nothing at the tall ones.
 *
 * AND EVERY ROW OF IT IS ABOUT ONE DRAWING — the biggest there is, held still. That is what
 * makes it a table about this rule rather than about the console: on a screen with no room for
 * the biggest drawing's arrangement it is the DRAWING that gives way, and the console opens
 * with a smaller one and keeps its arrangement (`session.ts`, and the case below on a real
 * terminal at eighty by twenty-four). So `bare` in this table means *this drawing cannot be
 * arranged here*, which is the question the panel answers, and never *the console gives up*.
 */
const THE_GEOMETRIES: readonly {
  readonly columns: number;
  readonly rows: number;
  readonly form: PanelForm;
}[] = [
  // The screen everybody has. Too narrow for the two columns with THIS drawing beside them, and
  // fifteen rows of arrangement is more than a third of twenty-four — so with the biggest
  // drawing there is no arrangement at all, and the console draws a smaller one instead.
  { columns: 80, rows: 24, form: 'bare' },
  { columns: 100, rows: 24, form: 'bare' },
  // A window with the room for the two columns ACROSS and not down. IT ANSWERED `columns` AND
  // THE SEAM IS WHAT TOOK IT: the top region is the arrangement AND the rule that closes it and
  // the row of breath under that (`repl/panel.ts`, `THE_SEAM`), so the biggest drawing costs
  // eleven rows rather than nine and its share wants thirty-three. The rule did not move — a
  // third of the screen, chrome and all — and what moved is what the chrome is.
  { columns: 120, rows: 30, form: 'bare' },
  { columns: 190, rows: 64, form: 'columns' },
  // A tmux pane, and a narrow window — neither has the rows for an arrangement.
  { columns: 60, rows: 20, form: 'bare' },
  { columns: 47, rows: 24, form: 'bare' },
  // Wide enough for the text under the mark, and not tall enough to hold it there.
  { columns: 100, rows: 30, form: 'bare' },
];

describe('the arrangement is chosen by the height as well as the width', () => {
  it('answers each of the seven geometries with the form that fits both ways', () => {
    for (const { columns, rows, form } of THE_GEOMETRIES) {
      expect(formAt(columns, rows), `${columns}x${rows}`).toBe(form);
    }
    // NOT VACUOUS IN EITHER DIRECTION: the table really holds more than one answer, and the
    // rule really is a function of BOTH numbers — the same width answers differently at two
    // heights, and the same height answers differently at two widths. A table of one answer
    // repeated seven times would pass every assertion above.
    expect(new Set(THE_GEOMETRIES.map(({ form }) => form)).size).toBeGreaterThan(1);
    // THE PAIRS MOVED UP THE TABLE with the seam: at a hundred and twenty by thirty the biggest
    // drawing's arrangement no longer fits its share, so the width that still discriminates the
    // HEIGHT is one with the rows for eleven of chrome.
    expect(formAt(190, 64)).not.toBe(formAt(190, 24));
    expect(formAt(190, 64)).not.toBe(formAt(40, 64));
  });

  it('walks the same three forms down the screen, and the last rung fits every size', () => {
    // THE LADDER IS ORDERED AND TOTAL, asserted over a grid rather than at the sizes above: for
    // every width and every height there is an answer, and a SHORTER screen never gets a richer
    // arrangement than a taller one at the same width. That is the property the seven sizes are
    // examples of, and it is what makes "three forms and no fourth" a statement about the rule.
    const RICHNESS: Readonly<Record<PanelForm, number>> = { columns: 2, stacked: 1, bare: 0 };
    const answered = new Set<PanelForm>();
    for (let columns = 0; columns <= 200; columns += 1) {
      for (let rows = 0; rows <= 70; rows += 1) {
        const form = formAt(columns, rows);
        answered.add(form);
        if (rows === 0) continue;
        expect(
          RICHNESS[form],
          `${columns}x${rows} is richer than ${columns}x${rows + 1}`,
        ).toBeLessThanOrEqual(RICHNESS[formAt(columns, rows + 1)]);
        expect(
          RICHNESS[form],
          `${columns}x${rows} is richer than ${columns + 1}x${rows}`,
        ).toBeLessThanOrEqual(RICHNESS[formAt(columns + 1, rows)]);
      }
    }
    // AND THE FLOOR IS ANSWERED WHATEVER THE SIZE, which is what keeps the ladder total: a
    // terminal that reported nothing at all gets the rung that costs nothing, exactly as a
    // terminal too narrow for anything gets the name drawn anyway (`presentation/banner.ts`).
    expect(formAt(0, 0), 'a device that reported no size at all').toBe('bare');
    expect(openingAt(0, 0).above, 'the floor costs rows of a screen nobody reported').toBe(0);
    // NOT VACUOUS: the grid really produced every one of the three, so the ordering above is a
    // statement about a ladder rather than about one answer repeated forty thousand times.
    expect([...answered].sort()).toEqual(['bare', 'columns', 'stacked']);
  });

  it('gives an arrangement up one row under three times what it costs', () => {
    // THE THRESHOLD, SEARCHED FOR RATHER THAN WRITTEN DOWN — the same shape every other form on
    // this surface is pinned by. For each arrangement: at the shortest screen it is chosen on it
    // is drawn, one row shorter it is not, and the height it gives way at is three times the
    // rows it costs. Nothing here knows what an arrangement costs; it is asked.
    for (const [form, wide] of [
      ['columns', 200],
      ['stacked', 80],
    ] as const) {
      let shortest = 0;
      while (shortest < 200 && formAt(wide, shortest) !== form) shortest += 1;
      expect(shortest, `${form} is on no screen at ${wide} columns`).toBeLessThan(200);
      expect(formAt(wide, shortest), `${form} at ${shortest} rows`).toBe(form);
      expect(formAt(wide, shortest - 1), `${form} at ${shortest - 1} rows`).not.toBe(form);
      // AND THE HEIGHT IT GIVES WAY AT IS THE SHARE, read off what the arrangement itself costs
      // at the size where it survives.
      const costs = openingAt(wide, shortest).above;
      expect(costs, `${form} at ${shortest} rows costs nothing`).toBeGreaterThan(0);
      expect(shortest, `${form} gives way somewhere other than its own share`).toBe(costs * 3);
    }
  });

  it('never spends more than a third of the screen on the region that never moves', () => {
    // THE BUDGET, AS A NUMBER, over every size rather than at the seven — which is what makes it
    // a bound and not seven observations. The rounding is this file's own arithmetic: a screen
    // of twenty-five rows may spend eight, because a ninth is more than a third of it.
    for (let columns = 0; columns <= 200; columns += 1) {
      for (let rows = 0; rows <= 70; rows += 1) {
        expect(openingAt(columns, rows).above, `${columns}x${rows}`).toBeLessThanOrEqual(
          A_THIRD_OF(rows),
        );
      }
    }
    // NOT VACUOUS: the chrome really is spent somewhere — a bound satisfied by a panel that had
    // shrunk to nothing everywhere would say nothing at all — and it is spent right up against
    // the bound at the size where the form gives way.
    // AT A SCREEN WITH THE ROOM FOR THE BIGGEST ARRANGEMENT, which is thirty-three rows since
    // the seam joined it — thirty spends nothing at all now, and a sweep read there would be a
    // non-vacuity case that had quietly become vacuous.
    const spent = openingAt(200, 40).above;
    expect(spent, 'no size in the sweep spends any rows on chrome').toBeGreaterThan(0);
    // AND THE BOUND IS REACHED, which is what makes it a THRESHOLD rather than a ceiling nothing
    // ever comes near: at the shortest screen the arrangement survives on, what it spends is
    // exactly the share — so a bound one row tighter would change the answer somewhere.
    expect(
      openingAt(200, spent * 3).above,
      'the arrangement never comes within a row of its share',
    ).toBe(A_THIRD_OF(spent * 3));
  });
});

// ---------------------------------------------------------------------------
// The defect, on a real terminal
// ---------------------------------------------------------------------------

/**
 * HOW MANY ROWS OF WHAT THE CALLER ASKED FOR ARE ON THE PAGE, above the heading that closes it.
 *
 * `/help` answers with a list of the verbs the session runs and then a heading and three
 * sentences under it. The window shows the END of the roll, so the closing heading is the
 * landmark: every row above it on the page is a row of the LIST, and a page that does not hold
 * the heading at all is a page whose whole answer went past the top of the window.
 *
 * NOUGHT IS WHAT THE DEFECT LOOKED LIKE, and it is the reason this reads a landmark rather
 * than matching what a verb's row looks like: at eighty by twenty-four the console showed the
 * last four rows of a thirty-four-row answer, which were the sentences under that heading and
 * nothing else. A count of rows that LOOK like a verb would have said nought as well and would
 * have said it about a pattern rather than about the page.
 */
function rowsOfTheListOn(screen: Screen, under: number): number {
  const closes = rowOf(screen, CLOSES_THE_ANSWER);
  return closes < 0 ? 0 : Math.max(0, closes - under);
}

/**
 * HOW MANY ROWS AT THE TOP OF THE PAGE DID NOT MOVE — which is what *fixed region* MEANS,
 * asked of two pages of one session rather than of an arithmetic.
 *
 * The arrangement is drawn again on every frame at the top of the screen and the roll under it
 * scrolls, so the rows the two pages share at the top are the chrome and the rows below them are
 * the window. It is measured this way rather than by counting what the panel says it costs
 * because the two can disagree, and the one a reader has is the page.
 *
 * NOUGHT IS AN ANSWER AND NOT A FAILURE: on a screen with no room for an arrangement the
 * whole opening is on the roll, so the first row moves with everything else.
 */
function theFixedRowsBetween(opened: Screen, later: Screen): number {
  let fixed = 0;
  while (fixed < opened.rows.length && opened.rows[fixed] === later.rows[fixed]) fixed += 1;
  return fixed;
}

/**
 * THE PAGE AS IT SETTLED ONCE THE WHOLE OF WHAT `/help` SAYS HAD LANDED — found by what the
 * page HOLDS, never by where the step ended in the stream.
 *
 * THE FRAME AT THE WIDTH IS NOT THE ONE THIS CASE IS ABOUT, which is the one refinement the
 * usual locator needed here. {@link theSettledScreen} answers with the LAST frame drawn at a
 * size, and the last thing a driven session does is LEAVE: the key that leaves puts the row
 * being typed on the roll on its way out, so the page it answers with is the answer's page
 * shifted by one row — and the count below is a row of the answer.
 *
 * SO THE PAGE IS THE FIRST ONE CARRYING BOTH ENDS OF THE ANSWER: the heading that closes the
 * list, and the last word of the last sentence under it. A session lands what it says one line
 * at a time, so a frame with the heading on it need not be a frame with the whole answer on it
 * — which is the same class of mistake as reading by index, made about a marker instead.
 */
function theAnswerOn(ran: Ran, columns: number, rows: number): Screen {
  return theFirstScreenWhere(
    ran.bytes,
    columns,
    rows,
    (screen) => screen.text.includes(CLOSES_THE_ANSWER) && screen.text.includes(ENDS_THE_ANSWER),
  );
}

/**
 * WHAT THE ORDINARY SCREEN SHOWS OF THE ANSWER — a measuring stick, taken on a real
 * pseudo-terminal at eighty by twenty-four.
 *
 * IT IS NOT DERIVED FROM ANYTHING, which is the whole point of writing it down: a delivery that
 * changes what the console spends has to come here and say so. BEFORE THIS DELIVERY IT WAS
 * NOUGHT — the arrangement held fifteen of the twenty-four rows for ever, the input area five,
 * and the four that were left showed the tail of the answer with the list of verbs and the
 * heading that closes it both past the top of the window.
 */
const SHOWS_OF_THE_ANSWER = 5;

/**
 * WHAT THE ARRANGEMENT COSTS ON THAT SCREEN — the second stick, and the one that says the
 * identity survived.
 *
 * Eight rows: the name drawn on one, and beside it what the session is, where it is standing,
 * and the record's section under its blank row — six — and then the SEAM, which is the rule that
 * closes the region and the row of breath under it (`repl/region.ts`, `theTop`). THE FIRST TRY AT
 * THIS DELIVERY MADE IT NOUGHT — the arrangement was given up whole and the identity went on the
 * roll with the drawing, which is the one thing a header may not do. What buys it back is the
 * DRAWING giving way instead: at this width the letterspaced name is what fits beside the text
 * inside the share.
 *
 * IT WAS SIX AND THE SEAM PUT IT AT EIGHT, which is exactly a third of twenty-four — the bound,
 * reached rather than approached, on the screen everybody has. What it costs the reader is the
 * two rows the stick above lost.
 */
const THE_ARRANGEMENT_COSTS = 8;

describe('the answer a caller asked for is on the page, on the screen everybody has', () => {
  it('shows the list of verbs at eighty by twenty-four, where it showed none of it', async () => {
    const columns = 80;
    const rows = 24;
    const ran = await inPty({ columns, rows, steps: [opens, asks, leaves] });
    // BOTH PAGES FOUND BY WHAT THEY HOLD, never by where a step ended in the stream: a submitted
    // line draws more than one frame, and the boundary a step settles on is wherever the stream
    // happened to be quiet ({@link theAnswerOn}).
    const opened = theFirstScreenWith(ran.bytes, UNDER_THE_PANEL, columns, rows);
    const asked = theAnswerOn(ran, columns, rows);
    // THE REGION AT THE TOP DID NOT MOVE, which is what makes the rows under it the window:
    // measured as the rows the two pages share ({@link theFixedRowsBetween}).
    const fixed = theFixedRowsBetween(opened, asked);
    expect(fixed, 'the arrangement is not fixed at the top of this screen').toBe(
      THE_ARRANGEMENT_COSTS,
    );
    // THE DEFECT, CLOSED: the list is on the page UNDER that region, and the count is the
    // stick above. It was nought.
    expect(rowsOfTheListOn(asked, fixed), 'the list of verbs is not on the page').toBe(
      SHOWS_OF_THE_ANSWER,
    );
    // AND WHAT THE SIX ROWS HOLD IS THE IDENTITY, not the logo: the fixed rows say what the
    // session is, where it is standing and what the record proved — on the page that has printed,
    // which is where the old console had lost all three.
    const chrome = asked.rows.slice(0, fixed).join('\n');
    expect(chrome, 'the fixed region does not say what the session is').toContain(OPENED);
    expect(chrome, 'the fixed region does not say where it is standing').toContain('mnid:');
    expect(chrome, 'the fixed region does not say what the record is').toContain('The record');
    expect(chrome, 'the fixed region does not say what the record proved').toContain(VERIFIED);
    // AND A DRAWING OF THE NAME IS STILL IN IT — a SMALLER one, which is the whole mechanism:
    // what gives way is the ART and never what identifies. Which drawing it is is asked of the
    // module that draws them, so a fifth form moves this case with it.
    const drawn = everyDrawing().find((form) => form.every((row) => chrome.includes(row)));
    expect(drawn, 'no drawing of the name survived in the fixed region').toBeDefined();
    expect(drawn, 'the biggest drawing is still holding rows of this screen').not.toEqual(ART);
    // AND THE SHARE HOLDS ON THE REAL PAGE and not only in the arithmetic.
    expect(fixed, 'the region at the top is over its share of the screen').toBeLessThanOrEqual(
      A_THIRD_OF(rows),
    );
  }, 240_000);

  it('keeps what left the top on the roll, one walk back', async () => {
    // A SCREEN WITH NO ROOM FOR AN ARRANGEMENT AT ALL, which is the floor of the ladder and the
    // case this promise is about.
    //
    // IT WAS A SHORT SCREEN AND IT IS A DEEP PATH, and what moved it is the floor under the
    // window. Sixteen rows used to be the way here: the cheapest arrangement costs six, six rows
    // want eighteen of screen, and under that no drawing is small enough — so the whole opening
    // landed on the roll. A sixteen-row window draws no page at all now
    // (`src/repl/floor.ts`), so that size measures the screen which says so and nothing about
    // this promise. The other measurement still reaches the rung: the arrangement is given up when
    // what it holds does not fit ACROSS the window, and the row saying where the session is
    // standing is a PATH ({@link deep}). It is a SIZE and not a threshold either way; where the
    // last arrangement gives way is searched for in `the-opening-fits-the-screen.test.ts`.
    const columns = 100;
    const rows = 24;
    const ran = await inPty({
      columns,
      rows,
      project: deep,
      steps: [opens, asks, walksToTheTop, leaves],
    });
    const asked = theAnswerOn(ran, columns, rows);
    // THE OPENING REALLY DID LEAVE THE PAGE, or there is nothing to walk back to: neither what
    // the session is nor the sentence it lands under the mark is on the page after the answer.
    expect(asked.text, 'the opening never left the page').not.toContain(OPENED);
    expect(asked.text, 'the oldest line never left the page').not.toContain(UNDER_THE_PANEL);
    // AND IT IS ALL THERE AT THE TOP OF THE ROLL: the drawing, what the session is, where it is
    // standing and what the record proved — found by what the PAGE holds rather than by where
    // the walk ended in the stream. The page after the walk is the one carrying both the top of
    // the opening and the echo of what was typed; the page it opened with carried the first
    // without the second, which is what tells the two apart.
    const echoed = `${PROMPT} ${ABOUT}`;
    const top = theFirstScreenWhere(
      ran.bytes,
      columns,
      rows,
      (screen) => screen.text.includes(OPENED) && screen.text.includes(echoed),
    );
    expect(rowOf(top, OPENED), 'what the session is did not come back').toBeGreaterThanOrEqual(0);
    expect(rowOf(top, UNDER_THE_PANEL), 'the oldest line is not on the roll').toBeGreaterThan(
      rowOf(top, OPENED),
    );
    expect(top.text, 'the record’s section is not on the roll').toContain('The record');
    expect(top.text, 'what the record proved is not on the roll').toContain(VERIFIED);
    // AND THE DRAWING WITH IT, which is the half a reader would notice first: whichever one this
    // screen was given, its first row is the first row of the roll.
    const drawn = everyDrawing().find((form) => top.text.includes(form[0] as string));
    expect(drawn, 'no drawing of the name is on the roll').toBeDefined();
    expect(top.rows[0], 'the drawing is not at the top of the roll').toContain(
      (drawn as readonly string[])[0] as string,
    );
    // AND NOTHING WAS FIXED AT THE TOP OF THIS SCREEN, which is what makes the walk necessary
    // rather than decorative: the first row moved with everything else.
    expect(
      theFixedRowsBetween(asked, top),
      'something was fixed at the top, so this is not the floor',
    ).toBe(0);
  }, 240_000);

  it('draws the whole arrangement on a screen with the room for it, drawing and all', async () => {
    // THE OTHER DIRECTION, which is what keeps the share a BOUND rather than a cost: a terminal
    // with the rows for the arrangement gets exactly the arrangement it got before this
    // delivery — the text beside the mark, the biggest drawing, and the top region fixed at the
    // top of the screen.
    const columns = 190;
    const rows = 64;
    const ran = await inPty({ columns, rows, steps: [opens, asks, leaves] });
    const asked = theAnswerOn(ran, columns, rows);
    // THE ARRANGEMENT IS THE TWO-COLUMN ONE, judged by what only that one has: the row that says
    // what the session is BEGINS with a row of the art, because it sits beside it.
    // AND THE ROW IS READ FROM INSIDE THE MARGIN, which is what the page's left edge cost this
    // reading: everything the session says is drawn inside it, the drawing included
    // (`repl/inset.ts`), so the row begins with the margin and then with the art.
    const beside = (asked.rows.find((row) => row.includes(OPENED)) as string).slice(THE_INSET);
    expect(
      ART.some((row) => beside.startsWith(row)),
      'the text is not beside the mark on a screen with the room for it',
    ).toBe(true);
    // AND THE WHOLE DRAWING IS ON IT, row for row.
    for (const row of ART) {
      expect(asked.text, `a row of the drawing is missing: ${row}`).toContain(row);
    }
    // AND THE ANSWER IS ON THE PAGE UNDER IT, whole — which is what the room was for.
    expect(
      rowsOfTheListOn(asked, THE_DRAWING.length),
      'the answer is not on the page',
    ).toBeGreaterThan(SHOWS_OF_THE_ANSWER);
    // AND WHAT IT SPENDS IS THE DRAWING'S OWN HEIGHT AND THE SEAM, which is the elo between the
    // arithmetic this file's table is over and the console a caller really opens: the shape
    // composed above costs what the product's own opening costs at this size. IT WAS THE
    // DRAWING'S HEIGHT ALONE, and the two rows that joined it are the rule closing the region and
    // the row of breath under it (`repl/panel.ts`, `THE_SEAM`) — chrome, counted where the
    // drawing's rows are counted, because a row the layout draws and the arithmetic does not know
    // about is a frame taller than the screen.
    expect(openingAt(columns, rows).above, 'the arrangement costs something else here').toBe(
      THE_DRAWING.length + THE_SEAM,
    );
    expect(openingAt(columns, rows).above).toBeLessThanOrEqual(A_THIRD_OF(rows));
  }, 240_000);
});
