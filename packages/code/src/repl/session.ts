/**
 * THE SESSION: one process, many reads, and the floor paid once.
 *
 * A command of this CLI costs about a hundred milliseconds before it has read a byte of
 * the record — node starting, then the declarations commander needs to route a word
 * (measured, and brought down as far as a declaration can be brought: see
 * `the-floor-is-the-declaration.test.ts`). Ten reads at a shell prompt pay that ten
 * times. Ten reads in here pay it ONCE, and everything after the first is the work
 * itself, which was already under the threshold where anyone notices anything.
 *
 * WHAT IT IS NOT is as much of the design as what it is:
 *
 *   - IT IS A VERB, `mnema repl`, and never the bare invocation. `mnema` with no verb
 *     prints the help and exits, byte for byte as it always has. An agent that ran the
 *     binary in a pty and landed in a prompt would wait forever, and this product's
 *     other surface is the one agents are meant to use.
 *   - IT ONLY READS, by DEFAULT-DENY over each verb's own declaration (`gate.ts`).
 *     Not a list kept here — a write added tomorrow is refused because nobody
 *     classified it as a read.
 *   - IT REFUSES WITHOUT A TERMINAL. Reading commands from a pipe would be a second way
 *     to run this product's verbs, with its own parsing and its own rules, and the
 *     first way already exists: type the verb.
 *   - IT PERSISTS NOTHING. What the caller typed lives in the value the console keeps
 *     (`editing.ts`), for the length of the process, and goes nowhere. A file would have
 *     to live in the caller's home — this product writes inside `.mnema/` and nowhere
 *     else — and WHERE is a decision nobody has taken.
 *   - IT IS NOT A SHELL. No expansion, no globbing, no pipes; and no `cd`, no `set`,
 *     nothing that changes what the session is looking at. One session, one project,
 *     resolved from the directory it was opened in.
 *
 * ONE PROGRAM PER LINE, and it is deliberate rather than lazy. commander keeps what it
 * parsed on the command object, so a program reused across lines would answer the
 * second `search` with the first one's `--limit`. Building one costs the declarations
 * and nothing else — no adapter, no domain — which is exactly what the floor work made
 * cheap.
 *
 * THE OUTPUT IS THE SURFACE'S OWN, and the console is only WHERE IT LANDS. Every line a
 * command prints goes through the same `io` and the same renderer every other invocation
 * uses, and inside a terminal that renderer is the styled one — so this is the first
 * place where painting is the normal path rather than the exception. `strip(what a
 * command says here)` is what the same command says in a pipe, and that is asserted
 * rather than hoped for. The port this file hands the commands is the CONSOLE'S: both
 * streams land on the same page, because inside one terminal there is no second stream —
 * a refusal written past the console's back would land on top of whatever was being
 * drawn.
 *
 * THE LAYOUT LIBRARY IS LOADED HERE AND NOWHERE ABOVE. `./console.js` is reached by a
 * dynamic import inside this function, and this function is itself reached by one from
 * the verb's action, so nothing of it is in the closure a `mnema --version` pays for.
 * That is not an optimisation, it is the whole reason the session exists: a session
 * imported at module scope would make every other verb pay for the thing built to stop
 * paying.
 */

import type { ProvenLevel } from '@mnema/chain';
import { buildProgram, type CliIo, parseWith } from '../cli.js';
import type { TreeReport } from '../commands/verify.js';
import { runVerify } from '../commands/verify.js';
import { type CompletionWord, completionTree } from '../completion/tree.js';
import { bannerFor } from '../presentation/banner.js';
import { aside, fact, subjectLine } from '../presentation/detail.js';
import { column, itemLine } from '../presentation/items.js';
import type { Line } from '../presentation/line.js';
import { occurrenceLine } from '../presentation/occurrence.js';
import { widthOf } from '../presentation/plain.js';
import type { Render } from '../presentation/render.js';
import { statement } from '../presentation/verdict.js';
import { ABOUT, CLEAR, LEAVE, PREFIX, WHAT_EACH_WORD_DOES } from '../session-words.js';
import { VERSION } from '../version.js';
import type { RenderingAt } from '../wiring/color.js';
import { here } from '../wiring/context.js';
import { writeLines } from '../wiring/io.js';
import { reportUsage } from '../wiring/report.js';
import type { Declared } from '../wiring/verb.js';
import { DEFAULT_REQUIREMENT, levelSeverity, treeHeadline, VERIFY_VERB } from '../wiring/verify.js';
import { areaFor } from './area.js';
import { asTheSession } from './asking.js';
import { completerFor } from './complete.js';
import type { Drawn } from './console.js';
import { followingTheRecord } from './following.js';
import { type AfterLine, argvOf, dispositionOf, verbsOffered } from './gate.js';
import { insideTheMargin } from './inset.js';
import type { Leaving } from './leaving.js';
import { type Opening, openingFor, theShortestScreenFor } from './panel.js';
import { whatTheSessionShowed } from './seen.js';
import { type Standing, standing } from './standing.js';

/**
 * What a caller types in front of.
 *
 * Plain, and it is the one string on this surface a renderer never sees: it is not a
 * report and it carries no fact. A painted prompt would be escape bytes the console has
 * to do column arithmetic over to put the caret in the right place.
 */
const PROMPT = 'mnema> ';

/** How wide the verb column of {@link ABOUT} is — the longest verb, and a space after it. */
const VERB_WIDTH = 16;

/**
 * What separates the two facts of the status line, and the words of a tip from the next.
 *
 * It is the separator the opening already used between the words the session answers to,
 * kept for the same reason it was chosen: these are clauses of one line rather than
 * columns of a table, and the two spaces of a column would read as a table with no header.
 */
const BETWEEN_CLAUSES = ' · ';

/**
 * The product, and what this session is — the first row of the text beside the mark.
 *
 * IT WAS THE BOX'S TITLE, laid on the frame's top edge. The frame is gone; the words did
 * not change and neither did the order they are in.
 */
const NAME = 'mnema';
const WHAT_IT_IS = 'a session over this project';

