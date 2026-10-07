/**
 * The `mnema check` wiring: what it declares, and what it prints.
 *
 * `check` is a group of two, one per side of the role:
 *
 *   - `mnema check declare <rule> <program> [args...]` — a person says what program checks a
 *     rule. The program and its arguments are positionals after the rule; an argument that
 *     starts with a dash goes after `--`, so it is the program's and not this verb's.
 *   - `mnema check run` — the machine whose key is enrolled as a checker runs the check of
 *     every rule in force and records each result. It exits non-zero when any check failed,
 *     which is what makes it a gate in CI.
 */

import type { Command } from 'commander';
import { fact } from '../presentation/detail.js';
import { RECORD_CONTRACT_HELP } from '../recorded-content.js';
import { here } from './context.js';
import { onOneLine } from './on-one-line.js';
import { declaredAgent } from './options.js';
import { idOrRefuse, reportRecorded, reportRefusal } from './report.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

/** How long one check may run before it is stopped and recorded as failed, by default. */
const DEFAULT_TIMEOUT_SECONDS = 300;

/** Reads `--timeout` as a whole number of seconds of at least one. */
function seconds(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`--timeout takes a whole number of seconds, at least 1 (got "${value}")`);
  }
  return parsed;
}

/** Registers `mnema check` on the program. */
export function registerCheck(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const check = program
    .command('check')
    .description('give a rule a program that checks it, and record whether it held at a commit');

  check
    .command('declare')
    .description('declare the program that checks a rule (no shell: the program and its arguments)')
    .argument('<rule>', 'the id of the decision the check is for')
    .argument('<program>', 'the program to run, from the project root')
    .argument(
      '[args...]',
      'its arguments, one by one — put `--` before any that starts with a dash',
    )
    .option(
      '--which <agent>',
      'the agent that executed this, when an agent is driving mnema',
      declaredAgent,
    )
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action(async (rule: string, command: string, args: string[], opts: { which?: string }) => {
      const { runCheckDeclare } = await import('../commands/check.js');
      const named = await idOrRefuse(wiring, rule);
      if (named === undefined) return;
      const result = runCheckDeclare(here(), {
        rule: named,
        command,
        args,
        ...(opts.which !== undefined ? { which: opts.which } : {}),
      });
      if (result.ok) {
        io.out(`Declared the check of ${result.rule}`);
        reportRecorded(result, io);
        return;
      }
      reportRefusal(wiring, result);
    });

  check
    .command('run')
    .description(
      'run the check of every rule in force and record each result (run by a checker key, in CI)',
    )
    .option('--key <file>', "a checker's private key to sign with, instead of this machine's own")
    .option(
      '--timeout <seconds>',
      `how long one check may run before it is stopped and recorded as failed (default ${DEFAULT_TIMEOUT_SECONDS})`,
      seconds,
    )
    .action(async (opts: { key?: string; timeout?: number }) => {
      const { runCheckRun } = await import('../commands/check.js');
      const result = runCheckRun(here(), {
        timeoutMs: (opts.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
        ...(opts.key !== undefined ? { keyFile: opts.key } : {}),
      });
      if (!result.ok) {
        reportRefusal(wiring, result);
        return;
      }
      if (result.results.length === 0) {
        io.out('No rule in force carries a check — nothing ran, nothing recorded.');
        return;
      }
      const failed = result.results.filter((r) => !r.passed);
      io.out(
        `${result.results.length - failed.length} passed · ${failed.length} failed at ${result.commit}`,
      );
      for (const one of result.results) {
        io.out(
          render(
            fact(
              one.passed
                ? `passed ${one.rule}`
                : // The runner's own words, or the program's name in a start error: not ours to trust.
                  onOneLine`failed ${one.rule}: ${one.failure}`,
            ),
          ),
        );
      }
      io.out(render(fact(`signed by ${result.checker}`)));
      io.out(render(fact(onOneLine`recorded in ${result.root}`)));
      if (failed.length > 0) io.fail();
    });

  return mutatesTheRecord(check);
}
