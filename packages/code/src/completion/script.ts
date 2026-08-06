/**
 * WHICH RENDERING, for the shell that was asked for.
 *
 * One table, total in the type: a shell named in `SHELLS` and not rendered here does not
 * compile, which is the whole reason the three renderers are reached through a table
 * rather than through a switch in the verb's action. A fourth shell is a row and a file.
 *
 * It is the entry point of everything under `completion/`, and it is loaded INSIDE the
 * verb's action (see `wiring/completion.ts`) — nothing here is on the path of any other
 * command, and `the-floor-is-the-declaration.test.ts` refuses the day one of these
 * modules arrives eagerly.
 */

import type { Command } from 'commander';
import type { Shell } from '../wiring/completion.js';
import { bashScript } from './bash.js';
import { fishScript } from './fish.js';
import { type CompletionTree, completionTree } from './tree.js';
import { zshScript } from './zsh.js';

/** How each shell writes the tree. Total over {@link Shell}. */
const RENDERED: Readonly<Record<Shell, (tree: CompletionTree) => string>> = {
  bash: bashScript,
  zsh: zshScript,
  fish: fishScript,
};

/**
 * The completion script for one shell, read off the program's own declarations.
 *
 * Pure: it parses nothing, runs nothing and reads no record — the answer depends on the
 * declared surface and on the shell, and on nothing about the machine it runs on.
 */
export function completionScript(program: Command, shell: Shell): string {
  return RENDERED[shell](completionTree(program));
}
