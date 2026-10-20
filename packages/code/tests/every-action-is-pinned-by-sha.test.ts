// @reads-the-tree
/**
 * EVERY ACTION A WORKFLOW USES IS PINNED BY THE SHA OF A COMMIT.
 *
 * A tag is a pointer its owner can move: `actions/checkout@v7` runs whatever `v7` names on the
 * day the job starts, with this repository's token in hand. A commit SHA cannot be moved, so a
 * workflow that names one runs the code that was read when it was pinned. Each `uses:` of a
 * third-party action therefore carries the 40-hex SHA and, after it, `# vX.Y.Z`, the release the
 * SHA was taken from, so a reader and the Dependabot `github-actions` ecosystem both see which
 * version it is.
 *
 * This reads every workflow git carries, not `ci.yml` by its path: the next one will not
 * announce itself. A local action (`uses: ./…`) is ours and is excused by that prefix; nothing
 * else is excused by name.
 *
 * WHAT IT DOES NOT SAY. It does not check that the SHA belongs to the tag in the comment, which
 * needs the network; Dependabot writes the two together, and a hand edit that changes one is the
 * review's to see. It reads `uses:` on a step or on a job, not the contents of a reusable
 * workflow it calls.
 *
 * A guard that finds nothing is worth something only if it can find: the last case feeds the
 * reader the shapes that must be refused and asserts the workflows really do hold `uses:` lines.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const WORKFLOWS: readonly string[] = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '.github/workflows'],
  { cwd: ROOT, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 },
)
  .split('\n')
  .filter((where) => /\.ya?ml$/.test(where));

const USES = /^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/;
const PINNED = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/;
const VERSION_COMMENT = /^\s+# v\d+\.\d+\.\d+\s*$/;

/** Every `uses:` of the text that is not a local action, with the line it is on. */
function thirdPartyUses(text: string): { line: number; ref: string; rest: string }[] {
  const found: { line: number; ref: string; rest: string }[] = [];
  text.split('\n').forEach((raw, index) => {
    const m = USES.exec(raw);
    if (m?.[1] === undefined) return;
    if (m[1].startsWith('./')) return;
    found.push({ line: index + 1, ref: m[1], rest: m[2] ?? '' });
  });
  return found;
}

/** The ones that are not a SHA with its version comment, as `file:line ref`. */
function unpinned(text: string, file: string): string[] {
  return thirdPartyUses(text)
    .filter((u) => !PINNED.test(u.ref) || !VERSION_COMMENT.test(u.rest))
    .map((u) => `${file}:${u.line} ${u.ref}${u.rest}`);
}

describe('every action a workflow uses is pinned by the SHA of a commit', () => {
  it('has no third-party `uses:` in any workflow that is a tag, a branch, or a SHA with no version', () => {
    const loose = WORKFLOWS.flatMap((where) =>
      unpinned(readFileSync(join(ROOT, where), 'utf-8'), where),
    );
    expect(loose, 'a `uses:` not pinned by a 40-hex SHA followed by `# vX.Y.Z`').toEqual([]);
  });

  it('can see the defect: a tag, a branch, a short SHA and a SHA with no version are all refused', () => {
    const sha = 'a'.repeat(40);
    const text = [
      '      - uses: actions/checkout@v7',
      '      - uses: actions/checkout@main',
      '      - uses: actions/checkout@abc1234 # v7.0.1',
      `      - uses: actions/checkout@${sha}`,
      `      - uses: actions/checkout@${sha} # v7`,
      `      - uses: actions/checkout@${sha} # v7.0.1`,
      '      - uses: ./packages/action',
    ].join('\n');
    expect(unpinned(text, 'x.yml').map((s) => s.split(' ')[0])).toEqual([
      'x.yml:1',
      'x.yml:2',
      'x.yml:3',
      'x.yml:4',
      'x.yml:5',
    ]);
  });

  it('reads workflows that really hold third-party `uses:` lines, so the scan has something to refuse', () => {
    expect(WORKFLOWS).toContain('.github/workflows/ci.yml');
    const all = WORKFLOWS.flatMap((where) =>
      thirdPartyUses(readFileSync(join(ROOT, where), 'utf-8')),
    );
    expect(all.length).toBeGreaterThan(20);
  });
});
