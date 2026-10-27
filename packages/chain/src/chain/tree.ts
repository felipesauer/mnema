/**
 * Ensuring a project tree exists and owns its own git hygiene.
 *
 * A project tree (`<repo>/.mnema/`) is committed so the team sees the work, but
 * parts of it must NEVER reach git: the private subtree (`private/`), and every
 * machine-local key material file (private keys, installation ids, anchors). The
 * chain owns its whole tree (including what within it is ignored), so it writes
 * its OWN `.gitignore` at the tree root and never touches the project's. For the same
 * reason it writes its own `.gitattributes`, so a checkout never rewrites the line ends of
 * the bytes that were signed.
 *
 * The `.gitignore` is written LAZILY, the first time the tree is ensured (which
 * is the first write into it), not by an `init` command: a capture that happened
 * before an init would otherwise leave `private/` unprotected. Writing it is
 * idempotent and non-destructive (an existing `.gitignore` is left untouched,
 * exactly as the tail proof is written once and never overwritten), so a person
 * who has hand-edited theirs keeps their edits.
 *
 * This is for PROJECT trees only. The global tree and the key root are not committed
 * with any project, so they need no `.gitignore` OF THIS KIND. This used to say they
 * "live outside any repo (under the XDG data home)"; they live in the home now
 * (`~/.mnema`), and a home kept under git is a repo, which is why the key root carries a
 * `.gitignore` of its own, written before the first private byte (`ensureKeyRootIgnored`,
 * `keystore.ts`). Ensuring the global tree is just creating the directory, which the writer
 * already does on open.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { type ChainLayout, gitattributesPath, gitignorePath } from './layout.js';

/**
 * The chain's own `.gitignore`, self-contained at the tree root. It ignores the
 * private subtree, every local key-material file, the writers' lock directory
 * (`locks/`, which holds machinery rather than record: the locks, `tailLockPath`,
 * and two files that persist, `projectionCachePath` and `citedHeadsPath`), and the page
 * `mnema site` writes by default (`site/`, derived from the record, rebuilt at will, never
 * committed), and,
 * by NOT ignoring them,
 * lets the proof files through: `keys/*.pub`, and everything under `tails/`
 * (segments, `checkpoints.jsonl`, `tailproof.json`, and the `witness/` directory,
 * whose files are useless to a clone that cannot read them: an `.ots` is a digest, a
 * Merkle path and a block header, and a Sigstore bundle also carries a certificate that
 * NAMES SOMEBODY, an e-mail, or a repository's workflow, which is already public in
 * Sigstore's log by the time the file exists). Patterns are anchored with
 * a leading `/` so they match only THIS tree's paths, never a like-named path
 * elsewhere the project might track.
 */
const GITIGNORE_CONTENT = [
  "# Managed by mnema: this file governs only mnema's own tree.",
  '# The private subtree: this machine only, never shared.',
  '/private/',
  '# Machine-local key material: the private key and per-install ids never commit;',
  '# only the public keys (keys/*.pub) and the tails are proof the team needs.',
  '/keys/*.key',
  '/keys/*.inst',
  '/keys/*.anchor',
  '# Machinery, not record: the lock a writer holds while it appends, unlinked on the',
  '# way out; the projection a reader keeps; the heads a tail last cited. These two',
  '# persist, and losing them costs a rebuild or one repeated citation, never a proof.',
  '/locks/',
  '# The page `mnema site` writes here by default: derived from the record, rebuilt at will,',
  '# never committed.',
  '/site/',
  '',
].join('\n');

const LOCKS_LINE = '/locks/';
const SITE_LINE = '/site/';

/**
 * The chain's own `.gitattributes`. A line of the record is refused unless its bytes are the
 * canonical bytes that were signed (`FORMAT.md` section 4), and a checkout that rewrites line
 * ends (`core.autocrlf=true`, the Git for Windows default, or a `* text eol=crlf` at the
 * repository's root) puts a carriage return at the end of every line. MEASURED: such a
 * clone of an honest record was refused whole by both readers. `-text` turns off only that
 * conversion; `git diff` still shows the lines as text. It reaches a clone only once it is
 * committed, and a tool other than git (an archive, an editor that normalises on save) is
 * not stopped by it: the readers then name the carriage return in their refusal.
 */
const GITATTRIBUTES_CONTENT = [
  "# Managed by mnema: this file governs only mnema's own tree.",
  '# The record is signed bytes: never rewrite its line ends on checkout.',
  '* -text',
  '',
].join('\n');

const NO_EOL_LINE = '* -text';

/**
 * Ensures a PROJECT tree exists at `layout.root` and carries its own `.gitignore` and
 * `.gitattributes`. Creates the tree directory if absent and writes each file only if it
 * is not already there; an older `.gitignore` that lacks the `/locks/` or the `/site/` line,
 * or a `.gitattributes` that lacks `* -text`, gets that line appended and nothing else, which
 * is how a tree made before any of those lines existed gets it, at its next write. Idempotent:
 * safe to call before every write. Returns true if it wrote the `.gitignore` this call (it
 * was absent), false if one already existed (even if a line was appended to it).
 */
export function ensureTree(layout: ChainLayout): boolean {
  mkdirSync(layout.root, { recursive: true });
  ensureLine(
    gitattributesPath(layout),
    GITATTRIBUTES_CONTENT,
    (l) => l === NO_EOL_LINE,
    NO_EOL_LINE,
  );
  // A tree made before the writers' lock directory existed has no line for it, and a lock left
  // by a killed holder would be committed.
  const wrote = ensureLine(
    gitignorePath(layout),
    GITIGNORE_CONTENT,
    (l) => l === LOCKS_LINE || l === 'locks/',
    LOCKS_LINE,
  );
  // Likewise for the page `mnema site` writes under the tree: without the line a `git add`
  // of the tree would publish it. A file this call just wrote already holds it, from
  // `GITIGNORE_CONTENT`: asked only of a file that was already there, so the content is the
  // one place a new tree's line comes from.
  if (!wrote) {
    ensureLine(
      gitignorePath(layout),
      GITIGNORE_CONTENT,
      (l) => l === SITE_LINE || l === 'site/',
      SITE_LINE,
    );
  }
  return wrote;
}

/**
 * Writes `content` at `path` when nothing is there (returning true); otherwise appends `line`
 * at the end when no trimmed line of the file satisfies `has`, and touches nothing else.
 */
function ensureLine(
  path: string,
  content: string,
  has: (trimmed: string) => boolean,
  line: string,
): boolean {
  if (!existsSync(path)) {
    writeFileSync(path, content, 'utf-8');
    return true;
  }
  const existing = readFileSync(path, 'utf-8');
  if (!existing.split(/\r?\n/).some((l) => has(l.trim()))) {
    const gap = existing === '' || existing.endsWith('\n') ? '' : '\n';
    appendFileSync(path, `${gap}${line}\n`, 'utf-8');
  }
  return false;
}
