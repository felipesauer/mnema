/**
 * `mnema workspace init | status`: the wiring of the verbs that make and describe the person's
 * notes beside the record, `.mnema/workbench/`. What each does and refuses is in
 * `commands/workspace.ts`; this prints it.
 *
 * The text says what the code guarantees: the notes are not proof, `verify` does not read them, and
 * `status` prints names and counts, never what a note says.
 */

import type { Command } from 'commander';
import type {
  WorkspaceInitDone,
  WorkspaceRefused,
  WorkspaceStatus,
} from '../commands/workspace.js';
import { here } from './context.js';
import { writeLines } from './io.js';
import { onOneLine } from './on-one-line.js';
import { reportRefusal } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

const SAYS: Readonly<Record<WorkspaceRefused['reason'], string>> = {
  NO_PROJECT: 'No mnema project here. Run `mnema init` first.',
  NOT_FOUNDED:
    'This folder has a .mnema/ that no `mnema init` founded, so no workbench is made beside it. Run `mnema init` first.',
  NO_GIT_REPOSITORY:
    'This project is in no git repository, and the private half of the workbench is a link into the repository’s git directory. Run `git init` first.',
  LINK_ELSEWHERE: 'The link .mnema/workbench/local points somewhere else',
  LOCAL_NOT_A_LINK:
    '.mnema/workbench/local is a folder or a file, not a link, and is left as it is.',
};

const HOW_TO_REPOINT = ' `mnema doctor --fix workbench` points it where it belongs.';

function refuse(wiring: Wiring, refusal: WorkspaceRefused): void {
  const said = SAYS[refusal.reason];
  reportRefusal(wiring, {
    reason: refusal.reason,
    ...(refusal.reason === 'NO_PROJECT'
      ? {}
      : {
          code: refusal.reason,
          message:
            refusal.reason === 'LINK_ELSEWHERE'
              ? onOneLine`${said} (${refusal.detail ?? ''}).${HOW_TO_REPOINT}`
              : said,
        }),
  });
}

function initLines(done: WorkspaceInitDone): string[] {
  const { places } = done;
  if (done.made.length === 0 && !done.linked) {
    return ['The workbench is already here: nothing changed.'];
  }
  const lines = [
    'The workbench is in .mnema/workbench/: notes of the people working here, not proof. `mnema verify` does not read it.',
  ];
  if (done.made.length > 0) lines.push(onOneLine`made: ${done.made.join(', ')}`);
  if (done.linked) {
    lines.push(
      onOneLine`.mnema/workbench/local -> ${places.target} (this machine only, never committed)`,
    );
  }
  return lines;
}

function statusLines(found: WorkspaceStatus): string[] {
  if (!found.present) {
    return ['No workbench here. `mnema workspace init` makes one.'];
  }
  const { places } = found;
  const link = found.link;
  const where =
    link.state === 'right'
      ? onOneLine`.mnema/workbench/local -> ${places.target}`
      : link.state === 'absent'
        ? onOneLine`.mnema/workbench/local is missing (it points to ${places.target}): \`mnema doctor --fix workbench\` makes it again`
        : link.state === 'elsewhere'
          ? onOneLine`.mnema/workbench/local points to ${link.to}, not to ${places.target}: \`mnema doctor --fix workbench\` points it right`
          : '.mnema/workbench/local is a folder or a file, not a link';
  const lines = [
    `shared (committed): .mnema/workbench/shared, ${found.sharedFiles} ${found.sharedFiles === 1 ? 'file' : 'files'}`,
    `local (this machine): ${where}, ${found.localFiles} ${found.localFiles === 1 ? 'file' : 'files'}`,
  ];
  if (found.changes.length === 0) lines.push('no change is open or paused');
  for (const change of found.changes) {
    lines.push(onOneLine`${change.status} · ${change.root}/changes/${change.folder}`);
  }
  return lines;
}

/** Registers `mnema workspace` and its two verbs on the program. */
export function registerWorkspace(program: Command, wiring: Wiring): Declared {
  const { io } = wiring;
  const group = program
    .command('workspace')
    .description('the notes of the people working here, beside the record and not part of it');
  group.addHelpText(
    'after',
    [
      '',
      'The notes live in `.mnema/workbench/`. They are not proof: `mnema verify` does not read them,',
      'and nothing here is signed or recorded. `workbench/shared/` is committed; `workbench/local` is',
      'a link to a folder in the repository’s git directory, this machine’s only, the same from every',
      'worktree of the clone and kept when one is removed. `git clean -x` removes the link and not',
      'what it points to; `mnema doctor --fix workbench` makes it again.',
    ].join('\n'),
  );
  group
    .command('init')
    .description('make .mnema/workbench/: a README, templates, shared/ and the private link')
    .addHelpText(
      'after',
      [
        '',
        'Needs a project `mnema init` founded, in a git repository. It makes the record’s',
        '.gitignore line for the link before the link, and never writes over a file that is there:',
        'run twice, it changes nothing. On Windows the link is a junction.',
      ].join('\n'),
    )
    .action(async () => {
      const { runWorkspaceInit } = await import('../commands/workspace.js');
      const result = runWorkspaceInit(here());
      if (!result.ok) return refuse(wiring, result);
      writeLines(io, initLines(result));
    });
  group
    .command('status')
    .description('say where the two roots are, whether the link is right, and what is open')
    .addHelpText(
      'after',
      [
        '',
        'Prints paths, counts, and one line for each change whose status is `open` or `paused` (the',
        'status line of its change.md). It never prints what a note says.',
      ].join('\n'),
    )
    .action(async () => {
      const { runWorkspaceStatus } = await import('../commands/workspace.js');
      const result = runWorkspaceStatus(here());
      if (!result.ok) return refuse(wiring, result);
      writeLines(io, statusLines(result));
    });
  // `init` makes files outside the record and no event: it reads the record (declared by what it
  // can do to the chain, and it can do nothing to it).
  return readsTheRecord(group);
}
