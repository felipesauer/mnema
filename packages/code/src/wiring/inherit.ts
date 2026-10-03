/**
 * `mnema inherit set | update` — the wiring of the two acts that point a project at another
 * repository's record. What each does and refuses is in `commands/inherit.ts`; this prints it.
 *
 * The text says what the code guarantees and no more: the record at the commit was verified, the
 * decisions are another repository's and are not signed by this project, and pointing at an
 * origin is trusting it at that commit.
 */

import type { Command } from 'commander';
import type { InheritPlan, InheritRefused } from '../commands/inherit.js';
import { here } from './context.js';
import { writeLines } from './io.js';
import { reportRefusal } from './report.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

const SAYS: Readonly<Record<InheritRefused['reason'], string>> = {
  NO_PROJECT: 'No mnema project here. Run `mnema init` first.',
  ALREADY_INHERITING: 'This project already points at an origin. `mnema inherit update` moves it.',
  NOT_INHERITING: 'This project points at no origin yet. `mnema inherit set <origin>` names one.',
  POINTER_INVALID: 'The pointer file cannot be used.',
  UNREACHABLE: 'The origin could not be reached.',
  NO_SUCH_REVISION: 'The origin has no such revision.',
  NOT_VERIFIED: 'The record at that commit is not read, so no pointer is moved.',
};

function refuse(wiring: Wiring, refusal: InheritRefused): void {
  const said = SAYS[refusal.reason];
  reportRefusal(wiring, {
    reason: refusal.reason,
    ...(refusal.reason === 'NO_PROJECT'
      ? {}
      : {
          code: refusal.reason,
          message: refusal.detail === undefined ? said : `${said} ${refusal.detail}`,
        }),
  });
}

function planLines(plan: InheritPlan): string[] {
  const { from, to } = plan;
  const lines = [
    from === undefined
      ? `${to.where} at commit ${to.commit}: the record there verifies.`
      : from.commit === to.commit
        ? `${to.where} is already at commit ${to.commit}; nothing changes.`
        : `${to.where}: commit ${from.commit} -> ${to.commit}${plan.commits === undefined ? '' : ` (${plan.commits} ${plan.commits === 1 ? 'commit' : 'commits'})`}. The record at the new commit verifies.`,
  ];
  if (plan.previous === 'unread') {
    lines.push(
      'The previous commit could not be read on this machine, so every decision below is shown as new.',
    );
  }
  if (from?.commit !== to.commit) {
    for (const rule of plan.added) lines.push(`+ ${rule.title} (${rule.adr} in that record)`);
    for (const rule of plan.removed)
      lines.push(`- ${rule.title} (${rule.adr} in that record, no longer in force)`);
    if (plan.added.length + plan.removed.length === 0) lines.push('No decision in force changes.');
    lines.push(
      plan.written
        ? 'Pointer written to .mnema/inherit.json. Inheriting is trusting that repository at that commit; the project signs none of it.'
        : 'Nothing written. Pass --write to record the pointer.',
    );
  }
  return lines;
}

/** Registers `mnema inherit` and its two verbs on the program. */
export function registerInherit(program: Command, wiring: Wiring): Declared {
  const { io } = wiring;
  const group = program
    .command('inherit')
    .description('read another repository’s decisions, pinned to one of its commits');
  group.addHelpText(
    'after',
    [
      '',
      'A project points at a repository of decisions — any git repository with a mnema',
      'record — by its location and one commit, in `.mnema/inherit.json`, which is committed.',
      '`mnema brief` then prints that record’s decisions in force in a section of their own,',
      'naming the origin and the commit. They are read, never written: this project does not',
      'sign them and its `verify` does not count them. A record that does not verify at the',
      'commit prints none, and the brief says so. Pointing at an origin is trusting it at that',
      'commit; the commit never moves unless `inherit update --write` moves it.',
      'The copy is kept under the mnema home, outside the project. Only `set` and `update`',
      'use the network; a read of the brief does only to bring in a commit this machine lacks.',
    ].join('\n'),
  );
  group
    .command('set')
    .description('point this project at a repository of decisions, at one commit')
    .argument('<origin>', 'a git URL, or a path to a repository (relative to the project root)')
    .option('--at <revision>', 'a branch or commit of the origin (its HEAD when omitted)')
    .option(
      '--write',
      'record the pointer. Omitted, it prints what would be inherited and writes nothing.',
    )
    .action(async (where: string, opts: { at?: string; write?: boolean }) => {
      const { runInheritSet } = await import('../commands/inherit.js');
      const result = runInheritSet(here(), {
        where,
        ...(opts.at !== undefined ? { at: opts.at } : {}),
        ...(opts.write === true ? { write: true } : {}),
      });
      if (!result.ok) return refuse(wiring, result);
      writeLines(io, planLines(result));
    });
  group
    .command('update')
    .description('move the pointer to a newer commit, showing what changes first')
    .option('--to <revision>', 'a branch or commit of the origin (its HEAD when omitted)')
    .option(
      '--write',
      'record the new pointer. Omitted, it prints what would change and writes nothing.',
    )
    .action(async (opts: { to?: string; write?: boolean }) => {
      const { runInheritUpdate } = await import('../commands/inherit.js');
      const result = runInheritUpdate(here(), {
        ...(opts.to !== undefined ? { to: opts.to } : {}),
        ...(opts.write === true ? { write: true } : {}),
      });
      if (!result.ok) return refuse(wiring, result);
      writeLines(io, planLines(result));
    });
  return mutatesTheRecord(group);
}
