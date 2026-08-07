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
import { completionTree } from '../completion/tree.js';
import { bannerFor } from '../presentation/banner.js';
import { aside, fact, subjectLine } from '../presentation/detail.js';
import { column, itemLine } from '../presentation/items.js';
import type { Line } from '../presentation/line.js';
import type { Render } from '../presentation/render.js';
import { ABOUT, CLEAR, LEAVE, SESSION_WORDS } from '../session-words.js';
import { VERSION } from '../version.js';
import { here } from '../wiring/context.js';
import { writeLines } from '../wiring/io.js';
import { reportUsage } from '../wiring/report.js';
import type { Declared } from '../wiring/verb.js';
import { DEFAULT_REQUIREMENT, treeHeadline, VERIFY_VERB } from '../wiring/verify.js';
import { completerFor } from './complete.js';
import { type AfterLine, argvOf, dispositionOf, verbsOffered } from './gate.js';
import type { Leaving } from './leaving.js';
import { type Opening, panelFor, panelLines } from './panel.js';
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

/** The product, and what this session is — the box's title, and its first line without one. */
const NAME = 'mnema';
const WHAT_IT_IS = 'a session over this project';

/**
 * WHICH BUILD THIS IS, on the title beside the name.
 *
 * It is the one fact about the PRODUCT the opening states, and it is there because a
 * console is where somebody reports what they saw: a screenshot of a box that names the
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

/** What the two sections of the panel are called. */
const THE_RECORD = 'The record';
const WHAT_TO_TYPE = 'Hints';

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
 * The one affordance that is not a keystroke: the word that lists the verbs.
 *
 * It is named apart from the three beside it because the panel shows THIS one and the row
 * under the prompt shows all four, out of the same constant — a second copy would be two
 * sentences about one session, and the second one goes stale on the day the first is
 * reworded.
 */
const WHAT_IT_RUNS = `\`${ABOUT}\` says what it runs`;

/**
 * THE OTHER TWO CLAUSES OF THE HINT, and there are two of them because three is the whole
 * of it (see {@link tips}).
 *
 * The key that completes and the two ways out. Neither is a WORD the session answers to —
 * they are keystrokes, so there is no vocabulary to read them off — and the word that IS
 * one comes from the constant that declares it, so a renamed word renames the hint.
 */
const TAB_COMPLETES = 'Tab completes';
const HOW_TO_LEAVE = `\`${LEAVE}\` or Ctrl-D leaves`;

/** What one line of the session needs: where to write, how, and what it is called. */
export interface Session {
  /** Where a command's output goes — the caller's own port. */
  readonly io: CliIo;
  /** How a line becomes bytes, resolved once for the whole session. */
  readonly render: Render;
  /** The name the session's own verb was registered under (see {@link verbsOffered}). */
  readonly self: string;
}

/** Everything opening a session needs beyond one line's worth. */
export interface SessionRequest extends Session {
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
  const { io, render, self, input, output, interactive, leaving } = request;

