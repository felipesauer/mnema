#!/usr/bin/env node
/**
 * The `mnema` CLI: the program, the parse, and the process.
 *
 * Three layers meet here and nothing else does. `commands/` implements a verb —
 * one adapter per verb, calling ONE core operation. `wiring/` declares a verb to
 * commander — its flags, its help, and what it prints. `presentation/` decides
 * what a line looks like. This file builds the program, hands the wiring the three
 * things every verb may touch (where to write, how a line becomes bytes, and the
 * session its writes are pinned to), and turns a throw into an honest exit code.
 *
 * THE ENTRY IS WHERE THE PROCESS IS, and that is why the style capability is read
 * here: the flag, the environment and whether the destination is a terminal are
 * three facts about this invocation, and `presentation/` may not ask for any of
 * them — a line whose bytes depended on the machine could not be compared to a
 * recorded transcript. Read once, here, and handed down as a renderer.
 *
 * There is no domain logic here and none in the adapters — the logic is the gate
 * and the projections in the core.
 *
 * Output is injected ({@link CliIo}) so the whole program can be driven in a test
 * without spawning a process or writing to the real streams.
 */

import { IdentityUnavailableError } from '@mnema/core';
import { Command, CommanderError, Option } from 'commander';
import type { Render } from './presentation/render.js';
import { VERSION } from './version.js';
import {
  COLOR_HELP,
  COLOR_WHENS,
  type ColorWhen,
  type RenderingAt,
  rendererAtEachWidth,
  rendererFor,
} from './wiring/color.js';
import { registerVerbs } from './wiring/index.js';
import { type CliIo, processIo } from './wiring/io.js';
import { refusalLine, refusalSentence } from './wiring/report.js';
import { pinnedRunResolver } from './wiring/run-pin.js';
import { speakUsageErrors } from './wiring/usage.js';
import type { Declared } from './wiring/verb.js';

export type { CliIo } from './wiring/io.js';

/**
 * Leaves quietly when the reader goes away.
 *
 * `mnema … | head` closes the pipe while we are still writing, and node reports
 * that as an asynchronous `EPIPE` on the stream — which, unhandled, crashes with
 * a stack trace that reads like mnema failed. It did not: the reader stopped
 * listening, which is the normal end of a pipeline, and every Unix tool treats it
 * as one. The output that matters is already through, so exit clean rather than
 * complain into a pipe nobody is reading.
 *
 * Registered on the real streams only, at the entry — the injected io a test
 * drives never touches these.
 */
function exitQuietlyOnClosedPipe(): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EPIPE') process.exit(0);
      throw error;
    });
  }
}

/**
 * The configured program, and the renderer its own `--color` resolves to.
 *
 * The two travel together because the LAST-RESORT report needs both: a throw caught
 * outside the parse is still a refusal, and a refusal is a line before it is bytes (see
 * `wiring/report.ts`). Returning the program alone would leave the one report nobody
 * wired as the one report that does not look like the others.
 */
export interface BuiltProgram {
  /** The program, ready to parse. */
  readonly program: Command;
  /** How a line becomes bytes for this invocation — resolved once, on first use. */
  readonly render: Render;
  /** Where this program writes, so whoever parses it reports through the same port. */
  readonly io: CliIo;
  /**
   * What each verb of this program declared it can do to the record.
   *
   * It travels because a caller can DECIDE with it: the read-only session
   * (`wiring/repl.ts`) offers a line only when the verb it names declared `reads`, and
   * it has to read that off the SAME registration the parser is about to route with.
   * A second `registerVerbs` into a program of its own would answer about a program
   * nobody runs — which is precisely how the first half of
   * `every-verb-says-if-it-writes.test.ts` was once a tautology, and what a command
   * hung on the entry's program by any other path would slip through.
   */
  readonly verbs: readonly Declared[];
}

