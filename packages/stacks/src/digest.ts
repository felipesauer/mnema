import { createHash } from 'node:crypto';

/** One file of a stack: its path relative to the stack's root, with `/` as the separator, and its bytes. */
export interface StackFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** The one file the digest leaves out besides `.git/`: the author's signature, which signs the digest. */
export const SIGNATURE_FILE = 'stack.sigstore.json';

/** Why a path cannot be part of a stack. */
export type PathProblem =
  | 'outside-the-root'
  | 'not-normalized'
  | 'unreadable-by-the-reproducer'
  | 'duplicate';

export interface PathRefusal {
  readonly path: string;
  readonly problem: PathProblem;
  readonly message: string;
}

/** True for what the digest never covers: anything under `.git/` and the signature at the root. */
export function isOutsideTheDigest(path: string): boolean {
  return path === '.git' || path.startsWith('.git/') || path === SIGNATURE_FILE;
}

/** The refusal a path earns, or `undefined`. A name the shell reproducer could not read back is refused too. */
export function refusePath(path: string): PathRefusal | undefined {
  const refuse = (problem: PathProblem, message: string): PathRefusal => ({
    path,
    problem,
    message,
  });
  if (path === '' || path.startsWith('/') || path.includes('\\')) {
    return refuse('outside-the-root', 'the path is empty, absolute or uses a backslash');
  }
  const segments = path.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    return refuse('outside-the-root', 'the path leaves the root or has an empty segment');
  }
  if (path !== path.normalize('NFC')) {
    return refuse('not-normalized', 'the name is not in Unicode normalization form NFC');
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: a control character in a name is exactly what is refused
  if (/[\u0000-\u001f\u007f]/.test(path)) {
    return refuse(
      'unreadable-by-the-reproducer',
      'the name holds a control character, a newline among them, and the line-based reproducer cannot read it back',
    );
  }
  return undefined;
}

export interface DigestResult {
  /** The lowercase hex SHA-256, or `undefined` when a path was refused. */
  readonly digest: string | undefined;
  readonly refusals: readonly PathRefusal[];
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const compareBytes = (a: string, b: string): number =>
  Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

/**
 * The identity of a stack.
 *
 * ```
 * digest = sha256( for each file, in byte order of its path:  path NUL sha256(file) LF )
 * ```
 *
 * over every file of the stack except `.git/` and the signature at the root. Line endings are
 * not normalized: the bytes are the bytes. `digest.sh` in this package computes the same
 * number with `find`, `sort` and `sha256sum`, and a case holds the two to the same golden.
 */
export function stackDigest(files: readonly StackFile[]): DigestResult {
  const counted = files.filter((f) => !isOutsideTheDigest(f.path));
  const refusals: PathRefusal[] = [];
  const seen = new Set<string>();
  for (const file of counted) {
    const refusal = refusePath(file.path);
    if (refusal) refusals.push(refusal);
    else if (seen.has(file.path)) {
      refusals.push({
        path: file.path,
        problem: 'duplicate',
        message: 'the same path appears twice',
      });
    }
    seen.add(file.path);
  }
  if (refusals.length > 0) return { digest: undefined, refusals };
  const lines = [...counted]
    .sort((a, b) => compareBytes(a.path, b.path))
    .map((f) =>
      Buffer.concat([
        Buffer.from(f.path, 'utf8'),
        Buffer.from([0]),
        Buffer.from(`${sha256(f.bytes)}\n`),
      ]),
    );
  return { digest: sha256(Buffer.concat(lines)), refusals };
}
