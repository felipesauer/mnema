/**
 * The `mnema repl` wiring: what it declares, and what it opens.
 *
 * It is a VERB, and the argument for that is the whole reason it is not the bare
 * invocation. `mnema` typed with no verb prints the help and exits — every shell
 * pipeline, every script and every agent that has ever run this binary depends on that,
 * and an agent that ran it in a pty and landed at a prompt would wait for input nobody
 * is going to type. Asking for the session by name costs a word and takes nothing away.
 *
 * THE PREMISE THAT FELL IS *`mnema` PRINTS THE HELP*, AND ONLY HALF OF IT DID. The bare
 * name asks now — two doors, one of which opens this session — but only at a TERMINAL, and
 * the sentence above is exactly what the other side of that question is (`cli.ts`, `start`):
 * a pipe, a script and a CI job get the same bytes on the same stream with the same exit
 * code, and that is what the pipeline and the script depended on. What the agent in a pty
 * depended on is untouched for a different reason: it lands on a QUESTION rather than on a
 * prompt, and every way of answering it — including pressing nothing and being killed —
 * leaves the record as it found it.
 *
 * AND THE VERB IS NOT REPLACED BY THE DOOR, which is the decision the door was taken under.
 * A caller who types `mnema repl` gets the session directly, with no menu in front of it: a
 * shortcut that made everybody pass through it would have taken the word away rather than
 * added to it, and a finger that already knows the word is the finger this surface is for.
 *
 * IT IS DECLARED A READ, and it is one: it can only run what it can only run. The
 * session offers a verb when that verb declared `reads` and refuses everything else
 * (`repl/gate.ts`), so the power of this verb is the union of the powers it will
 * dispatch to, which is the same argument that makes `mcp` a WRITE — that one serves
 * every write tool there is.
 *
 * THE FACTS ABOUT THE PROCESS ARE READ HERE, where the process is. Whether each end is a
 * terminal is exactly the kind of question `wiring/color.ts` says may not be asked
 * further down: a session that looked at `process.stdin` from inside its own loop could
 * not be driven by a test, and the refusal that matters most here — no terminal, no
 * session — would be the one thing nothing could exercise. The FOURTH fact is the same
 * kind and it is the newest: the ways this process can stop, which the console hooks so
 * that the terminal is given back on every one of them. A module that reached for the
 * global `process` to hook them would be a module no test could arm twice.
 *
 * AND THE WORDS THE SESSION ANSWERS TO ARE READ RATHER THAN TYPED. This help used to
 * spell them out, which is the one way a declaration can be wrong about the thing it
 * declares: the gate holds the list, this printed a copy of it, and nothing compared the
 * two. They now come from the module both sides read (`session-words.ts`), which is above
 * the session precisely because this file may not reach it — the whole reason the session
 * is a lazy import is that a `mnema --version` must not pay for it.
 */

import type { Command } from 'commander';
import { padTo, widestOf } from '../presentation/width.js';
import { THE_KEY_THAT_LEAVES, WHAT_EACH_WORD_DOES } from '../session-words.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** How deep the words sit in the help, and how far the gloss is from the widest of them. */
const INDENT = 2;
const AFTER_THE_WORD = 3;

/**
 * The words the session answers to, one to a line, as the help lists them.
 *
 * The column is as wide as the WIDEST word rather than a number, so a word longer than
 * the ones here today lines the block up instead of breaking it.
 */
function theWordsItAnswersTo(): string[] {
  const words = Object.entries(WHAT_EACH_WORD_DOES);
  const widest = widestOf(words.map(([word]) => word));
  return words.map(
    ([word, does]) => ' '.repeat(INDENT) + padTo(word, widest + AFTER_THE_WORD) + does,
  );
}

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
  const { io, renderingAt } = wiring;
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
        ...theWordsItAnswersTo(),
        '',
        // HOW IT ENDS, WHICH THIS HELP USED TO SAY BY LISTING A WORD. The way out was
        // `/exit`, so the block above carried it; the way out is a keystroke now, and a
        // declaration that named no way to leave an interactive session would be the one
        // omission a reader cannot recover by typing something and reading the answer.
        `${THE_KEY_THAT_LEAVES} ends the session; Ctrl-C clears the line you are typing.`,
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
        // THE RULE RATHER THAN AN ANSWER TO IT, and this verb is the only one handed it.
        // A session outlives the window it opened in, so how wide the screen is is not a
        // fact this invocation can resolve once the way the flag and the environment are
        // (`wiring/color.ts`); the page asks for the width of the frame it is drawing.
        renderingAt,
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