/**
 * WHICH BUILD THIS IS, beside the name.
 *
 * It is the one fact about the PRODUCT the opening states, and it is there because a
 * console is where somebody reports what they saw: a screenshot of an opening that names the
 * version is a bug report that says which one. The string is the one `mnema --version`
 * prints — one constant, read by both (`version.ts`), so a title and a flag cannot come to
 * disagree about what is running.
 *
 * A PART OF ITS OWN and not glued to the name: what separates two parts of a heading is
 * the renderer's decision and has been since the first form of this surface, so composing
 * `mnema v0` here would be this file punctuating a line. The `v` is not punctuation — it
 * is how a version is written.
 */
const WHICH_BUILD = `v${VERSION}`;

/**
 * What the panel's ONE section is called.
 *
 * THERE WERE TWO OF THEM, and the second was called `Hints`: a heading over the one
 * affordance the panel named. It went because the row under the prompt already says where
 * every word of the session is — the palette the slash opens — and the panel's copy was the
 * one that scrolls off the top and never comes back. The heading is kept for the section
 * that stayed, because a section with a heading and one without are two shapes.
 */
const THE_RECORD = 'The record';

/** How deep a line of a section sits under the heading that names it. */
const UNDER_A_HEADING = 1;

/**
 * THE MARK THE BADGE OPENS WITH — a filled ring, and nothing else about it.
 *
 * Spelled by its code point rather than typed, like every unusual byte in this repository:
 * a glyph a reader cannot tell from a neighbouring one is a glyph an edit destroys without
 * anybody seeing it happen. It is the one the reference this row was measured from uses,
 * and it says nothing — it is where the eye lands on a row that is otherwise at the far
 * edge of a wide screen.
 */
const LEVEL_MARK = '\u25c9';

/**
 * How deep the badge sits: at the edge, like a verdict.
 *
 * It is not under anything. The rows of the panel are a section's lines under the heading
 * that names it; this is one row in a corner, and a level of indentation would be two
 * columns of nothing between it and the end of the terminal.
 */
const AT_THE_EDGE = 0;

/**
 * How many rows the palette wants while the page is being opened: none.
 *
 * The list of words is what a keystroke opens, and the opening is what is on the screen
 * before there has been one. Counting rows for it here would budget the page against a
 * region no caller has yet.
 *
 * AND IT SAID THE LIST WAS *cut to what is left over the row being typed rather than
 * allowed to push anything off the top*, which was two claims and the second was false: what
 * was left over was measured against the SCREEN, so a list twenty rows tall on a page with
 * four to spare pushed sixteen rows of the opening into the scrollback on the first keystroke.
 * NOTHING IS PUSHED ANYWHERE NOW — the list grows into the middle region, which is a window
 * onto a roll rather than the roll itself (`area.ts`, `scrolling.ts`) — so the sentence is
 * true of both halves and for a reason the arithmetic no longer has to keep.
 */
const NOTHING_OFFERED_YET = 0;

/**
 * How many rows the region above the input area takes while the page is being opened: none.
 *
 * THE QUESTION HERE IS WHAT THAT REGION SHOULD BE, so its own height cannot be an input to it:
 * the input area is measured in order to choose a drawing of the name that fits above it
 * (`bannerFor`), and a drawing that had to be known first would be a circle. With no palette
 * open the number cannot change the answer at all — what it budgets is the list — so this says
 * what is true rather than standing in for something.
 *
 * IT WAS THE FLOW ON THE SCREEN, and it meant a different thing that happened to be nought
 * at the same moment: everything the session had said that a reader could still see, which at
 * the opening is nothing because nothing has landed. What a session says is not above the input
 * area any more, so the field it fills is a different field (`area.ts`, `AreaRequest.header`).
 */
const NOTHING_ABOVE_YET = 0;

/**
 * A HEIGHT NO ARRANGEMENT CAN BUST — what the opening is composed against when the question is
 * *what would this drawing's arrangement COST*, rather than *does it fit*.
 *
 * The two questions are asked of the same function and only the second one is about a terminal
 * (`panel.ts`, `panelFor`): a form is chosen by the width AND by its share of the height, so a
 * height nothing can exceed leaves the width as the only judge and the answer is the
 * arrangement's own cost. It is a number rather than a flag because the arithmetic it feeds is
 * a comparison, and a flag would be a second way for that comparison not to happen.
 */
const WHATEVER_THE_HEIGHT = Number.MAX_SAFE_INTEGER;

/**
 * THE THREE CLAUSES OF THE HINT, and each one is a KEY and what that key gives (see
 * {@link tips} for why three).
 *
 * The first is built out of the PREFIX every word of the session begins with rather than
 * out of a word, because what it names is the keystroke and not a command.
 *
 * THE FIRST ONE USED TO NAME `/help`, AND IT USED TO BE FORBIDDEN TO NAME THE SLASH.
 * The rule was right and it was about a promise: a hint naming an affordance that does not
 * answer is the console lying to the reader who cannot check, and until this delivery the
 * slash answered nothing on its own — you had to type a whole word behind it. It opens the
 * palette now, so the promise is kept, and the case that held the ban is inverted rather
 * than deleted (`tests/the-input-has-its-own-place.test.ts`).
 *
 * AND THE LAST ONE USED TO NAME `/exit`, WHICH THE FIRST CLAUSE NOW DELIVERS. A hint
 * that says where the list of words IS does not also have to teach a word from it — that
 * is the economy the reference this console was measured against has, and it became true
 * here only once the palette existed. What is left is the keystroke, which is in no list.
 * The saving is measured rather than felt: seventy-four columns to fifty-three, which is
 * the difference between a hint an eighty-column terminal keeps and one a sixty-column
 * terminal keeps — and below its own width the area draws no hint at all (`area.ts`).
 *
 * AND `Tab completes` KEEPS NO QUALIFIER, WHICH IS PRECISION RATHER THAN BREVITY. A Tab
 * offers the verbs AND the words the session answers to itself, so `Tab for verbs` would
 * be shorter and false.
 */
const WHAT_THE_SLASH_DOES = `\`${PREFIX}\` lists the words`;
const TAB_COMPLETES = 'Tab completes';
const HOW_TO_LEAVE = 'Ctrl-D leaves';

/**
 * WHAT THE RULE IS ASKED WITH FOR A LINE THAT MAY NOT FOLD: no screen to fold to.
 *
 * TWO CALLERS AND ONE ARGUMENT. The badge and the hint are CHROME — one row each, in the
 * corner above the input and under the row being typed — and the area draws neither unless it
 * fits on one row of this terminal (`area.ts`, `onOneRow`), so a fold there could never have
 * had anything to do and a folded one would be a corner of the console broken in half. The
 * renderer this file hands out BEFORE the console exists answers with it for the neighbouring
 * reason: no device has been asked how wide the page is, and a width nobody reported is not a
 * width to guess at (`wiring/color.ts`).
 */
