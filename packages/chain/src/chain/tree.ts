/**
 * Ensuring a project tree exists and owns its own git hygiene.
 *
 * A project tree (`<repo>/.mnema/`) is committed so the team sees the work, but
 * parts of it must NEVER reach git: the private subtree (`private/`), and every
 * machine-local key material file (private keys, installation ids, anchors). The
 * chain owns its whole tree — including what within it is ignored — so it writes
 * its OWN `.gitignore` at the tree root and never touches the project's.
 *
 * The `.gitignore` is written LAZILY, the first time the tree is ensured (which
 * is the first write into it), not by an `init` command: a capture that happened
 * before an init would otherwise leave `private/` unprotected. Writing it is
 * idempotent and non-destructive — an existing `.gitignore` is left untouched,
 * exactly as the tail proof is written once and never overwritten — so a person
 * who has hand-edited theirs keeps their edits.
 *
 * This is for PROJECT trees only. The global tree and the key root live outside
 * any repo (under the XDG data home), so they need no `.gitignore`; ensuring
 * them is just creating the directory, which the writer already does on open.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

import { type ChainLayout, gitignorePath } from './layout.js';

/**
 * The chain's own `.gitignore`, self-contained at the tree root. It ignores the
 * private subtree and every local key-material file, and — by NOT ignoring them
 * — lets the proof files through: `keys/*.pub`, and everything under `tails/`
 * (segments, `checkpoints.jsonl`, `tailproof.json`). Patterns are anchored with
 * a leading `/` so they match only THIS tree's paths, never a like-named path
 * elsewhere the project might track.
 */
const GITIGNORE_CONTENT = [
  "# Managed by mnema — this file governs only mnema's own tree.",
  '# The private subtree: this machine only, never shared.',
  '/private/',
  '# Machine-local key material: the private key and per-install ids never commit;',
  '# only the public keys (keys/*.pub) and the tails are proof the team needs.',
  '/keys/*.key',
  '/keys/*.inst',
  '/keys/*.anchor',
  '',
].join('\n');

/**
 * Ensures a PROJECT tree exists at `layout.root` and carries its own
 * `.gitignore`. Creates the tree directory if absent and writes the `.gitignore`
 * only if one is not already there. Idempotent: safe to call before every write.
 * Returns true if it wrote the `.gitignore` this call (it was absent), false if
 * one already existed.
 */
export function ensureTree(layout: ChainLayout): boolean {
  mkdirSync(layout.root, { recursive: true });
  const path = gitignorePath(layout);
  if (existsSync(path)) return false;
  writeFileSync(path, GITIGNORE_CONTENT, 'utf-8');
  return true;
}
