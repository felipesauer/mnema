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
 *   - IT PERSISTS NOTHING. The history is readline's, which lives in memory for the
 *     length of the process and goes nowhere. A file would have to live in the caller's
 *     home — this product writes inside `.mnema/` and nowhere else — and WHERE is a
 *     decision nobody has taken.
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
 * THE OUTPUT IS THE SURFACE'S OWN. Every line a command prints goes through the same
 * `io` and the same renderer every other invocation uses, and inside a terminal that
 * renderer is the styled one — so this is the first place where painting is the normal
 * path rather than the exception. `strip(what a command says here)` is what the same
 * command says in a pipe, byte for byte, and that is asserted rather than hoped for.
 * The two bytes this file writes to the terminal ITSELF — the prompt, and the newline
 * that ends the session on the caller's own line — are not a report and carry no style:
 * a painted prompt is escape bytes readline has to do arithmetic over, and it would be
 * the one string on this surface a renderer never saw.
 */

import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { buildProgram, type CliIo, parseWith } from '../cli.js';
import { completionTree } from '../completion/tree.js';
import { fact, subjectLine } from '../presentation/detail.js';
import { column, itemLine } from '../presentation/items.js';
import type { Line } from '../presentation/line.js';
import type { Render } from '../presentation/render.js';
import { writeLines } from '../wiring/io.js';
import { reportUsage } from '../wiring/report.js';
import type { Declared } from '../wiring/verb.js';
import { completerFor } from './complete.js';
import { ABOUT, argvOf, dispositionOf, LEAVE, SESSION_WORDS, verbsOffered } from './gate.js';

/** What a caller types in front of. Plain, for the reason the file's doc gives. */
const PROMPT = 'mnema> ';

/**
 * How many lines readline keeps to scroll back through.
 *
 * In memory and nowhere else: readline has no notion of a history file, which is why
 * it is the interface this session is built on rather than `node:repl`, whose history
 * DOES reach the disk when an environment variable points it there.
 */
const HISTORY = 500;

/** How wide the verb column of `.help` is — the longest verb, and a space after it. */
const VERB_WIDTH = 16;

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
  readonly input: NodeJS.ReadableStream;
  /** Where the prompt and the echo go. Not where a report goes — that is `io`. */
  readonly output: NodeJS.WritableStream;
  /** Whether BOTH ends are a terminal, asked at the entry where the process is. */
  readonly interactive: boolean;
}

/** Whether the session goes on after a line, or closes. */
export type AfterLine = 'go on' | 'leave';

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
  const { io, render, self, input, output, interactive } = request;

  // The refusal, in the product's own voice, before anything is opened. It says what
  // to do instead, because a caller who piped something in wanted an answer and there
  // is one: the verb, typed directly.
  if (!interactive) {
    reportUsage(
      { io, render },
      `\`mnema ${self}\` is an interactive session and this is not a terminal`,
      'Run the verb itself — `mnema <verb>` — when input or output is a pipe, a file or a log.',
    );
    return;
  }

  const session: Session = { io, render, self };
  // The declarations and the command tree, read off a program built the way every line
  // will build one. What Tab offers is therefore what the gate will accept, from the
  // same registration.
  const built = buildProgram(io, [], render);
  const offered = verbsOffered(built.verbs, self);
  const rl = createInterface({
    input,
    output,
    terminal: true,
    prompt: PROMPT,
    historySize: HISTORY,
    removeHistoryDuplicates: true,
    completer: completerFor(completionTree(built.program), offered, SESSION_WORDS),
  });

  writeLines(io, opening(offered.length).map(render));

  // ONE LINE AT A TIME, and it is a chain rather than a flag because readline does not
  // wait. An `async` handler returns at its first `await`, and a caller who pastes three
  // lines has already given readline all three — so the three commands ran at once over
  // one record, their answers came back interleaved, and the one that finished after
  // `.exit` prompted a closed interface. Measured, in a real terminal, on the first
  // probe of this file. Each line now waits for the one before it.
  let closing = false;
  let pending: Promise<void> = Promise.resolve();

  rl.on('line', (line) => {
    pending = pending.then(async () => {
      if (closing) return;
      // Paused while the command runs, so keystrokes wait in the terminal rather than
      // being echoed into the middle of an answer.
      rl.pause();
      if ((await typedLine(line, session)) === 'leave') {
        closing = true;
        rl.close();
        return;
      }
      rl.prompt();
    });
  });
  rl.on('close', () => {
    closing = true;
  });
  rl.on('SIGINT', () => {
    // The LINE, not the session: kill what was typed and prompt again.
    if (closing) return;
    output.write('\n');
    rl.write(null, { ctrl: true, name: 'u' });
    rl.prompt();
  });

  // Awaited from BEFORE the first prompt: input that is already at its end closes the
  // interface immediately, and a promise created after that would wait for an event
  // that has been and gone.
  const closed = once(rl, 'close');
  rl.prompt();
  await closed;
  await pending;
  // The caller's shell prompt starts on a line of its own, whichever way they left.
  output.write('\n');
}

/**
 * Does with one typed line what the session does with it, and says whether it goes on.
 *
 * The whole decision is `dispositionOf`, over the declarations of the program THIS line
 * is about to be parsed by — so what was decided about and what runs are one
 * registration, and a command reaching that program by any other path carries no
 * declaration and lands on the deny side.
 *
 * Exported because the loop above is the only thing in this file that needs a terminal:
 * everything a session DOES with a line is here, and it can be driven, asserted and
 * timed without one.
 */
export async function typedLine(line: string, session: Session): Promise<AfterLine> {
  const { render, self } = session;
  // The line's own exit code stays off the process. A session that opened and closed
  // cleanly exits zero even if a verb inside it refused — which is what `node`,
  // `python` and `psql` all do, and what keeps `$?` from reporting a typo as a failed
  // session. The refusal itself is on the stream, painted, like every other no.
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

/** What the session says when it opens: what it is, and the two words it answers to. */
function opening(reads: number): readonly Line[] {
  return [
    subjectLine('mnema', 'a session over this project'),
    fact(`It runs the ${reads} verbs that read the record, and refuses the ones that write.`),
    fact(`\`${ABOUT}\` says what it runs · \`${LEAVE}\` or Ctrl-D leaves · Ctrl-C clears the line`),
  ];
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