const NO_SCREEN_TO_FOLD_TO = 0;

/**
 * THE THREE CLAUSES OF THE ROW UNDER THE LIST, in the same shape as the three above: a KEY, and
 * what that key gives (see {@link pickingTips} for why they are beside the list rather than in
 * the row under the prompt).
 *
 * The two arrows are one clause because they are one affordance — a caller who knows Down moves
 * knows Up does — and they are drawn as the glyphs a keyboard has rather than spelled out, which
 * is what the reference does and is four columns instead of fifteen. UPWARDS ARROW U+2191 and
 * DOWNWARDS ARROW U+2193, spelled by their code points like every unusual byte in this
 * repository.
 */
const ARROWS_MOVE = '\u2191\u2193 moves';
const RETURN_FILLS = 'Enter fills the row';
const ESCAPE_SHUTS = 'Esc shuts the list';

/** What one line of the session needs: where to write, how, and what it is called. */
export interface Session {
  /** Where a command's output goes — the caller's own port. */
  readonly io: CliIo;
  /**
   * How a line becomes bytes: the renderer for THE PAGE AS IT IS DRAWN NOW.
   *
   * IT WAS *RESOLVED ONCE FOR THE WHOLE SESSION*, which is the sentence a maximised window
   * falsified. Which colours a line carries is still one answer for the whole session — that
   * is the flag, the environment and the terminal, and none of them moves — but how wide the
   * screen is does, and a line folded to the width the session OPENED at is a report in a
   * column down the left of a wide window. So the width is the console's to say, on every
   * frame, and this is the door onto it ({@link openSession}).
   */
  readonly render: Render;
  /** The name the session's own verb was registered under (see {@link verbsOffered}). */
  readonly self: string;
  /**
   * WHO THIS SESSION IS SPEAKING AS — the identity the opening resolved, or nothing when
   * it could not name one.
   *
   * It is the value the panel is drawn with (`standing.ts`), carried rather than asked
   * for again: a verb that requires the asker's identity is given it here instead of
   * demanding a caller type back what the panel above the prompt is showing them
   * (`asking.ts`). Resolved ONCE, when the session opens, from local material and with no
   * writer opened — so what a line costs is the line's own work and nothing else.
   *
   * `undefined` is a first-class answer and not a missing value: a session outside any
   * project, or on a machine whose key root names no single key, has no identity to speak
   * as, and the verb asks for one the way it always has.
   */
  readonly identity: string | undefined;
}

/**
 * Everything opening a session needs beyond one line's worth.
 *
 * WHO THE SESSION IS IS NOT ON IT, and the omission is the guarantee: the identity a
 * line is answered as is READ when the session opens (`standing.ts`) and cannot be
 * handed in. A caller that could supply one would be a caller that could open a console
 * speaking as somebody else, and the whole argument for filling it at all is that the
 * value is this installation's own.
 */
export interface SessionRequest extends Omit<Session, 'identity' | 'render'> {
  /**
   * HOW A LINE BECOMES BYTES ON A SCREEN OF A GIVEN WIDTH — the rule, rather than one
   * answer to it (`wiring/color.ts`).
   *
   * A SESSION MAY NOT BE HANDED A RENDERER, and that is the whole of what this delivery
   * changed: it outlives the window it opened in, so the width is not a fact the entry can
   * resolve on its behalf. What the entry DOES resolve is everything else — the flag, the two
   * conventional variables and whether the destination is a terminal — and those travel inside
   * this, read once, so a `--color` typed on a line inside the session still changes nothing.
   */
  readonly renderingAt: RenderingAt;
  /** Where the keystrokes come from. */
  readonly input: NodeJS.ReadStream;
  /** The page the console draws on. Not where a report goes — that is the console. */
  readonly output: NodeJS.WriteStream;
  /** Whether BOTH ends are a terminal, asked at the entry where the process is. */
  readonly interactive: boolean;
  /** Every way this process can stop, so the terminal is given back in all of them. */
  readonly leaving: Leaving;
}

export type { AfterLine };

/**
 * Opens the session and reads lines until the caller leaves.
 *
 * The three ways out are the ones `node`, `python` and `psql` all answer to, and the
 * distinction between them is the one a person's fingers already know: Ctrl-C abandons
 * the LINE being typed and Ctrl-D ends the session. A Ctrl-C that killed the process
 * would make this worse than the shell prompt it replaces — you would lose the session
 * for mistyping a word.
 */
