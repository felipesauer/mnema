/**
 * The `mnema beside-a-write` wiring: what it declares, and what it prints.
 *
 * `mnema beside-a-write --host <host>` reads the payload a host hands a hook AFTER a tool ran, on
 * stdin, and prints the reply that host reads: the rules of the record addressed at the paths the
 * write touched, as context beside the write's result, or `{}`. It is for the hosts whose hook
 * before a write cannot carry text (Copilot CLI, Gemini CLI); the command is
 * `commands/beside-a-write.ts`.
 *
 * A HOST RUNS IT, NOT A PERSON: it exits 0 on every outcome that is not a misuse of the verb
 * itself or a fault of the product, and what it has to say about a write it could not read goes to
 * the second stream. `--host` is required rather than guessed, so a payload is never read in the
 * wrong host's shape.
 */

import type { Command } from 'commander';
import { BESIDE_HOSTS } from '../host-names.js';
import { here } from './context.js';
import { enumeratedOption, listed } from './enumerated.js';
import { reportUsage } from './report.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

/** Registers `mnema beside-a-write` on the program. */
export function registerBesideAWrite(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const verb = program
    .command('beside-a-write')
    .description(
      'answer a host’s hook after a file was written: hand over the rules addressed at it',
    )
    .addOption(
      enumeratedOption(
        '--host <host>',
        `the host whose hook runs this, and whose payload arrives on stdin: ${listed(BESIDE_HOSTS)}`,
        BESIDE_HOSTS,
      ).makeOptionMandatory(),
    )
    .option(
      '--agent-key <name>',
      "sign the one fact this records with the key of that agent in the tree whose record enrols it (made with `mnema key request --agent <name> --anchor <id>`), and name the agent the record gives that key; in a tree that does not, the person's key signs, or, where that key is protected, the fact is not recorded (the reply to the host is unchanged). Also read from MNEMA_AGENT_KEY",
    )
    .addHelpText(
      'after',
      [
        '',
        'What it reads and what it prints:',
        '  The JSON a host hands a hook after a tool ran, on stdin. On stdout, the reply the host',
        '  reads: {} unless a rule of this project addresses a path the write touched, and then the',
        '  rules, as `additionalContext` (at the top of the reply for copilot, under',
        '  hookSpecificOutput for gemini), under the host’s ceiling. It never refuses or asks, and',
        '  records no refusal or asking: that is the work of `before-a-write`, which runs before the',
        '  write. It needs the `session_id` of the payload: the first reply of a session records one',
        '  `channel.served` and the others none, and a payload without one is handed no rules.',
        '  `mnema switch off edit-rules-push` stops it.',
      ].join('\n'),
    )
    .action(async (opts: { host: string; agentKey?: string }) => {
      const { runBesideAWrite } = await import('../commands/beside-a-write.js');
      const { fact } = await import('../presentation/detail.js');
      const host = BESIDE_HOSTS.find((one) => one === opts.host);
      if (host === undefined) {
        reportUsage(wiring, `--host takes one of ${listed(BESIDE_HOSTS)}, not "${opts.host}".`);
        return;
      }
      const payload = io.input === undefined ? '' : await io.input();
      const done = runBesideAWrite(
        { ...here(), ...(opts.agentKey !== undefined ? { agentKey: opts.agentKey } : {}) },
        { host, payload },
      );
      for (const note of done.notes) io.err(render(fact(note, 0)));
      io.out(JSON.stringify(done.reply));
    });
  return mutatesTheRecord(verb);
}
