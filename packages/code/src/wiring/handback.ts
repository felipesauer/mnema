/**
 * The `mnema handback` wiring: what it declares, and what it prints.
 *
 * `mnema handback` reads the payload a host hands a `SubagentStop` hook, on stdin, and prints the
 * reply that host reads: `{"decision":"block","reason":…}` when the subagent's final reply does not
 * end in the block the record asks for, `{}` otherwise. With `--schema` it prints the JSON Schema of
 * that block instead and reads nothing — the format is served by the program that checks it. The
 * command is `commands/handback.ts`; the plugin's handler runs it.
 *
 * A HOST RUNS IT, NOT A PERSON, so it is `tally`'s shape: it exits 0 on every outcome that is not a
 * misuse of the verb itself, and what it could not check goes to the second stream.
 */

import type { Command } from 'commander';
import { here } from './context.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema handback` on the program. */
export function registerHandback(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const verb = program
    .command('handback')
    .description(
      'check what a subagent hands back when it stops, or print the format it is checked by',
    )
    .option('--schema', 'print the JSON Schema of the block a hand-back ends in, and read nothing')
    .addHelpText(
      'after',
      [
        '',
        'What it reads and what it prints:',
        '  The JSON a host hands a SubagentStop hook on stdin. A subagent hands the decisions it',
        '  settled back in its final reply, in one fenced block whose info string is',
        '  `mnema-handback`, holding {"decisions":[{"settled","why","turnedDown"}]}, the list',
        '  empty where it settled nothing. On stdout, the reply the host reads: a block decision',
        '  with the reason, once per stop, when the final reply has no such block or the block is',
        '  not in the format, or {} when it does, when the hook is not SubagentStop, when there is',
        '  no project here, or the reply cannot be read.',
        '  It reads, and writes nothing. It can be switched off with',
        '  `mnema switch off subagent-handback`.',
      ].join('\n'),
    )
    .action(async (options: { readonly schema?: boolean }) => {
      const { HANDBACK_SCHEMA, runHandback } = await import('../commands/handback.js');
      if (options.schema === true) {
        io.out(JSON.stringify(HANDBACK_SCHEMA, null, 2));
        return;
      }
      const { fact } = await import('../presentation/detail.js');
      const payload = io.input === undefined ? '' : await io.input();
      const done = runHandback(here(), { payload });
      for (const note of done.notes) io.err(render(fact(note, 0)));
      io.out(JSON.stringify(done.reply));
    });
  return readsTheRecord(verb);
}
