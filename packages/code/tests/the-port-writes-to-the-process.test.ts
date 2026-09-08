/**
 * THE PORT THAT TALKS TO THE PROCESS IS ASKED TO TALK TO IT — once, here, and nowhere
 * else.
 *
 * Every other test of this package injects a `CliIo` of its own, which is exactly what
 * makes the whole surface drivable without spawning anything. The cost was that
 * `processIo` — the three lines that ARE the product at a terminal — ran in no test at
 * all: a report on stdout, a refusal on stderr, and a non-zero exit code. The ledger of
 * files no test names said so in prose ("every test injects its own port so processIo
 * never runs"), and the coverage report said 40% of a five-line file. This case is what
 * falsified that sentence, so the row it was written in is gone.
 *
 * WHY IT IS THREE ASSERTIONS AND NOT ONE. The port has three members and each of them is
 * a different claim: WHICH stream a line goes to (a refusal on stdout would be piped into
 * whatever the caller redirected), WHETHER the newline is the port's (nothing in
 * `presentation/` puts one on a line), and WHAT failure IS on this surface (an exit code
 * the process carries out, not a thrown error). Two of the three would still pass if the
 * streams were swapped, so the streams are checked against each other rather than one at
 * a time.
 *
 * HOW IT DOES NOT POISON THE RUN, which is the reason this was worth being careful about
 * rather than just worth doing. It writes to the real `process.stdout` and it sets the
 * real `process.exitCode`, so a case that got either half wrong would leave the suite
 * printing into its own report, or exiting non-zero with every case green. Both are
 * borrowed inside a `try` and given back in a `finally` — which runs even when an
 * assertion throws — and nothing is asserted until after they are back.
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, processIo, writeLines } from '../src/wiring/io.js';

/** What one stream received while the port was writing to it. */
type Written = string[];

/**
 * Runs `use` with both real streams borrowed, and gives them back whatever happens.
 *
 * The two are replaced together, so a line that went to the WRONG one is visible as an
 * empty list beside a list of two: checking one stream at a time cannot tell "it wrote
 * nothing" from "it wrote to the other one".
 */
function withBothStreamsBorrowed(use: () => void): { out: Written; err: Written } {
  const out: Written = [];
  const err: Written = [];
  const real = { out: process.stdout.write, err: process.stderr.write };
  try {
    process.stdout.write = ((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown) => {
      err.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    use();
  } finally {
    process.stdout.write = real.out;
    process.stderr.write = real.err;
  }
  return { out, err };
}

describe('the port writes to the process', () => {
  it('puts a report on stdout and a refusal on stderr, each ending in a newline', () => {
    const written = withBothStreamsBorrowed(() => {
      processIo.out('Captured memory 0198f0a4-0000-7000-8000-000000000000');
      processIo.err('Refused (UNKNOWN_RUN): MNEMA_RUN names a run this project has no record of');
    });

    // The bytes, whole: the line the caller passed and the newline the PORT adds — no
    // presentation function returns one, so a line printed without this would run into
    // the next.
    expect(written.out).toEqual(['Captured memory 0198f0a4-0000-7000-8000-000000000000\n']);
    expect(written.err).toEqual([
      'Refused (UNKNOWN_RUN): MNEMA_RUN names a run this project has no record of\n',
    ]);
  });

  it('records a non-zero exit rather than throwing, and nothing is printed by failing', () => {
    const inherited = process.exitCode;
    let observed: typeof process.exitCode;
    const written = withBothStreamsBorrowed(() => {
      // Borrowed and given back like the streams. A case that set this and walked away
      // would end the whole run non-zero with every assertion green — the shape that
      // makes a suite lie in the direction nobody checks.
      process.exitCode = undefined;
      processIo.fail();
      observed = process.exitCode;
    });
    process.exitCode = inherited;

    // TWO VALUES, not one: `fail()` is a change, and a guard that only read the value
    // after would pass on a process that was already exiting non-zero.
    expect(observed).toBe(1);
    expect(observed).not.toBe(undefined);
    // And failing is not a message. The refusal was already reported by whoever refused;
    // a second sentence here would be the surface saying no twice.
    expect(written).toEqual({ out: [], err: [] });
  });

  it('relays every line a printer built, in order, through whichever port it was handed', () => {
    // The other half of this file, and the one that already ran: `writeLines` is what
    // makes "one line per item" a property of the array a printer returns rather than of
    // how many times a verb remembered to call `out`. It is asked here through a port of
    // the test's own, which is how every other file reaches it.
    const said: string[] = [];
    const port: CliIo = {
      out: (line) => said.push(line),
      err: () => undefined,
      fail: () => undefined,
    };
    writeLines(port, ['first', 'second', 'third']);
    expect(said).toEqual(['first', 'second', 'third']);

    // An empty report writes nothing — the read that found no rows says so with its own
    // sentence, and this must not add a blank line under it.
    writeLines(port, []);
    expect(said).toEqual(['first', 'second', 'third']);
  });
});
