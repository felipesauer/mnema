/**
 * The `mnema completion` wiring: what it declares, and what it prints.
 *
 * `mnema completion <shell>` prints a completion script to stdout and does nothing else.
 * It installs NOTHING, writes to no file and touches no shell profile, because that is
 * the shape the market settled on — `gh completion -s bash`, `kubectl completion bash`,
 * `docker completion`, `rustup completions` — and because the alternative is a verb that
 * edits a file it did not write. Where the script goes is the operator's choice, the way
 * `mnema brief > AGENTS.md` is.
 *
 * IT DOES NOT DETECT THE SHELL EITHER. The shell is an ARGUMENT with `.choices()`, so a
 * typo earns the parser's own refusal naming the three, in the product's voice. Detection
 * would have to read `$SHELL` — which names the LOGIN shell and not the one running the
 * command — and a wrong guess here prints a file that loads silently into the wrong
 * dialect and completes nothing.
 *
 * THE SCRIPT IS GENERATED FROM THE PROGRAM IT IS REGISTERED ON, and that is why this
 * file receives `program` and passes it down: a script written by hand would list the
 * verbs a second time, and the first pull request to add one would leave it a version
 * behind with nothing failing. What the generator does with it is in `completion/`, and
 * it loads inside the action — the declaration is eager, the work is not (see
 * `verb.ts`).
 *
 * The three shells and their help live HERE rather than in `completion/`, next to the
 * flag that accepts them, the way `--color`'s three whens live in `color.ts`. It keeps
 * `completion/` — the whole generator — off the eager path with no exception to declare.
 */

import { Argument, type Command } from 'commander';
import type { Wiring } from './verb.js';

/** The shells this verb writes a script for. Closed: commander refuses anything else. */
export const SHELLS = ['bash', 'zsh', 'fish'] as const;

/** A shell a completion script can be written for. */
export type Shell = (typeof SHELLS)[number];

/** The help for the `<shell>` argument, which is also the list of what exists. */
export const SHELL_HELP = 'the shell to write the script for';

/** Registers `mnema completion` on the program. */
export function registerCompletion(program: Command, wiring: Wiring): void {
  const { io } = wiring;
  program
    .command('completion')
    .description('print the tab-completion script for a shell')
    .addArgument(new Argument('<shell>', SHELL_HELP).choices([...SHELLS]))
    .addHelpText(
      'after',
      [
        '',
        'It prints to stdout and installs nothing — where the script goes is your choice:',
        '  source <(mnema completion bash)                                this shell, now',
        '  mnema completion bash > /etc/bash_completion.d/mnema           every bash',
        `  mnema completion zsh > "\${fpath[1]}/_mnema"                    every zsh`,
        '  mnema completion fish > ~/.config/fish/completions/mnema.fish  every fish',
        '',
        'It completes verbs, subcommands and option names, and the values of an option',
        'whose declaration enumerates them (--color, and this argument). It does NOT',
        'complete an id or a transition: neither is in any declaration, so answering',
        'would mean running mnema on every Tab — more than the command itself costs.',
        'The script is generated from this program, so a verb added to it is completed',
        'the same day. Print it again after an upgrade.',
      ].join('\n'),
    )
    .action(async (shell: Shell) => {
      const { completionScript } = await import('../completion/script.js');
      io.out(completionScript(program, shell));
    });
}
