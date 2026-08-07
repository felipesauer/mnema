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

import { buildProgram, type CliIo, parseWith } from '../cli.js';
import { completionTree } from '../completion/tree.js';
import { bannerFor } from '../presentation/banner.js';
import { aside, fact, subjectLine } from '../presentation/detail.js';
import { column, itemLine } from '../presentation/items.js';
import type { Line } from '../presentation/line.js';
import type { Render } from '../presentation/render.js';
import { writeLines } from '../wiring/io.js';
import { reportUsage } from '../wiring/report.js';
import type { Declared } from '../wiring/verb.js';
import { completerFor } from './complete.js';
import {
  ABOUT,
  type AfterLine,
  argvOf,
  dispositionOf,
  LEAVE,
  SESSION_WORDS,
  verbsOffered,
} from './gate.js';
import type { Leaving } from './leaving.js';
import { type Standing, standing } from './standing.js';

/**
 * What a caller types in front of.
 *
 * Plain, and it is the one string on this surface a renderer never sees: it is not a
 * report and it carries no fact. A painted prompt would be escape bytes the console has
 * to do column arithmetic over to put the caret in the right place.
 */
const PROMPT = 'mnema> ';

/** How wide the verb column of `.help` is — the longest verb, and a space after it. */
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
 * How wide a terminal has to be before the banner is asked anything, when the device did
 * not say. Zero, so the narrowest form is drawn: a width nobody reported is not a width to
 * guess at, and the form that always fits is the name.
 */
const NO_WIDTH = 0;

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

  const { openConsole } = await import('./console.js');
  const page = openConsole({
    stdin: input,
    stdout: output,
    prompt: PROMPT,
    // Rendered ONCE, here, and handed over as bytes: the tips say nothing about the
    // record, so nothing can happen inside the session that changes what they say.
    tips: render(tips()),
    complete: completerFor(completionTree(built.program), offered, SESSION_WORDS),
    answer: (line) => typedLine(line, session),
    leaving,
  });
  land = page.land;

  // WHERE THE SESSION IS, asked once and of the filesystem. Everything the opening says
  // about the project and the identity is one `readdir` and one small file; a read of the
  // record here would be paid before the caller could type anything, and paid again by
  // whatever asked it a second time (see `standing.ts` for the measurement).
  writeLines(
    onThePage,
    opening(offered.length, output.columns ?? NO_WIDTH, standing()).map(render),
  );
  await page.closed;
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
    case 'refuse':
      reportUsage({ io, render }, what.sentence, what.detail);
      return 'go on';
    case 'run':
      await parseWith(built, what.argv);
      return 'go on';
  }
}

/**
 * What the session says when it opens: its name drawn, what it is, what it will not do,
 * and where it is standing.
 *
 * ALL OF IT IS STATIC, and that is the difference from the tips below. These lines land in
 * the scrollback and stay there — a caller who scrolls to the top of a long session finds
 * the drawing, the default-deny sentence and the project the whole thing was about, which
 * is exactly what someone reading a transcript afterwards needs and exactly what a redrawn
 * region would have thrown away.
 *
 * THE SENTENCE ABOUT THE VERBS IS THE ONE THAT MAY NOT GO. It is the only thing that
 * explains, to somebody who just opened a prompt, why half of what they know how to type
 * is about to be refused — and it counts the reads rather than stating a number, so it
 * cannot go stale.
 */
function opening(reads: number, columns: number, where: Standing): readonly Line[] {
  return [
    ...bannerFor(columns),
    subjectLine('mnema', 'a session over this project'),
    fact(`It runs the ${reads} verbs that read the record, and refuses the ones that write.`),
    ...standingLine(where),
  ];
}

/**
 * Where the session is, as one line — or as no line at all when it knows neither fact.
 *
 * Absent rather than apologetic: a session opened outside any project, or on a machine
 * whose key root holds no single key, has nothing true to say here, and a line saying
 * "unknown" twice would be the surface filling space. What it knows, it says.
 */
function standingLine(where: Standing): readonly Line[] {
  const known = [where.project, where.identity].filter((value) => value !== undefined);
  return known.length === 0 ? [] : [fact(known.join(BETWEEN_CLAUSES))];
}

/**
 * WHAT THE CALLER CAN DO — the one line of the session that does not scroll away.
 *
 * It used to be the third line of the opening and it moved, which is the whole of this
 * change: after ten reads the affordances were somewhere above the top of the screen, and
 * a hint a caller has to scroll to find is not a hint. It lives under the row being typed
 * now, in the region the layout redraws, so it is on the screen for as long as there is a
 * prompt to type at.
 *
 * It says nothing about the record and takes no argument, so it is resolved once when the
 * session opens and never asked again.
 *
 * Exported so a test can tell this row apart from a line the record produced without
 * retyping it: the two would drift, and the case that compares what a verb says inside the
 * console to what it says at a shell would then be comparing a stale list.
 */
export function tips(): Line {
  return aside(
    [
      `\`${ABOUT}\` says what it runs`,
      `\`${LEAVE}\` or Ctrl-D leaves`,
      'Ctrl-C clears the line',
      'Tab completes',
    ].join(BETWEEN_CLAUSES),
  );
}

/**
 * What `.help` answers: the verbs this session runs, and how to leave it.
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
  ];
}
