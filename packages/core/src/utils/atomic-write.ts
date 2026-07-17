import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Writes a file via a temporary path then renames it into place so a
 * crash mid-write cannot leave a half-written file. Creates the target
 * directory if it does not yet exist.
 *
 * @param filePath - Final path of the file
 * @param content - String contents to write (UTF-8)
 */
export function writeFileAtomic(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, filePath);
}