/**
 * Builds the configured `mnema` program. `io` defaults to the real streams.
 *
 * `typed` is what the caller wrote, and it is a fact about THIS invocation like the
 * three the renderer is resolved from — which is why it enters at the entry rather
 * than being read back out of the parser. Two of the parser's refusals are about a
 * token rather than about a declaration (a flag nothing declares, a flag with nothing
 * after it), and naming the token is the difference between telling a caller what is
 * wrong and telling them that something is. Defaulted, because a caller that only
 * wants the declarations — the guards that walk the command tree — parses nothing.
 *
 * `render` is given by a caller that has ALREADY resolved the capability and must not
 * resolve it again. There is one such caller and there was never going to be a second:
 * an interactive session builds a program per line, and a session whose first answer
 * was painted and whose tenth was not would be one line's worth of doubt about every
 * line in the scrollback — the same argument that makes {@link rendererFor} answer at
 * most once inside one command, one level up. Omitted, this invocation resolves its
 * own, which is what every other caller does.
 */
export function buildProgram(
  io: CliIo = processIo,
  typed: readonly string[] = [],
  render?: Render,
): BuiltProgram {
  const program = new Command();
  program
    .name('mnema')
    .description('A tamper-evident, local-first audit chain for AI-agent work.')
    .version(VERSION)
    // Declared on the program and not on a verb: one question about one invocation,
    // asked before the verb (`mnema --color=never verify`). commander refuses a value
    // that is not one of the three, which makes a typo a usage error this file already
    // turns into an honest exit rather than a silent fall back to the default.
    .addOption(new Option('--color <when>', COLOR_HELP).choices([...COLOR_WHENS]).default('auto'))
    // Throw instead of calling process.exit, so the whole program can be driven
    // in a test — {@link run} turns the thrown CommanderError into an exit code.
    .exitOverride()
    // Route commander's own output (help, usage errors) through the injected io.
    .configureOutput({
      writeOut: (str) => io.out(str.replace(/\n$/, '')),
      writeErr: (str) => io.err(str.replace(/\n$/, '')),
    });

  // Which renderer, from the facts about this invocation — read late, because
  // `--color` does not exist until commander has parsed, and at most once, because a
  // report styled in halves would be a report a reader has to doubt (see
  // {@link rendererFor}). `isTty` is asked of stdout alone: it is where a report
  // goes, and a verb whose stderr was a terminal while its stdout was a pipe would
  // otherwise style the file it was redirected into.
  //
  // HOW WIDE IT IS is asked in the same breath and of the same stream, because it is the
  // same kind of fact and the answer is spent on the same decision: a terminal that says
  // how wide it is gets its lines folded to it, and everything else gets the bytes it
  // always got (`wiring/color.ts`). A stream that reported no width answers zero, which
  // is what the rule reads as "no screen to fold to" — a width nobody reported is not a
  // width to guess at.
  //
  // ONE READING OF THE CAPABILITY AND TWO DOORS ONTO IT. The rule is asked for a WIDTH
  // ({@link rendererAtEachWidth}) and the renderer every verb is handed is that rule asked
  // for this terminal's own — so the flag, the two variables and whether the destination is
  // a terminal are read exactly once, and the width is the one input a caller can change
  // while the process runs. A second factory beside this one would be a second reading of
  // the same stream at another instant, which is two terminals.
  const renderingAt: RenderingAt =
    render === undefined
      ? rendererAtEachWidth(() => ({
          when: program.opts<{ color: ColorWhen }>().color,
          env: process.env,
          isTty: process.stdout.isTTY === true,
          columns: process.stdout.columns ?? 0,
        }))
      : // A CALLER THAT HANDED US ONE HAS ALREADY ANSWERED IT, at every width there is:
        // the session builds a program per typed line and passes the renderer the page is
        // being drawn with, and a `--color` typed inside it changes nothing.
        () => render;
  const resolved = render ?? rendererFor(renderingAt);

  // The open session's run, resolved lazily and at most once (see
  // {@link pinnedRunResolver}). A verb asks it when it STAMPS a run, and forwards what
  // it returns; the reads never do, and neither do `init`, `verify`, `key` and `run`
  // itself — none of those stamps a run, so none has a reason to prove one.
  //
  // THAT IS NOT WHICH VERBS WRITE, and this comment used to read as though it were: it
  // listed the four alongside "the reads", and three of them (`init`, `key`, `run`) write
  // — they found an identity, move a key roster, open and seal a session. Anything that
  // needs to know what a verb may do to the record asks the verb, which declares it
  // (`wiring/verb.ts`); asking this resolver would have answered a different question
  // and looked right.
  //
  // It is built after the renderer because its own refusal is rendered like every
  // other; both are lazy, so the order costs nothing at run time.
  const pinnedRun = pinnedRunResolver({ io, render: resolved });

  const verbs = registerVerbs(program, { io, render: resolved, renderingAt, pinnedRun });

  // AFTER the verbs, and over all of them at once: the parser's own refusals, said
  // the way this surface says every other one (see `wiring/usage.ts`). It walks what
  // was just registered, so a verb added to the list above arrives covered.
  speakUsageErrors(program, { io, render: resolved }, typed);

  return { program, render: resolved, io, verbs };
}