export async function openSession(request: SessionRequest): Promise<void> {
  const { io, renderingAt, self, input, output, interactive, leaving } = request;

  // The refusal, in the product's own voice, before anything is opened. It says what
  // to do instead, because a caller who piped something in wanted an answer and there
  // is one: the verb, typed directly. It goes to the caller's own port and not to a
  // console, because the decision not to open one is what is being reported.
  //
  // AND IT IS RENDERED FOR THIS INVOCATION'S OWN TERMINAL, which is the one place in this
  // file that asks the rule with no width: there is no page and there is not going to be
  // one, so this is a report by a verb that prints and exits, and it takes the same answer
  // every other such verb takes (`wiring/color.ts`).
  if (!interactive) {
    reportUsage(
      { io, render: renderingAt() },
      `\`mnema ${self}\` is an interactive session and this is not a terminal`,
      'Run the verb itself — `mnema <verb>` — when input or output is a pipe, a file or a log.',
    );
    return;
  }

  // The port every command inside the session prints through: the page, on both
  // streams. It is a closure over `land` rather than the console itself because the
  // console has to exist before it can be handed one, and what it is handed — the way
  // a line answers a typed line — has to exist before the console does.
  let land: (line: string) => void = () => undefined;
  const onThePage: CliIo = {
    out: (line) => land(line),
    err: (line) => land(line),
    fail: () => undefined,
  };
  // AND HOW THOSE LINES BECOME BYTES, by the same detour and for the same reason: the width
  // a line folds to is the width of the frame it is about to land on, and only the console
  // has asked the device (`console.ts`, {@link OpenConsole.render}). Everything a verb prints
  // goes through this, so a caller who maximises their window gets their next report across
  // the whole of it.
  //
  // BEFORE THE CONSOLE IS UP IT ANSWERS *NO SCREEN TO FOLD TO*, which is not a default to
  // fall back on: it is the honest answer to *how wide is the page* before there is one. The
  // console is opened at the foot of this function and nothing composed above it renders
  // through this — the two rows of chrome ask the rule themselves, for the same width and by
  // the same argument ({@link NO_SCREEN_TO_FOLD_TO}).
  let renderOn: Render = renderingAt(NO_SCREEN_TO_FOLD_TO);
  const render: Render = (line) => renderOn(line);
  // WHERE THE SESSION IS STANDING, resolved once and read by two things: the line the
  // opening draws, and every line the caller then types. It is one `readdir` and one
  // small file, and no writer is opened to get it (`standing.ts`) — which is what makes
  // it affordable to carry and is the whole reason a verb inside here need not ask for
  // the identity it names.
  const whereItStands = standing();
  const session: Session = { io: onThePage, render, self, identity: whereItStands.identity };

  // The declarations and the command tree, read off a program built the way every line
  // will build one. What Tab offers is therefore what the gate will accept, from the
  // same registration.
  const built = buildProgram(onThePage, [], render);
  const offered = verbsOffered(built.verbs, self);

  // WHAT THE SESSION OPENS WITH, read and composed ONCE — every part of it except the two
  // that are functions of how wide the terminal is. Where it is standing is one `readdir`
  // and one small file (see `standing.ts`); what the record IS costs a `verify`, and that
  // is the one read of this kind this surface pays — declared, paid here, and never paid
  // again (see {@link theRecord}).
  const title = subjectLine(NAME, WHICH_BUILD, WHAT_IT_IS);
  const where = standingLine(whereItStands);
  const proved = theRecord();
  const record = recordSection(proved?.trees);
  // NOT RENDERED HERE, unlike the two below, and the reason is a measurement: how WIDE this
  // sentence is decides whether it is folded into a second row, and a page counted as though
  // it were one row opens with its own top in the scrollback. So it travels as lines and the
  // composer turns it into bytes and counts the rows (`panel.ts`, `openingFor`) — the count
  // asks the fold rather than predicting it, which is what the terminal's own arithmetic
  // used to do here (`presentation/folded.ts`, `rowsAt`).
  const refuses = whatItRefuses(offered.length);
  // NO PROJECT, NO BADGE. There is no record to name a level of, so the corner says
  // nothing at all — the same posture the line that says where the session is standing
  // takes about a fact it does not have, and the same one the panel's record section takes.
  // The WIDTH goes with it because the area needs both and only the composer can measure
  // one: a rendered line carries escapes a screen does not print (see `Drawn`).
  const badge = drawn(
    proved === undefined ? undefined : badgeLine(proved.level),
    renderingAt(NO_SCREEN_TO_FOLD_TO),
  );
  // What the caller can do, rendered ONCE for the same reason the badge is — and measured
  // here as well, because two things read the width: the area, which draws no hint the
  // terminal would fold, and the opening, which is budgeted against the area under it.
  const hint = drawn(tips(), renderingAt(NO_SCREEN_TO_FOLD_TO));
  // THE WORDS THE SESSION ANSWERS TO ITSELF, read ONCE and handed to ONE thing: the
  // completer, which puts them in the same list as the verbs. THEY WENT TO THE CONSOLE AS
  // WELL, so that a slash could be answered out of them, and that is what made the two keys
  // show two different menus — the slash three words, a Tab fourteen. One reader, one list.
  const vocabulary = theSessionsOwnWords();
  // WHAT THIS SESSION HAS NAMED, as one value with two ends: the console fills it with
  // every line that lands, and the completer reads it to offer a record back. One object
  // rather than two, so what a Tab offers cannot become a different set from what the
  // page said. It holds no record and opens nothing (`seen.ts`).
  const seen = whatTheSessionShowed();
  // WHERE THE RECORD STANDS NOW, so that what happens NEXT can be told from what was
  // already there. The trees are the ones the verdict above covered rather than a second
  // list resolved here — a console that watched a tree it had said nothing about would be
  // reporting from outside its own verdict. What it costs to start is a line per tail, off
  // the end of the tail (`following.ts`); what it costs after that is a question with no
  // read behind it.
  const following = followingTheRecord((proved?.trees ?? []).map((tree) => tree.root));

  /**
   * WHAT THE PAGE OPENS WITH on a terminal of a given SIZE — and the only thing on this
   * surface the size of the terminal decides.
   *
   * IT USED TO TAKE THE WIDTH ALONE, and the doc here said a width was "the only thing
   * on this surface a width decides". What falsified it is the drawing: the name gives way
   * by height as well now (`presentation/banner.ts`), because a drawing whose PAGE is taller
   * than the screen is a drawing already in the scrollback before anything is typed.
   * So both measurements arrive, by the same path, from the one place that asks the device.
   *
   * AND THE HEIGHT RULE IT ARRIVED WITH WAS THE WRONG ONE, which is what this function
   * now carries. The name gave way when the DRAWING was taller than the terminal, and five
   * rows against twenty-four never is — measured, and the axis chose nothing at any size a
   * person opens. What the drawing costs is one ADDEND of what the page costs: what the
   * session is, where it is standing, what the record is, the sentence under it and the
   * input area are the others, and only the first depends on which form is drawn. So the
   * question asked here is whether the WHOLE page fits.
   *
   * AND IT ASKED FOR A ROW TO SPARE, which is the premise this delivery took away. The row
   * was the layout library's boundary: a region as tall as the viewport was redrawn WHOLE, with
   * the erase of the caller's history inside the sequence, so the opening was budgeted one row
   * short of the screen. The console owns the screen now and its frame IS the viewport on every
   * frame — that is what three fixed regions means — so there is no boundary to stay under and
   * the page is budgeted against the whole terminal (`area.ts`).
   *
   * PURE, AND THAT IS THE POINT OF IT BEING A FUNCTION. The console calls it for the size the
   * device has at the moment of the drawing, and keeps the answer while that size does not move
   * (`console.ts`, `theOpening`). Nothing is read: the lines above already exist, and the
   * answers that depend on the size are which arrangement there is ROOM for (`panelFor`) and
   * how much of the name is DRAWN (`bannerFor`) — and the first of those took the WIDTH
   * alone until the arrangement was measured against the screen it is fixed on. Both take the
   * pair now, out of the one reading. A recomposition that asked the record again could make
   * the panel say something different halfway through a session — and the reads are counted
   * rather than promised (`tests/the-name-and-the-hints.test.ts`).
   */
  const theOpening = (columns: number, rows: number): Opening => {
    // THE PAGE WITH A GIVEN DRAWING IN IT, composed rather than estimated — and that is what
    // keeps the arithmetic out of a circle. The mark's WIDTH is what decides whether the text
    // goes beside it, its HEIGHT is most of what the arrangement costs, and the arrangement is
    // what decides whether the mark's rows are added to the text's or shared with them; all of
    // it is settled the moment the opening exists.
    //
    // BOTH MEASUREMENTS TRAVEL TOGETHER FROM HERE, and they are the two this function was
    // handed rather than two readings of a device: a panel chosen against one terminal and an
    // area budgeted against another are two frames, and the console has already paid for that
    // shape once (`console.ts`, `theSize`).
    const drawnWith = (mark: readonly Line[], within: number = rows): Opening =>
      openingFor({
        // NOT THE TERMINAL'S WIDTH, BUT THE PAGE'S. Both halves of an opening are drawn inside
        // the margin the console keeps to the left of everything it says (`inset.ts`,
        // `region.ts`): the arrangement, at the top of the screen, and the lines it lands on
        // the roll. So the width every question below is asked at is what the margin leaves —
        // an arrangement chosen against the whole terminal would be four columns too wide for
        // the box it is drawn in, and a line folded to the whole terminal would be broken again
        // at the margin by the layout.
        columns: insideTheMargin(columns),
        rows: within,
        // AND THE RENDERER IS THE ONE FOR THAT WIDTH, out of the same number the arrangement is
        // chosen by rather than out of a renderer resolved when the process opened. It is asked
        // here rather than closed over because this whole function is a function OF the size:
        // an opening composed for two hundred columns whose lines were folded to seventy is the
        // defect this delivery is named after, one region up.
        render: renderingAt(insideTheMargin(columns)),
        title,
        mark,
        standing: where,
        record,
        beneath: refuses,
      });
    // WHAT THE PAGE SPENDS THAT NO DRAWING CHANGES: the input area at the bottom, in
    // whichever arrangement this terminal has room for.
    const underneath = areaFor({
      rows,
      columns,
      badge: badge.width,
      hint: hint.width,
      palette: NOTHING_OFFERED_YET,
      header: NOTHING_ABOVE_YET,
    }).height;
    return drawnWith(
      bannerFor({
        columns,
        rows,
        // HOW TALL A SCREEN A GIVEN DRAWING NEEDS — the taller of two demands, and the second one
        // is what this delivery had to add.
        //
        // IT ASKED ONE QUESTION AND THE QUESTION ANSWERED ITSELF. It was *how many rows does
        // the PAGE need with this drawing in it*, and the answer was measured on the page the
        // drawing would really produce — including the case where the arrangement had already
        // been given up for busting its share, which is a page with NO fixed region at all and
        // therefore the cheapest page there is. So the biggest drawing was kept precisely
        // BECAUSE it had cost the arrangement: at eighty by twenty-four, nine rows of art plus
        // the text under it came to twenty-two of the twenty-four when the two were landed on
        // the roll, `22 <= 24` was true, and nothing ever made the art give way. A rule whose
        // threshold is satisfied by the damage it is meant to prevent is worse than no rule.
        //
        // SO WHAT IS ASKED IS ABOUT THE ARRANGEMENT THIS DRAWING WOULD PRODUCE. The opening is
        // composed a second time with NO CEILING on the height ({@link WHATEVER_THE_HEIGHT}),
        // which is the form the WIDTH alone allows — what the arrangement would cost if it were
        // drawn — and the share says the shortest screen that may hold it (`panel.ts`,
        // `theShortestScreenFor`). A drawing whose arrangement wants more than its share is a
        // drawing this screen cannot afford, whatever the page would cost with it gone.
        //
        // BOTH DEMANDS, BECAUSE THEY ARE DIFFERENT FAILURES. A page taller than the screen opens
        // with its own top in the scrollback; an arrangement over its share holds rows the
        // caller's answers never get back. The taller of the two is the screen this drawing
        // needs, and `bannerFor` compares it with the one there is.
        needs: (drawing) =>
          Math.max(
            drawnWith(drawing).rows + underneath,
            theShortestScreenFor(drawnWith(drawing, WHATEVER_THE_HEIGHT).above),
          ),
      }),
    );
  };

  const { openConsole } = await import('./console.js');
  const page = openConsole({
    stdin: input,
    stdout: output,
    prompt: PROMPT,
    renderingAt,
    openingFor: theOpening,
    // Rendered ONCE, above, and handed over as bytes: the tips say nothing about the
    // record, so nothing can happen inside the session that changes what they say. The
    // opening reads the same value, because how tall the area under it is is part of
    // whether the page fits.
    tips: hint,
    // AND THE ROW UNDER THE LIST, as a LINE rather than as bytes: it is one of the palette's own
    // rows, so it is rendered and measured with them (`palette.ts`). Composed once, for the
    // reason the tips are — three keystrokes, and nothing about the record.
    picking: pickingTips(),
    // Also rendered once — out of the ONE read this surface pays for. It does say
    // something about the record, which is exactly why it may not be asked again.
    badge,
    saw: seen.saw,
    // WHAT SOMEBODY ELSE WROTE, as lines — composed where every line of this product is
    // and rendered with the session's own renderer, so an occurrence reads exactly like
    // the same event read back by `timeline`. This surface writes nothing, so every one
    // of them is another process's append (`following.ts`).
    happened: () => following.whatHappened().map((event) => render(occurrenceLine(event))),
    complete: completerFor(completionTree(built.program), offered, vocabulary, seen.matching),
    answer: (line) => typedLine(line, session),
    leaving,
  });
  land = page.land;
  // AND HOW A LINE BECOMES BYTES, for the same reason the door onto the page is taken from
  // here: what a verb prints is folded to the width of the frame it is landing on, and the
  // console is the one thing that has asked the device how wide that is.
  renderOn = page.render;
  await page.closed;
}

