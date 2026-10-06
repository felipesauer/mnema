/**
 * NO WORKFLOW PUBLISHES THE EXTENSION.
 *
 * `packages/vscode` is private and is not published, not to the VS Code Marketplace and not to Open
 * VSX. CI packs it into a `.vsix` and keeps the file as an artifact of the run, and that is all it
 * does. This reads every workflow git carries (not `ci.yml` by its path: the next one will not
 * announce itself) and every package script, and fails on a command that would send the file
 * somewhere or on a token that would let it.
 *
 * A guard that finds nothing is only worth something if it can find: the last case asserts the
 * job that packs is there, so a scan over an emptied list does not pass for a clean one.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const TRACKED: readonly string[] = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: ROOT, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 },
)
  .split('\n')
  .filter((where) => where !== '');

const WORKFLOWS = TRACKED.filter(
  (where) => where.startsWith('.github/workflows/') && /\.ya?ml$/.test(where),
);
const MANIFESTS = TRACKED.filter((where) => /(^|\/)package\.json$/.test(where));

/** A command that publishes, or the secret one needs. Anywhere in the text, comments included. */
const PUBLISHES = /\b(?:vsce|ovsx)\s+publish\b|\bVSCE_PAT\b|\bOVSX_PAT\b|\bvsce\s+login\b/;

describe('no workflow publishes the extension', () => {
  it('has no publish command or marketplace token in any workflow or package script', () => {
    const found = [...WORKFLOWS, ...MANIFESTS].filter((where) =>
      PUBLISHES.test(readFileSync(join(ROOT, where), 'utf-8')),
    );
    expect(found, 'a file that publishes the extension, or holds a token for it').toEqual([]);
  });

  it('still packs the extension and keeps the file, so the scan above has something to refuse', () => {
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf-8');
    expect(ci).toMatch(/run: pnpm --filter @mnema\/vscode package\b/);
    expect(ci).toMatch(/path: packages\/vscode\/mnema-\*\.vsix/);
    expect(WORKFLOWS).toContain('.github/workflows/ci.yml');
  });
});
