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
import { COLOR_HELP, COLOR_WHENS, type ColorWhen, rendererFor } from './wiring/color.js';
import { registerVerbs } from './wiring/index.js';
import { type CliIo, processIo } from './wiring/io.js';
import { refusalLine } from './wiring/report.js';
import { pinnedRunResolver } from './wiring/run-pin.js';

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

/** Builds the configured `mnema` program. `io` defaults to the real streams. */
export function buildProgram(io: CliIo = processIo): Command {
  const program = new Command();
  program
    .name('mnema')
    .description('A tamper-evident, local-first audit chain for AI-agent work.')
    .version('0.0.0')
    // Declared on the program and not on a verb: one question about one invocation,
    // asked before the verb (`mnema --color=never verify`). commander refuses a value
    // that is not one of the three, which makes a typo a usage error this file already
    // turns into an honest exit rather than a silent fall back to the default.
    .addOption(
      new Option('--color <when>', COLOR_HELP).choices([...COLOR_WHENS]).default('auto'),
    )
    // Throw instead of calling process.exit, so the whole program can be driven
    // in a test — {@link run} turns the thrown CommanderError into an exit code.
    .exitOverride()
    // Route commander's own output (help, usage errors) through the injected io.
    .configureOutput({
      writeOut: (str) => io.out(str.replace(/\n$/, '')),
      writeErr: (str) => io.err(str.replace(/\n$/, '')),
    });

  // The open session's run, resolved lazily and at most once (see
  // {@link pinnedRunResolver}). Every WRITING verb asks it and forwards what it
  // returns; the reads, `init`, `verify`, `key` and `run` itself never do —
  // none of them stamps a `run`, so none of them has a reason to prove one.
  const pinnedRun = pinnedRunResolver(io);

  // Which renderer, from the three facts about this invocation — read late, because
  // `--color` does not exist until commander has parsed, and at most once, because a
  // report styled in halves would be a report a reader has to doubt (see
  // {@link rendererFor}). `isTty` is asked of stdout alone: it is where a report
  // goes, and a verb whose stderr was a terminal while its stdout was a pipe would
  // otherwise style the file it was redirected into.
  const render = rendererFor(() => ({
    when: program.opts<{ color: ColorWhen }>().color,
    env: process.env,
    isTty: process.stdout.isTTY === true,
  }));

  registerVerbs(program, { io, render, pinnedRun });

  return program;
}

/**
 * Runs the CLI. A thrown error becomes an honest failure — a message and a
 * non-zero exit — never an uncaught stack trace that could read as "nothing to
 * report".
 *
 * Its example used to be `verify` over a chain too corrupt to parse, and that one
 * no longer arrives here: an unreadable line is part of the VERDICT now (a `T1`
 * issue naming the tail and the position — see the chain's verify.ts), because a
 * parser's message reaching this catch-all was a correct exit code carrying no
 * finding. Every other verb still reaches it: a read that replays the trees and a
 * write that resumes a tail both parse stored lines, and a corrupt one there is a
 * throw with nowhere honest to put a verdict.
 */
export async function run(argv: readonly string[], io: CliIo = processIo): Promise<void> {
  try {
    await buildProgram(io).parseAsync(argv, { from: 'user' });
  } catch (error) {
    // commander throws for --help/--version (a clean, zero exit — it already
    // printed) and for a usage error (a non-zero exit it already reported).
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
      io.err(refusalLine(error.code, error.message));
      io.fail();
      return;
    }
    // Any other throw — e.g. a read whose replay meets a stored line no parser
    // can open — is an honest failure, not an uncaught stack trace that could
    // read as "nothing wrong". (`verify` no longer arrives here for that: it
    // answers with a verdict naming the tail and the line.)
    io.err(error instanceof Error ? error.message : String(error));
    io.fail();
  }
}

// Auto-run when invoked as the binary (not when imported by a test).
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  exitQuietlyOnClosedPipe();
  void run(process.argv.slice(2));
}
