/**
 * The `mnema repl` wiring: what it declares, and what it opens.
 *
 * It is a VERB, and the argument for that is the whole reason it is not the bare
 * invocation. `mnema` typed with no verb prints the help and exits — every shell
 * pipeline, every script and every agent that has ever run this binary depends on that,
 * and an agent that ran it in a pty and landed at a prompt would wait for input nobody
 * is going to type. Asking for the session by name costs a word and takes nothing away.
 *
 * IT IS DECLARED A READ, and it is one: it can only run what it can only run. The
 * session offers a verb when that verb declared `reads` and refuses everything else
 * (`repl/gate.ts`), so the power of this verb is the union of the powers it will
 * dispatch to, which is the same argument that makes `mcp` a WRITE — that one serves
 * every write tool this product has.
 *
 * THE FACTS ABOUT THE PROCESS ARE READ HERE, where the process is. Whether each end is a
 * terminal is exactly the kind of question `wiring/color.ts` says may not be asked
 * further down: a session that looked at `process.stdin` from inside its own loop could
 * not be driven by a test, and the refusal that matters most here — no terminal, no
 * session — would be the one thing nothing could exercise. The FOURTH fact is the same
 * kind and it is the newest: the ways this process can stop, which the console hooks so
 * that the terminal is given back on every one of them. A module that reached for the
 * global `process` to hook them would be a module no test could arm twice.
 */

import type { Command } from 'commander';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/**
 * The name this verb is registered under, in one place.
 *
 * The session excludes its own verb from what it offers (a session inside a session
 * hands one terminal to two readers of the same keystrokes), and it does that by
 * IDENTITY rather than by a literal — so the exclusion cannot end up pointing at a name
 * that no longer exists.
 */
export const REPL_VERB = 'repl';

/** Registers `mnema repl` on the program. */
export function registerRepl(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const repl = program
    .command(REPL_VERB)
    .description('open an interactive session that reads this project')
    .addHelpText(
      'after',
      [
        '',
        'One process, many reads. A command of this CLI spends about a tenth of a second',
        'starting before it reads anything; a session pays that once, and every read after',
        'the first costs only the work.',
        '',
        'It reads and never writes. A verb that can change the record is refused by name,',
        'with the line to run outside the session — and it is refused because the verb',
        'itself declares what it can do, so one added tomorrow is refused too.',
        '',
        '  .help   what this session runs',
        '  .exit   leave (so does Ctrl-D; Ctrl-C clears the line you are typing)',
        '',
        'It needs a terminal at both ends and refuses without one: reading commands from a',
        'pipe would be a second way to run the same verbs. The history lives in this',
        'process and is written to no file. Style is decided when the session opens — from',
        '`mnema --color`, the environment and the terminal — so a `--color` typed on a line',
        'inside it changes nothing.',
      ].join('\n'),
    )
    .action(async () => {
      const { leavingProcess } = await import('../repl/leaving.js');
      const { openSession } = await import('../repl/session.js');
      await openSession({
        io,
        render,
        self: REPL_VERB,
        input: process.stdin,
        output: process.stdout,
        // BOTH ends, and the `&&` is the decision: stdin is where the line comes from
        // and stdout is where the prompt goes, so a session with either one redirected
        // is a session whose caller cannot see what they are answering.
        interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
        leaving: leavingProcess,
      });
    });
  return readsTheRecord(repl);
}
