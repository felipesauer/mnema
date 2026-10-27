/**
 * The mark on the record's own folder in the Explorer: a short badge and the extension's accent,
 * on the `.mnema` folder of the first workspace folder and on nothing else.
 *
 * It decorates the folder only. A file the record governs is not marked, because the command line
 * does not list the addresses the rules cover, and a file with no mark would then look as if no
 * rule reached it, which the record does not say. Nothing here reads the disk or starts a process:
 * the editor asks about the folders it draws, and the answer is a comparison of two paths.
 */

import { join } from 'node:path';

/** The badge: one letter, the mnema M. */
export const RECORD_BADGE = 'M';

/** The theme colour the folder wears: declared by the manifest, with a value for each kind of theme. */
export const RECORD_COLOR = 'mnema.recordFolder';

/** What the tooltip says the folder is. */
export const RECORD_TOOLTIP = 'The mnema record of this project. mnema verify reads it.';

/** The folder of the record in a workspace folder. */
export const recordFolderOf = (workspaceFolder: string): string => join(workspaceFolder, '.mnema');

/** The decoration the folder of the record wears: nothing for any other address. */
export function decorationFor(
  uri: { readonly scheme: string; readonly fsPath: string },
  workspaceFolder: string,
): { readonly badge: string; readonly tooltip: string; readonly color: string } | undefined {
  if (uri.scheme !== 'file' || uri.fsPath !== recordFolderOf(workspaceFolder)) return undefined;
  return { badge: RECORD_BADGE, tooltip: RECORD_TOOLTIP, color: RECORD_COLOR };
}
