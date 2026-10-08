import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StackFile } from './digest.js';
import type { Problem } from './problem.js';

export interface StackFiles {
  readonly files: readonly StackFile[];
  readonly problems: readonly Problem[];
}

/**
 * Every file of the directory, relative to it, `.git/` left out. A symlink is a problem, whatever
 * it points to and wherever it sits: the digest names bytes, and a link names a place. Nothing in
 * the directory is opened except to read it.
 */
export function readStackFiles(root: string): StackFiles {
  const files: StackFile[] = [];
  const problems: Problem[] = [];
  const walk = (relative: string): void => {
    const here = relative === '' ? root : join(root, relative);
    for (const name of readdirSync(here).sort()) {
      const path = relative === '' ? name : `${relative}/${name}`;
      if (path === '.git') continue;
      const stat = lstatSync(join(root, path));
      if (stat.isSymbolicLink()) {
        problems.push({
          code: 'symlink',
          path,
          message: `${path} is a symbolic link; a stack holds files, and a link names a place, not bytes`,
        });
      } else if (stat.isDirectory()) {
        walk(path);
      } else if (stat.isFile()) {
        files.push({ path, bytes: readFileSync(join(root, path)) });
      } else {
        problems.push({
          code: 'not-a-file',
          path,
          message: `${path} is neither a file nor a directory`,
        });
      }
    }
  };
  walk('');
  return { files, problems };
}