/**
 * Runs the CLI: builds the program for this invocation and parses the line with it.
 *
 * A thrown error becomes an honest failure — a message and a non-zero exit — never an
 * uncaught stack trace that could read as "nothing to report". That half is
 * {@link parseWith}, which is where the catch lives so the one caller that inspects a
 * program before parsing it reports exactly the same way.
 *
 * Its example used to be `verify` over a chain too corrupt to parse, and that one
 * no longer arrives here: an unreadable line is part of the VERDICT now (a `T1`
 * issue naming the tail and the position — see the chain's verify.ts), because a
 * parser's message reaching this catch-all was a correct exit code carrying no
 * finding. Every other verb still reaches it: a read that replays the trees and a
 * write that resumes a tail both parse stored lines, and a corrupt one there is a
 * throw with nowhere honest to put a verdict.
 */
export async function run(
  argv: readonly string[],
  io: CliIo = processIo,
  render?: Render,
): Promise<void> {
  await parseWith(buildProgram(io, argv, render), argv);
}

/**
 * Parses one command line with a program that is already built, turning a throw into
 * an honest failure.
 *
 * It is separate from {@link run} for the one caller that has to look at the program
 * BEFORE it parses: the read-only session reads each verb's declaration off
 * {@link BuiltProgram.verbs} and only then hands the line over. Building a second
 * program to run it would mean deciding about one program and parsing with another,
 * and writing the catch below a second time would put the surface's last-resort report
 * in two places — which is the shape three deliveries of this series spent themselves
 * removing.
 */
export async function parseWith(built: BuiltProgram, argv: readonly string[]): Promise<void> {
  const { program, render, io } = built;
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (error) {
    // commander throws for --help/--version (a clean, zero exit — it already
    // printed) and for a usage error (a non-zero exit already reported in the
    // product's own voice, by the walk `buildProgram` installed).
    // Honor its exit code; do not re-print.
    if (error instanceof CommanderError) {
      if (error.exitCode !== 0) io.fail();
      return;
    }
    // The record does not name ONE identity for this machine's key, so the write
    // refused rather than guessing whose record this is. It is thrown, not
    // returned, because the decision sits below every write — every verb would
    // otherwise carry the same branch — so it is reported HERE, in the one place
    // that already turns a throw into an honest failure, and it reads exactly like
    // any other refusal.
    if (error instanceof IdentityUnavailableError) {
      io.err(render(refusalLine(error.code, error.message)));
      io.fail();
      return;
    }
    // Any other throw — e.g. a read whose replay meets a stored line no parser
    // can open — is an honest failure, not an uncaught stack trace that could
    // read as "nothing wrong". (`verify` no longer arrives here for that: it
    // answers with a verdict naming the tail and the line.) It is rendered like
    // every other no on this surface: the command did not do what was asked, and a
    // reader has no use for the distinction between the ways it did not.
    io.err(render(refusalSentence(error instanceof Error ? error.message : String(error))));
    io.fail();
  }
}