/**
 * A line as the console needs it: the bytes, and how many columns they take.
 *
 * BOTH HALVES ARE ASKED HERE because this is where the line is. The renderer turns it into
 * bytes and `widthOf` counts the plain rendering, which is the same number of columns the
 * painted one takes — the escapes a terminal does not print are exactly the difference
 * between the two. A console that counted the bytes would make a hint that fits look too
 * wide the moment colour was switched on, and the arrangement it chose would be the narrow
 * one on a screen with room to spare.
 *
 * No line at all is no bytes and no width, which is what the area reads as "there is
 * nothing to draw here".
 */
function drawn(line: Line | undefined, render: Render): Drawn {
  return line === undefined ? { text: '', width: 0 } : { text: render(line), width: widthOf(line) };
}

/**
 * WHAT THE RECORD IS, asked ONCE, when the session opens — and the only read of the
 * record anything on this surface makes without being asked for one.
 *
 * IT IS A DECLARED EXCEPTION AND IT HAS A NUMBER. Everything else the opening says is
 * answered by the filesystem without opening a chain, deliberately, because `verify` over
 * a real record costs about a tenth of a second and a bar that asked the record anything
 * would pay that again on every redraw (`standing.ts`). The panel is not a bar: it is
 * written once and kept, so what it costs is paid once — a session that opened in about a
 * third of a second opens in a bit more, and what the caller gets for it is a console for
 * auditing a record that says, before they type anything, whether the record is intact.
 * That is the product presenting itself by its own thesis.
 *
 * THE OTHER HALF OF THE RULE IS UNTOUCHED, and it is the half with teeth: nothing that
 * REDRAWS reads the record, ever. `tests/the-name-and-the-hints.test.ts` counts the reads
 * of both — the opening's are exactly one `verify`'s worth, and a frame's are none.
 *
 * The minimum is a bare `verify`'s, because this is not a gate: it shows what the record
 * is and exits nothing, so a stricter minimum would only change a word nobody acts on.
 * With no project there is nothing to rule on and it says nothing at all, which is the
 * same posture the status line takes about a fact it does not have.
 */