  // The refusal, in the product's own voice, before anything is opened. It says what
  // to do instead, because a caller who piped something in wanted an answer and there
  // is one: the verb, typed directly. It goes to the caller's own port and not to a
  // console, because the decision not to open one is what is being reported.
  if (!interactive) {
    reportUsage(
      { io, render },
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
  const session: Session = { io: onThePage, render, self };

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
  const where = standingLine(standing());
  const proved = theRecord();
  const record = recordSection(proved?.trees);
  const hints = [subjectLine(WHAT_TO_TYPE), aside(WHAT_IT_RUNS)];
  const refuses = whatItRefuses(offered.length).map(render);
  // NO PROJECT, NO BADGE. There is no record to name a level of, so the corner says
  // nothing at all — the same posture the line that says where the session is standing
  // takes about a fact it does not have, and the same one the panel's record section takes.
  const badge = proved === undefined ? '' : render(badgeLine(proved.level));

  /**
   * WHAT THE PAGE OPENS WITH on a terminal `columns` wide — and the only thing on this
   * surface a width decides.
   *
   * PURE, AND THAT IS THE POINT OF IT BEING A FUNCTION. The console calls it when the page
   * opens and again whenever the caller has finished resizing their window, and between
   * those two calls nothing is read: the lines above already exist, and the two answers
   * that depend on the width are which drawing there is ROOM for (`panelFor`) and how much
   * of the name is DRAWN (`bannerFor`). A recomposition that asked the record again could
   * make the panel say something different halfway through a session, which is worse than
   * costing a tenth of a second — and the reads are counted rather than promised
   * (`tests/the-name-and-the-hints.test.ts`).
   */
  const openingFor = (columns: number): Opening => {
    const panel = panelFor({
      columns,
      render,
      title,
      mark: bannerFor(columns),
      standing: where,
      record,
      hints,
    });
    return {
      // A terminal too narrow for a box gets no box, and the same lines land instead —
      // which is why the layout has two forms and not three.
      panel: panel.form === 'bare' ? undefined : panel,
      lines: [...(panel.form === 'bare' ? panelLines(panel) : []), ...refuses],
    };
  };

  const { openConsole } = await import('./console.js');
  const page = openConsole({
    stdin: input,
    stdout: output,
    prompt: PROMPT,
    openingFor,
    // Rendered ONCE, here, and handed over as bytes: the tips say nothing about the
    // record, so nothing can happen inside the session that changes what they say.
    tips: render(tips()),
    // Also rendered once — out of the ONE read this surface pays for. It does say
    // something about the record, which is exactly why it may not be asked again.
    badge,
    complete: completerFor(completionTree(built.program), offered, SESSION_WORDS),
    answer: (line) => typedLine(line, session),
    leaving,
  });
  land = page.land;
  await page.closed;
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
      await parseWith(built, what.argv);
      return 'go on';
  }
}

/**
 * THE SENTENCE THAT MAY NOT GO, and by now it is the whole of what the opening lands
 * beside the panel.
 *
 * It is the only thing that explains, to somebody who just opened a prompt, why half of
 * what they know how to type is about to be refused — and it counts the reads rather than
 * stating a number, so it cannot go stale.
 *
 * IT IS OUTSIDE THE BOX, AND THAT IS MEASURED RATHER THAN AESTHETIC. It is seventy-odd
 * characters wide; inside the panel's right-hand column it would be the widest thing there
 * and would push the box past eighty columns, which is where the panel gives up on being a
 * box at all (`panel.ts`). So the sentence keeps the shape it has always had, at the depth
 * it has always had, and the box keeps the widths that let it exist on an ordinary
 * terminal.
 *
 * LIKE THE PANEL IT IS STATIC, and that is the difference from the tips below: it lands in
 * the scrollback and stays there, so a caller who scrolls to the top of a long session
 * finds the drawing, this sentence and the project the whole thing was about. It is part
 * of what the page OPENS with, so a caller who clears the page finds it there too.
 */
function whatItRefuses(reads: number): readonly Line[] {
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
 */
function standingLine(where: Standing): readonly Line[] {
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
 * what a person reads without stopping. What went is what {@link ABOUT} answers in full:
 * the word that clears the page, and the key that clears the line.
 *
 * WHICH THREE, AND WHY THEY ARE THESE: the word that lists everything else, so nothing
 * dropped is lost; the key that completes, which is the one affordance a caller cannot
 * guess by typing; and the way out, which is the thing nobody wants to look for. The first
 * and the last are read off the constants that DECLARE those words, so a renamed word
 * renames the hint.
 *
 * ⛔ IT PROMISES NOTHING THAT IS NOT THERE. A row under the prompt is the most believed
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
  return aside([WHAT_IT_RUNS, TAB_COMPLETES, HOW_TO_LEAVE].join(BETWEEN_CLAUSES));
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
 * IT CARRIES NO HUE, and that is a decision rather than an omission. Where a level is
 * RULED ON — the panel's line per tree, and `verify`'s own — it is painted by the one
 * function that says how a level reads as news (`wiring/verify.ts`, `levelSeverity`). This
 * row is on the screen for the whole session and is redrawn on every keystroke, and a hue
 * that is on every frame of every session is a hue nobody reads any more; it is also the
 * one row of this surface where plain and painted are the same bytes, which is what makes
 * a screenshot of it and a pipe of it the same claim. The words are the carrier here, as
 * they are everywhere else on this surface.
 */
export function badgeLine(level: ProvenLevel): Line {
  return fact(`${LEVEL_MARK} ${level}${BETWEEN_CLAUSES}${VERIFY_VERB}`, AT_THE_EDGE);
}

/**
 * What {@link ABOUT} answers: the verbs this session runs, and how to leave it.
 *
 * Composed from the DECLARATIONS, so a read added tomorrow is listed the day it exists
 * and its one-line description is the same one `--help` prints. It is the session's
 * answer and not the program's on purpose: `mnema --help` lists every verb there is,
 * eleven of which this session refuses, and a menu of what you cannot have is worse
 * than no menu.
 */
function about(verbs: readonly Declared[], self: string): readonly Line[] {
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