/**
 * The facts about THIS INVOCATION that decide whether the bare name asks or prints.
 *
 * They are here for the reason the style capability is: the entry is where the process is,
 * and a module that reached for `process` to answer them would be a module no case could
 * drive twice. It is the same value the session's own verb assembles one layer down
 * (`wiring/repl.ts`), for the same reason and out of the same three streams.
 */
export interface Entry {
  /** Where this invocation writes. */
  readonly io: CliIo;
  /** Where the keystrokes would come from. */
  readonly input: NodeJS.ReadStream;
  /** The page a question would be drawn on. */
  readonly output: NodeJS.WriteStream;
  /**
   * Whether BOTH ends are a terminal.
   *
   * The `&&` is the decision and it is the console's own: the arrows come from stdin and
   * the page goes to stdout, so an invocation with either one redirected is one whose
   * caller cannot see what they are answering — and, far more importantly, it is a PIPE,
   * where the answer has to go on being the bytes it has always been.
   */
  readonly interactive: boolean;
}

/**
 * THE BINARY'S OWN DOOR: the bare name asks what you want, and everything else runs.
 *
 * `mnema` with nothing after it printed the catalogue — twenty-nine verbs and the options
 * above them — which is the right answer for somebody who knows what they are looking for
 * and the wrong one for somebody who has just typed the name of a program. So at a terminal
 * it ASKS, with two doors that depend on what is in this directory (`choice/doors.ts`), and
 * what the caller picks is a LINE this same function then runs.
 *
 * WITHOUT A TERMINAL NOTHING MOVED, and that is the half with everything resting on it. A
 * pipe, a script, a CI job, `mnema | less` — every one of them gets the help on stderr and
 * the exit code of one, byte for byte as it always has, because {@link run} is reached
 * unchanged with the same empty argv. It is the same rule the session already followed and
 * it protects more than the session did: every script that has ever called this binary with
 * no arguments is on the other side of it. `cli.help.golden.txt` is where those bytes are
 * pinned, and `tests/the-bare-name-asks.test.ts` is what says this function delegates to the
 * very call the golden drives.
 *
 * ONLY THE BARE NAME, and the narrowness is deliberate. `mnema --color=never` is a caller
 * who typed something, and what they typed is about OUTPUT — so there is output, and it is
 * the catalogue. The question is for the invocation that asked nothing at all.
 *
 * A CALLER WHO LEAVES WITHOUT CHOOSING RUNS NOTHING AND EXITS ZERO. Asking is not an error,
 * and the record is untouched: nothing on this path opens a chain or a writer.
 */
export async function start(argv: readonly string[], entry: Entry): Promise<void> {
  if (argv.length > 0 || !entry.interactive) return await run(argv, entry.io);
  // Reached by a dynamic import, and the whole of `choice/` behind it — the layout library
  // is the most expensive import on this surface, and `mnema --version` must not know it
  // exists (`tests/the-floor-is-the-declaration.test.ts`).
  const [{ theChoice }, { leavingProcess }] = await Promise.all([
    import('./choice/asked.js'),
    import('./repl/leaving.js'),
  ]);
  const chosen = await theChoice({
    io: entry.io,
    input: entry.input,
    output: entry.output,
    leaving: leavingProcess,
  });
  if (chosen === undefined) return;
  // THE SAME ENTRY, so the chosen line is read exactly as a typed one: one place parses, one
  // place reports, and what a caller can reach through a menu is what they could have typed.
  await run(chosen, entry.io);
}

// Auto-run when invoked as the binary (not when imported by a test).
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  exitQuietlyOnClosedPipe();
  void start(process.argv.slice(2), {
    io: processIo,
    input: process.stdin,
    output: process.stdout,
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
  });
}