function theRecord(): TheRecord | undefined {
  const verdict = runVerify({ ...here(), requirement: DEFAULT_REQUIREMENT, global: false });
  return verdict.ok ? { trees: verdict.trees, level: verdict.record.level } : undefined;
}

/**
 * What the one read answered, as the two things the opening makes out of it.
 *
 * They travel together because they came out of one call and must not be asked for
 * separately: the panel says a line per tree and the badge says the ONE level over all of
 * them, and a corner that asked its own question could answer it at a different instant.
 */
interface TheRecord {
  /** Every tree the verdict covered, in the order it reported them. */
  readonly trees: readonly TreeReport[];
  /** The weakest level any of them reached — what the exit code of the verb reads. */
  readonly level: ProvenLevel;
}

/**
 * What the record is, as a section: the heading, then one line per tree of it.
 *
 * Each line is the tree's verdict SHORTENED BY THE VERB THAT WORDS IT (`wiring/verify.ts`)
 * and never here — what a tree's name and its level clause say is a prefix of what
 * `mnema verify` prints for the same tree, byte for byte, and the surface that shortened a
 * verdict any other way would be wording one.
 */
function recordSection(trees: readonly TreeReport[] | undefined): readonly Line[] {
  if (trees === undefined) return [];
  return [subjectLine(THE_RECORD), ...trees.map((tree) => treeHeadline(tree, UNDER_A_HEADING))];
}

/**
 * Does with one typed line what the session does with it, and says whether it goes on.
 *
 * The whole decision is `dispositionOf`, over the declarations of the program THIS line
 * is about to be parsed by — so what was decided about and what runs are one
 * registration, and a command reaching that program by any other path carries no
 * declaration and lands on the deny side.
 *
 * Exported because the console above is the only thing in this file that needs a
 * terminal: everything a session DOES with a line is here, and it can be driven,
 * asserted and timed without one.
 */
export async function typedLine(line: string, session: Session): Promise<AfterLine> {
  const { render, self } = session;
  // The line's own exit code stays off the process. A session that opened and closed
  // cleanly exits zero even if a verb inside it refused — which is what `node`,
  // `python` and `psql` all do, and what keeps `$?` from reporting a typo as a failed
  // session. The refusal itself is on the page, painted, like every other no.
  const io: CliIo = { out: session.io.out, err: session.io.err, fail: () => undefined };

  // Tokenized here for the parser's own refusals, which name what the caller typed, and
  // again inside the disposition. `argvOf` is pure, so the two readings are one reading.
  // It stays what the CALLER typed even when the session fills a flag in below: a
  // refusal that quoted a token nobody wrote would be the surface accusing them of its
  // own line.
  const built = buildProgram(io, argvOf(line) ?? [], render);
  const what = dispositionOf(line, built.verbs, self);
  switch (what.does) {
    case 'nothing':
      return 'go on';
    case 'leave':
      return 'leave';
    case 'about':
      writeLines(io, about(built.verbs, self).map(render));
      return 'go on';
    case 'clear':
      // What a clean page IS belongs to the console: nothing here is read, said or
      // composed for it, which is the whole of why it costs nothing.
      return 'clear';
    case 'refuse':
      reportUsage({ io, render }, what.sentence, what.detail);
      return 'go on';
    case 'run':
      // THE ONE PLACE THE LINE IS ASSEMBLED, which is why the identity is filled in here
      // and nowhere else: what the gate decided about and what the parser receives are
      // the same words, plus the one thing the caller did not have to type because the
      // session already knew it (`asking.ts`). A caller who typed it keeps what they
      // typed, and a session that knows nobody hands the line over untouched.
      await parseWith(built, asTheSession(what.argv, built.verbs, session.identity));
      return 'go on';
  }
}

