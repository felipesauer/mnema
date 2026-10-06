/**
 * The `mnema commit-hook` wiring: what it declares, and what it prints.
 *
 * A group of three: `install` and `uninstall` put the optional `prepare-commit-msg` hook in a
 * repository and take it out, and `suggest` is what that hook calls. The bare group prints the
 * help, because there is no state of the record to read.
 *
 * IT WRITES A FILE OF THE PERSON'S, SO IT IS ONLY EVER ASKED FOR: `init` does not install it
 * and nothing else does. It is declared `mutates` although it appends no event — the effect
 * names what an invocation can reach, and a read-only session (`repl`) must not be offered a
 * verb that writes into `.git`.
 *
 * `suggest` NEVER FAILS: it is called by a hook inside `git commit`, and a suggestion that
 * refused the commit would cost more than the whole feature is worth. Every error is silence
 * and the exit is zero.
 */

import type { Command } from 'commander';
import { fact } from '../presentation/detail.js';
import { here } from './context.js';
import { onOneLine } from './on-one-line.js';
import { reportRefusal } from './report.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

/** Registers `mnema commit-hook` on the program. */
export function registerCommitHook(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const group = program
    .command('commit-hook')
    .description('install or remove an optional git hook that suggests the Mnema-Decision trailer')
    .addHelpText(
      'after',
      [
        '',
        'The hook is a prepare-commit-msg script. It appends a few # comment lines to the message',
        'of a commit made in an editor, naming the decisions in force that govern the staged files;',
        'git drops them if you leave them, and removing the "# " in front of a line cites it.',
        'It runs only where `install` put it, never overwrites a hook that is not its own, follows',
        'core.hooksPath, and never fails a commit.',
      ].join('\n'),
    );

  for (const act of ['install', 'uninstall'] as const) {
    group
      .command(act)
      .description(
        act === 'install'
          ? 'write the prepare-commit-msg hook in this repository (refuses to replace another one)'
          : 'remove the prepare-commit-msg hook, only if mnema wrote it',
      )
      .action(async () => {
        const { installCommitHook, uninstallCommitHook } = await import(
          '../commands/commit-hook.js'
        );
        const result = (act === 'install' ? installCommitHook : uninstallCommitHook)(here());
        if (!result.ok) {
          reportRefusal(
            wiring,
            result,
            result.reason === 'NOT_A_REPOSITORY'
              ? { NOT_A_REPOSITORY: 'This is not a git repository.' }
              : {
                  FOREIGN_HOOK: `${result.path} is a hook mnema did not write, so it is left as it is.`,
                },
          );
          return;
        }
        const said = {
          installed: 'Installed the prepare-commit-msg hook',
          already: 'The prepare-commit-msg hook is already installed',
          removed: 'Removed the prepare-commit-msg hook',
          absent: 'There is no prepare-commit-msg hook to remove',
        };
        io.out(render(fact(onOneLine`${said[result.state]}: ${result.path}`)));
      });
  }

  group
    .command('suggest')
    .description('what the hook calls: append the suggestion to a commit message file')
    .argument('<message-file>', 'the file git prepared the message in')
    .argument('[source]', 'where git says the message came from')
    .action(async (messageFile: string, source: string | undefined) => {
      try {
        const { suggestTrailer } = await import('../commands/commit-hook.js');
        suggestTrailer(here(), { messageFile, source: source ?? '' });
      } catch {
        // A suggestion never costs a commit.
      }
    });

  return mutatesTheRecord(group);
}
