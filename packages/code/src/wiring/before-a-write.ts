/**
 * The `mnema before-a-write` wiring: what it declares, and what it prints.
 *
 * `mnema before-a-write --host <host>` reads the payload a host hands a hook before a tool runs,
 * on stdin, and prints the reply that host reads, on stdout — `deny`, citing the rules, when a rule
 * of the record refuses a write at a path it touches; `ask` when one asks for a person and the
 * host holds a write for one (Cursor's agent does not); and `{}` otherwise. It is the
 * per-edit gate for a host whose hooks are processes; the command is `commands/before-a-write.ts`.
 *
 * A HOST RUNS IT, NOT A PERSON, and two things follow. It exits 0 on every outcome that is not a
 * misuse of the verb itself, so the host never reads a failure as a reason to block anybody's
 * work; and what it has to say about a write it could not read goes to the second stream, which
 * the host logs and nobody decides by. `--host` is required rather than guessed: the plugin's hook
 * says which host it is written for, so a payload is never read in the wrong host's shape.
 */

import type { Command } from 'commander';
import { HOOK_HOSTS } from '../host-names.js';
import { here } from './context.js';
import { enumeratedOption, listed } from './enumerated.js';
import { reportUsage } from './report.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

/** Registers `mnema before-a-write` on the program. */
export function registerBeforeAWrite(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const verb = program
    .command('before-a-write')
    .description('answer a host’s hook before a file is written: refuse or ask where a rule says')
    .addOption(
      enumeratedOption(
        '--host <host>',
        `the host whose hook runs this, and whose payload arrives on stdin: ${listed(HOOK_HOSTS)}`,
        HOOK_HOSTS,
      ).makeOptionMandatory(),
    )
    .addHelpText(
      'after',
      [
        '',
        'What it reads and what it prints:',
        '  The JSON a host hands a hook before a tool runs, on stdin. On stdout, the reply the',
        '  host reads: {} unless a rule of this project addresses a path the write touches —',
        '  `deny` where it is linked with `refuses-a-write`, which wins, and `ask` where it is',
        '  linked with `asks-for-a-person` — citing the rules. For --host cursor and --host',
        '  codex only `deny` is answered: those hosts do not hold a write for a person. Each',
        '  refusal or asking is recorded as a fact before the reply is printed. They can be',
        '  switched off with `mnema switch off edit-refuses-a-write` and',
        '  `mnema switch off edit-asks-a-person`.',
      ].join('\n'),
    )
    .action(async (opts: { host: string }) => {
      const { runBeforeAWrite } = await import('../commands/before-a-write.js');
      const { fact } = await import('../presentation/detail.js');
      const host = HOOK_HOSTS.find((one) => one === opts.host);
      if (host === undefined) {
        reportUsage(wiring, `--host takes one of ${listed(HOOK_HOSTS)}, not "${opts.host}".`);
        return;
      }
      const payload = io.input === undefined ? '' : await io.input();
      const done = runBeforeAWrite(here(), { host, payload });
      for (const note of done.notes) io.err(render(fact(note, 0)));
      io.out(JSON.stringify(done.reply));
    });
  return mutatesTheRecord(verb);
}