/**
 * THE SENTENCE THAT MAY NOT GO, and by now it is the whole of what the opening lands
 * under the panel.
 *
 * It is the only thing that explains, to somebody who just opened a prompt, why half of
 * what they know how to type is about to be refused — and it counts the reads rather than
 * stating a number, so it cannot go stale.
 *
 * IT IS NOT ONE OF THE PANEL'S OWN ROWS, AND THAT IS MEASURED RATHER THAN AESTHETIC — but not
 * for the reason this paragraph used to give. IT SAID that inside the panel's right-hand
 * column the sentence "would push the box past eighty columns", and that was false from the
 * moment the box stopped being as wide as its content: it was drawn corner to corner, so the
 * width of the box was the TERMINAL'S and nothing inside it could push it anywhere. AND
 * THERE IS NO BOX AT ALL NOW, which does not put the first argument back — it removes the
 * subject of it.
 *
 * WHAT SURVIVES OF THE ARGUMENT IS ABOUT THE FORM, and it is still a measurement. The panel
 * chooses its arrangement by the width its CONTENT needs (`panel.ts` — the mark, the gap, and
 * the widest row of the text beside it), so a line of seventy-odd columns among those rows
 * would make the two columns cost about a hundred and twenty-eight and the form would give way
 * to the stacked one on the terminal a person opens. The sentence keeps the shape it has always
 * had, at the depth it has always had, and the panel keeps the arrangement that lets the mark
 * and what the record is be seen at once.
 *
 * LIKE THE PANEL IT IS STATIC, and that is the difference from the tips below: it lands in
 * the scrollback and stays there, so a caller who scrolls to the top of a long session
 * finds the drawing, this sentence and the project the whole thing was about. It is part
 * of what the page OPENS with, so a caller who clears the page finds it there too.
 *
 * Exported for the reason {@link about} is, and it earns it separately: it is the one line the
 * OPENING lands on the roll, so it is the subject of the only case that can say the page a
 * session opens with folds to the terminal it is being drawn on
 * (`tests/one-width-per-frame.test.ts`).
 */
export function whatItRefuses(reads: number): readonly Line[] {
  return [
    fact(`It runs the ${reads} verbs that read the record, and refuses the ones that write.`),
  ];
}

/**
 * Where the session is, as one line — or as no line at all when it knows neither fact.
 *
 * Absent rather than apologetic: a session opened outside any project, or on a machine
 * whose key root holds no single key, has nothing true to say here, and a line saying
 * "unknown" twice would be the surface filling space. What it knows, it says.
 *
 * IT IS AN ASIDE AND IT USED TO BE A FACT, which moves not one byte of what a reader gets
 * in a pipe and dims it in a terminal. A fact is about the RECORD; this says where the
 * session is standing and the record was not consulted for either half of it, which is
 * the distinction `aside` already draws (`presentation/detail.ts`). It is also what the
 * reference the panel was drawn from does with a path and an identity, and for the same
 * reason: they are what a reader glances at once and then skips past.
 *
 * Exported for the reason {@link tips} is: it is the one line of the opening a WINDOW can be
 * narrower than — a path is as long as the directory somebody is working in — so it is the
 * subject of the case that says the opening folds to the terminal it is drawn on, and a case
 * that rebuilt it here would be a second composition of it
 * (`tests/one-width-per-frame.test.ts`).
 */
export function standingLine(where: Standing): readonly Line[] {
  const known = [where.project, where.identity].filter((value) => value !== undefined);
  return known.length === 0 ? [] : [aside(known.join(BETWEEN_CLAUSES))];
}

/**
 * WHAT THE CALLER CAN DO — the one line of the session that does not scroll away.
 *
 * It used to be the third line of the opening and it moved, which is the whole of the
 * change that put it here: after ten reads the affordances were somewhere above the top of
 * the screen, and a hint a caller has to scroll to find is not a hint. It lives under the
 * row being typed now, in the region the layout redraws, so it is on the screen for as
 * long as there is a prompt to type at.
 *
 * IT USED TO SAY FIVE THINGS AND IT SAYS THREE, and that is measured rather than trimmed
 * for taste. Five clauses came to about a hundred and ten characters, which the terminal
 * folded into two rows below ninety-seven columns — so the row that exists in order to be
 * glanced at was the tallest thing in the region on an ordinary screen. The reference this
 * console was measured against says three things in about fifty characters, and three is
 * what a person reads without stopping.
 *
 * WHICH THREE, AND WHY THEY ARE THESE: each clause is a KEY and what that key gives. The
 * key that lists everything else, so nothing dropped is lost; the key that completes, which
 * is the one affordance a caller cannot guess by typing; and the way out, which is the
 * thing nobody wants to look for.
 *
 * IT NAMED TWO WORDS AND IT NAMES NONE. The first clause used to be `/help` and the last
 * used to be `/exit`, and the palette is what took both: the slash opens the list they are
 * IN, so a hint that pointed at the list and then quoted an item from it would be spending
 * a clause on what the clause beside it already hands over. Nothing was lost — both moved
 * one keystroke closer — and what is left in the hint is three keystrokes, which are in no
 * list and cannot be looked up.
 *
 * AND THE SAVING IS THE POINT, because this row has a WIDTH rule over it now: a hint the
 * terminal would fold is not drawn at all (`area.ts`), so every column it does not spend is
 * a narrower terminal that still gets it. Seventy-four columns to fifty-three, measured —
 * the difference between a hint an eighty-column terminal keeps and one a sixty-column
 * terminal keeps.
 *
 * IT PROMISES NOTHING THAT IS NOT THERE. A row under the prompt is the most believed
 * sentence on the surface, and a hint naming an affordance that does not answer yet would
 * be the console lying to the one reader who cannot check.
 *
 * It says nothing about the record and takes no argument, so it is resolved once when the
 * session opens and never asked again.
 *
 * Exported so a test can tell this row apart from a line the record produced without
 * retyping it: the two would drift, and the case that compares what a verb says inside the
 * console to what it says at a shell would then be comparing a stale list.
 */
export function tips(): Line {
  return aside([WHAT_THE_SLASH_DOES, TAB_COMPLETES, HOW_TO_LEAVE].join(BETWEEN_CLAUSES));
}

