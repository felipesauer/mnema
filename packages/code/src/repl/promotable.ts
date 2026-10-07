/**
 * THE ONE SENTENCE THE CONSOLE SAYS ABOUT A PROMOTION, and what it needs to say it.
 *
 * It says THAT there are candidates and WHICH VERB lists them. It never says where — not a
 * path, not an id of another project — because the console is read by a person and may be
 * recorded, and the folders of the other projects on a machine are not the console's to
 * show. `mnema promote --workspace` is the verb that names them, to the person who typed
 * the names.
 *
 * WHICH FOLDERS IT LOOKS IN, AND THE REASON THERE IS NO OTHER ANSWER. A console is a session
 * of the command line, and the command line has no host to announce a workspace. What it
 * holds is what the person has TYPED: a line that names projects with `--workspace` (today
 * `verify`) has named a set, and that set is the only one this session ever has. It never
 * walks the disk to find more — that was refused for `verify --workspace` and the reason is
 * the same here (`commands/verify.ts`): the product would be guessing, and would reach a
 * stranger's project in a neighbouring folder. A session that has been told of no projects
 * says nothing, and a set with no candidates says nothing.
 *
 * It costs one more reading of each project named, paid after the line that named them and
 * already paid one.
 */

import { fact } from '../presentation/detail.js';
import type { Line } from '../presentation/line.js';

/** The flag whose values are the projects a line names. */
const THE_SET = '--workspace';

/**
 * The paths a typed line names with `--workspace`, or none when it names no set. The
 * values are the words after the flag up to the next flag, which is how the surface
 * declares them (`<path...>`); `--workspace=<path>` names one.
 */
export function projectsNamedBy(argv: readonly string[]): readonly string[] {
  const named: string[] = [];
  for (let at = 0; at < argv.length; at++) {
    const word = argv[at] as string;
    if (word.startsWith(`${THE_SET}=`)) {
      const value = word.slice(THE_SET.length + 1);
      if (value !== '') named.push(value);
      continue;
    }
    if (word !== THE_SET) continue;
    for (at++; at < argv.length && !(argv[at] as string).startsWith('-'); at++) {
      named.push(argv[at] as string);
    }
    at--;
  }
  return named;
}

/** The sentence, or nothing when there is nothing to say. */
export function promotableLine(candidates: number): Line | undefined {
  if (candidates === 0) return undefined;
  const which =
    candidates === 1 ? '1 pattern or decision recurs' : `${candidates} patterns or decisions recur`;
  return fact(
    `${which} in the projects you named, in force with the same words. ` +
      '`mnema promote --workspace …` lists them (outside this session: it can write).',
    0,
  );
}
