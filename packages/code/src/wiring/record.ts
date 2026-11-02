/**
 * The `mnema record` wiring: what it declares, and what it prints.
 *
 * A group of two acts on the record as git holds it. `pull` is `git pull` over tails that grew here
 * and are not committed yet (`commands/record-pull.ts`); `merge-tail` is the merge driver git calls
 * for a tail's files (`commands/record-merge-tail.ts`), by `pull` on its own command line, or by
 * every merge once a person wrote the setting with `mnema doctor --fix merge-driver`.
 *
 * Declared `mutates`: `pull` changes the working tree and `merge-tail` writes the file git hands it,
 * and a read-only session (`repl`) must not be offered either.
 */

import type { Command } from 'commander';
import { fact } from '../presentation/detail.js';
import { here } from './context.js';
import { onOneLine } from './on-one-line.js';
import { reportRefusal } from './report.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';
import { DEFAULT_REQUIREMENT, treeHeadline } from './verify.js';

/** At most this many paths are named in one refusal; the count says the rest. */
const NAMED = 10;

/** Up to {@link NAMED} paths, and how many more there are. */
function someOf(paths: readonly string[]): string {
  const named = paths.slice(0, NAMED).join(', ');
  return paths.length > NAMED ? `${named} and ${paths.length - NAMED} more` : named;
}

/** Registers `mnema record` on the program. */
export function registerRecord(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const group = program
    .command('record')
    .description('pull the record over events not yet committed, and merge its tails for git');

  group
    .command('pull')
    .description('git pull over tails grown here and not yet committed')
    .addHelpText(
      'after',
      [
        '',
        'It refuses, writing nothing, when a file outside .mnema/ has changes, or when a tail file',
        'here and on the branch followed is not one the start of the other (a fork), naming each.',
        'Then it runs `git pull --autostash` with the mnema merge driver given on that one command',
        'line, puts back a new tail git did not track yet, and verifies the record. It writes no',
        'git configuration.',
      ].join('\n'),
    )
    .action(async () => {
      const { driverCommand, runRecordPull } = await import('../commands/record-pull.js');
      const result = runRecordPull({
        ...here(),
        processEnv: process.env,
        driver: driverCommand(process.execPath, process.argv[1] ?? ''),
        requirement: DEFAULT_REQUIREMENT,
      });
      if (!result.ok) {
        reportRefusal(wiring, result, {
          NOT_A_REPOSITORY: 'The record here is not inside a git repository.',
          NO_UPSTREAM:
            'This branch follows no remote branch: `git branch --set-upstream-to <remote>/<branch>` names one.',
          CHANGES_OUTSIDE_THE_RECORD:
            result.reason === 'CHANGES_OUTSIDE_THE_RECORD'
              ? `Files outside the record have changes (${someOf(result.paths)}): commit or stash them, then run it again; it pulls over the record's own events only.`
              : '',
          FETCH_FAILED:
            result.reason === 'FETCH_FAILED'
              ? `git fetch failed, and nothing was changed: ${result.said}`
              : '',
          NOT_A_PREFIX:
            result.reason === 'NOT_A_PREFIX'
              ? `Nothing was pulled or written: ${result.found.map((one) => one.said).join(' ')}`
              : '',
        });
        return;
      }
      if (result.pulled.status !== 0) {
        if (result.pulled.said !== '') io.err(result.pulled.said);
      }
      for (const path of result.restored) {
        io.out(render(fact(onOneLine`${path}: put back, with the events this checkout adds`)));
      }
      if (result.keptAside !== undefined) {
        io.err(
          render(
            fact(
              onOneLine`kept in ${result.keptAside.dir}, since the pull left another side there: ${result.keptAside.paths.join(', ')}`,
            ),
          ),
        );
      }
      if (result.pulled.status !== 0) {
        io.err(
          render(
            fact(onOneLine`git pull from ${result.upstream} failed; see what git said above.`),
          ),
        );
        io.fail();
        return;
      }
      io.out(render(fact(onOneLine`Pulled ${result.upstream}.`)));
      if (result.verdict === undefined) return;
      for (const tree of result.verdict.trees) io.out(render(treeHeadline(tree, 0)));
      if (!result.verdict.record.ok || !result.verdict.requirementMet) io.fail();
    });

  group
    .command('merge-tail')
    .description("the merge driver git runs for a tail's files")
    .argument('<ancestor>', 'the common ancestor git hands (%O); not read')
    .argument('<ours>', 'our side (%A), where the result is written')
    .argument('<theirs>', 'their side (%B)')
    .argument('[path]', 'the path git is merging (%P), named when the sides fork')
    .action(async (_ancestor: string, ours: string, theirs: string, path: string | undefined) => {
      const { forkSentence, mergeTailFiles } = await import('../commands/record-merge-tail.js');
      const done = mergeTailFiles({ ours, theirs });
      if (!done.ok) {
        io.err(render(fact(forkSentence(path ?? ours, done.line))));
        io.fail();
      }
    });

  return mutatesTheRecord(group);
}