/**
 * THE KEYS THAT MOVE THE LIST OF WORDS, as the row that sits UNDER it — three clauses, in the
 * voice the row under the prompt already speaks.
 *
 * IT IS A SECOND HINT AND NOT A LONGER FIRST ONE, and where it goes is the whole argument. The
 * row under the prompt says what is true of the session at every moment of it, so it may not
 * grow a clause about a list that is shut most of the time — and the three keys here mean
 * nothing until the list is open. It is drawn beside what it governs instead, which is what the
 * console this surface was measured against does with the same sentence: its selector says
 * *Enter to confirm · Esc to cancel* directly under the rows those keys act on, and its
 * permanent row goes on saying what it always says.
 *
 * THE ARROWS ARE NAMED FIRST BECAUSE THEY ARE THE DISCOVERY. Return and Escape mean here what
 * they mean in every menu a reader has ever used; what nothing on the screen could otherwise
 * say is that the arrows have stopped browsing what was typed before and started moving through
 * the list (`editing.ts`).
 *
 * AND WHAT RETURN DOES IS SAID EXACTLY: it FILLS the row rather than running the word. Half the
 * verbs of this product take arguments, so a pick that ran what it landed on would take the
 * caller's chance to finish the line — and a hint that said *Enter runs it* would be promising
 * the one thing this key deliberately does not do.
 *
 * It says nothing about the record and takes no argument, so it is resolved once when the
 * session opens, exactly like {@link tips}. Exported for the reason that one is: a case that had
 * to tell this row from a row of the list would otherwise retype it.
 */
export function pickingTips(): Line {
  return aside([ARROWS_MOVE, RETURN_FILLS, ESCAPE_SHUTS].join(BETWEEN_CLAUSES));
}

/**
 * THE WORDS THE SESSION ANSWERS TO ITSELF, each with what it does — one value, two
 * readers.
 *
 * A Tab completes them and a slash lists them, and they are the same list read off the
 * same table (`session-words.ts`, where a word that has no gloss cannot exist because it
 * would have nothing to be a key of). Two derivations would be a menu that offers a word
 * the completer does not know, or the reverse.
 *
 * Exported so a case can assert what the slash opens against the source rather than
 * against a retyped list.
 */
export function theSessionsOwnWords(): readonly CompletionWord[] {
  return Object.entries(WHAT_EACH_WORD_DOES).map(([word, description]) => ({ word, description }));
}

/**
 * WHAT THE RECORD PROVED, as the one row that stays in the corner: the mark, the level,
 * and the verb that says the whole sentence.
 *
 * `valor · comando` is the shape of the reference's own corner, measured rather than
 * guessed (a mark, a value, a middle dot with one space on each side, and the word that
 * changes it). What goes in it is this product's own answer to what deserves to be fixed
 * in the corner of a console for AUDITING a record: the proven LEVEL, which is the thesis,
 * and `verify`, which is the verb that prints the verdict the level was folded out of.
 *
 * THE LEVEL IS THE WORST OF THE TREES, and it is the worst by the function that already
 * decides it rather than by a fold written here — `runVerify` returns one level over every
 * tree it covered, and the exit code of `mnema verify` is decided by that same value
 * (`commands/verify.ts`, `weakerLevel`). A second opinion in a corner would be a console
 * that says a record is fine while the verb says it is not.
 *
 * Exported for the same reason {@link tips} is: a test that has to tell this row apart
 * from a line the record produced would otherwise retype it, and a retyped row goes stale
 * the day the shape changes — which is exactly the case that compares what a verb says
 * inside the console to what it says at a shell (`tests/the-console-on-ink.test.ts`).
 *
 * THIS USED TO SAY *IT CARRIES NO HUE, AND THAT IS A DECISION RATHER THAN AN OMISSION*,
 * on three arguments: that a row redrawn on every keystroke and sitting in the corner of
 * every session would be a hue that is always on, that the level is painted where it is
 * RULED ON and this row only names it, and that leaving it unpainted made it the one line
 * about the record whose plain and painted bytes are the same.
 *
 * WHAT FALSIFIED IT IS WHAT THIS PRODUCT IS FOR. The first argument holds for GREEN and
 * does not hold for RED: this is a tool for making tampering evident, so the cost of a
 * reader NOT noticing a broken record is not the cost of a constant green, and the badge is
 * the PERSISTENT ASSERTION of the proven level rather than a decoration beside one. A
 * corner that stays quiet while the record is broken is the one failure this surface may
 * not have. The second argument was answered by its own premise: where a level is ruled on
 * it is painted, and this row states a level, so not painting it made it the EXCEPTION to
 * "data is painted by severity and by nothing else" — painting REMOVES an exception instead
 * of adding one. The third survived as a fact and stopped being a reason: the words are
 * still the whole carrier, and stripping the escapes still gives this exact line back, byte
 * for byte (`tests/the-input-has-its-own-place.test.ts`).
 *
 * THE HUE IS THE ONE FUNCTION'S, and this row has no rule of its own. `levelSeverity` is
 * the table that says how each rung of the scale reads as news, total over the chain's
 * levels by type, and it is what `verify` and the panel already paint by. A condition here
 * — paint only when it is bad news — would be a second opinion about which levels are news
 * at all, which is exactly what one table exists to prevent.
 */
export function badgeLine(level: ProvenLevel): Line {
  return statement(
    `${LEVEL_MARK} ${level}${BETWEEN_CLAUSES}${VERIFY_VERB}`,
    undefined,
    levelSeverity(level),
    AT_THE_EDGE,
  );
}

/**
 * What {@link ABOUT} answers: the verbs this session runs, and how to leave it.
 *
 * Composed from the DECLARATIONS, so a read added tomorrow is listed the day it exists
 * and its one-line description is the same one `--help` prints. It is the session's
 * answer and not the program's on purpose: `mnema --help` lists every verb there is,
 * eleven of which this session refuses, and a menu of what you cannot have is worse
 * than no menu.
 *
 * Exported for the reason {@link tips} and {@link badgeLine} are: these are the widest rows
 * this session prints, so they are what a case about FOLDING has to be measured against, and
 * a case that retyped them would go stale the day a verb's description changes
 * (`tests/one-width-per-frame.test.ts`).
 */
export function about(verbs: readonly Declared[], self: string): readonly Line[] {
  const offered = verbsOffered(verbs, self);
  const described = verbs.filter((verb) => offered.includes(verb.command.name()));
  return [
    subjectLine('This session reads the record'),
    ...described.map((verb) =>
      itemLine([column(verb.command.name(), VERB_WIDTH), verb.command.description()]),
    ),
    subjectLine('And it does not write'),
    fact('A verb that can change the record is refused, and named, and told where to run.'),
    fact(`Leave with \`${LEAVE}\`, or Ctrl-D. Ctrl-C clears the line you are typing.`),
    fact(
      `\`${CLEAR}\` starts the page over. What was on it is one scroll up, and the record is not read again.`,
    ),
  ];
}
