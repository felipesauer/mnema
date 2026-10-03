/**
 * Where the long text of a write comes from: typed on the line, read from standard input
 * (`--stdin`), or read from a file (`--body-file <path>`) — one of the three, never two.
 *
 * A long text typed on the line is in the shell's history and in the process list while the verb
 * runs; the two other doors keep it out of both. A text that came from two places at once has no
 * way to say which was meant, so the line is refused with the places it named, and nothing is
 * written. The text is taken verbatim, except that ONE line break at its end is dropped: a file
 * and a pipe end in one, and a typed argument does not.
 */

import { readFileSync } from 'node:fs';
import type { Option } from 'commander';
import { Option as CommanderOption } from 'commander';
import { REFUSED } from './from-the-group.js';
import { reportUsage } from './report.js';
import type { Wiring } from './verb.js';

/** What the two flags say in `--help`, with the text each one is the door for. */
export function bodySourceOptions(what: string): readonly Option[] {
  return [
    new CommanderOption('--stdin', `read the ${what} from standard input instead of the line`),
    new CommanderOption(
      '--body-file <path>',
      `read the ${what} from this file instead of the line`,
    ),
  ];
}

/** The three places a text can come from, as the line gave them. */
export interface BodyGiven {
  readonly typed?: string | undefined;
  readonly stdin?: boolean | undefined;
  readonly bodyFile?: string | undefined;
}

/** The text, from the one place it came from — or {@link REFUSED}, once the line was refused. */
export async function bodyFrom(
  wiring: Wiring,
  what: string,
  how: string,
  given: BodyGiven,
): Promise<string | typeof REFUSED> {
  const named = [
    ...(given.typed !== undefined ? ['the argument'] : []),
    ...(given.stdin === true ? ['--stdin'] : []),
    ...(given.bodyFile !== undefined ? ['--body-file'] : []),
  ];
  if (named.length > 1) {
    reportUsage(
      wiring,
      `the ${what} came from ${named.join(' and ')}, and only one place can be the text.`,
      `Give it one way: ${how}, --stdin, or --body-file <path>.`,
    );
    return REFUSED;
  }
  let text: string;
  if (given.typed !== undefined) {
    text = given.typed;
  } else if (given.stdin === true) {
    text = wiring.io.input === undefined ? '' : await wiring.io.input();
  } else if (given.bodyFile !== undefined) {
    try {
      text = readFileSync(given.bodyFile, 'utf-8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'unreadable';
      reportUsage(wiring, `--body-file could not read ${given.bodyFile} (${code}).`);
      return REFUSED;
    }
  } else {
    reportUsage(
      wiring,
      `the ${what} is missing.`,
      `Give it ${how}, with --stdin, or with --body-file <path>.`,
    );
    return REFUSED;
  }
  if (given.typed !== undefined) return text;
  return text.replace(/\r?\n$/, '');
}
