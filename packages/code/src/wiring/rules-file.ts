/**
 * The `mnema rules-file` wiring: what it declares, and what it prints.
 *
 * `mnema rules-file --host <host>` prints, on stdout, the file another host reads its own rules
 * from — VS Code's `.instructions.md` with `applyTo`, Cursor's `.mdc` with `globs` — carrying the
 * committed rules addressed at a file a glob can name; on stderr, in the same run, how many it
 * carried, what each host does with the pattern, where the file goes and that `>` replaces the
 * whole of it, and every rule left out with the reason. With nothing that translated it prints no
 * file — an empty pattern is read as every file by some matchers — and says so, exiting 0 the way
 * `mnema recall` does over nothing noted: having nothing to print is an answer, not a failure.
 */

import type { Command } from 'commander';
import { RULES_FILE_HOSTS } from '../host-names.js';
import { here } from './context.js';
import { enumeratedOption, listed } from './enumerated.js';
import { reportRefusal, reportUsage } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema rules-file` on the program. */
export function registerRulesFile(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const verb = program
    .command('rules-file')
    .description(
      'print the rules addressed at a file as another host’s rules file, and why the rest are not',
    )
    .addOption(
      enumeratedOption(
        '--host <host>',
        `the host whose rules-file format to print: ${listed(RULES_FILE_HOSTS)}`,
        RULES_FILE_HOSTS,
      ).makeOptionMandatory(),
    )
    .action(async (opts: { host: string }) => {
      const { runRulesFile } = await import('../commands/rules-file.js');
      const { linkBreakNotice } = await import('./integrity.js');
      const { WHERE_A_HOST_READS, WHO_MATCHES } = await import('../host-rules-file.js');
      const { fact } = await import('../presentation/detail.js');
      const host = RULES_FILE_HOSTS.find((one) => one === opts.host);
      if (host === undefined) {
        reportUsage(wiring, `--host takes one of ${listed(RULES_FILE_HOSTS)}, not "${opts.host}".`);
        return;
      }
      const done = runRulesFile(here(), { host });
      if (!done.ok) {
        reportRefusal(wiring, done, {});
        return;
      }
      // BEFORE the file, and on the other stream — so it survives a redirect.
      for (const line of linkBreakNotice(done.linkBreaks)) io.err(render(line));
      const say = (line: string, depth = 0) => io.err(render(fact(line, depth)));
      if (done.text === undefined) {
        say(
          'No rule of this project is addressed at a file a glob can name, so no file was printed — a `>` would have left its file empty.',
        );
      } else {
        io.out(done.text.replace(/\n$/, ''));
        say(`Printed ${done.carried} rule(s) for ${host}. ${WHO_MATCHES[host]}`);
        say(
          `It goes in ${WHERE_A_HOST_READS[host]}: mnema rules-file --host ${host} > ${WHERE_A_HOST_READS[host]} — the \`>\` replaces the whole of the file it names.`,
        );
      }
      say('A rule that asks for a person is never in it: a file a host reads cannot hold a write.');
      if (done.leftOut.length > 0) {
        say(`Left out (${done.leftOut.length}):`);
        for (const one of done.leftOut) {
          say(`“${one.name}” — ${one.address} · ${one.id}: ${one.why}.`, 1);
        }
      }
    });
  return readsTheRecord(verb);
}
