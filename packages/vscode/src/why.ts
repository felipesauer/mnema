/**
 * One file's `mnema why`, opened as a read-only document: the words of the command line, at the
 * moment it was asked.
 *
 * Which rules and which commits touch a path is the command line's answer; the document is that
 * text under a header that says what was asked and when, and nothing it did not say. Each opening
 * is its own document (the address carries a nonce), so a second look never shows an old reading.
 */

import { neutralized, oneLine } from '@mnema/chain/one-line';
import { clock } from './decision.js';
import { pathArgs } from './rules.js';

/** The scheme of the documents this module serves. */
export const WHY_SCHEME = 'mnema-why';

/** The command that says why a file is the way it is. */
export const whyArgs = (path: string): string[] => pathArgs('why', path);

/** The name a tab shows: the last part of the path, on one line. */
const nameOf = (path: string): string => oneLine(path.split(/[\\/]/).pop() ?? path);

/**
 * The path of the address: the name of the tab. It must not end in the extension of the file it is
 * about: the editor would take a `.ts` for TypeScript and draw its errors in the text, so the name
 * of the file comes first and the document is only characters.
 */
export const whyPath = (path: string): string => `/${nameOf(path)} (why)`;

/** The query of the address: the path asked about, and when it was asked. */
export const whyQuery = (path: string, at: number): string =>
  `path=${encodeURIComponent(path)}&at=${at}`;

/** The path an address carries, when it carries one. */
export function pathOfQuery(query: string): string | undefined {
  const match = /^path=([^&]*)&at=\d+$/.exec(query);
  if (match?.[1] === undefined) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

/** The document: what `mnema why -- <path>` printed under a header, or the refusal when it printed none. */
export function whyDocument(
  path: string,
  result: { readonly code: number | null; readonly stdout: string; readonly stderr: string },
  readAt: Date,
): string {
  const header = `mnema why -- ${oneLine(path)}, read at ${clock(readAt)}`;
  const said =
    result.code === 0
      ? result.stdout.trimEnd()
      : `mnema refused: ${(result.stderr || result.stdout).trim() || 'no reason given'}`;
  return `${header}\n\n${neutralized(said)}\n`;
}
