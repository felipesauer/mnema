/**
 * Whether a refused record is refused for its LAYOUT alone: the diagnosis `verify` gives when a
 * formatter or an editor has rewritten what the writer wrote.
 *
 * THE PROOF IS THE WHOLE RECORD, NEVER A LINE. A line carries its own hash, and whoever edited its
 * content can recompute that hash and add a space, so "this line's hash matches its canonical
 * bytes" proves nothing. What cannot be forged is the rest: the next line's `prev`, the content
 * root a signed checkpoint holds, the signature of a tail proof. So the record is copied, each
 * line refused only for its layout is replaced by its canonical bytes, and the SAME verifier is
 * run over the copy. Only if that verifies in full (the chain closes, every checkpoint and proof
 * is signed by its key, every event is covered by a checkpoint) is the layout all that changed.
 * Otherwise the copy's issues are reported beside the refusals, so nothing hides behind the
 * refusal of a line.
 *
 * It changes only the words of a refusal and adds issues to one: what is accepted is decided by the
 * verifier, over the record as it is, and a record this refuses it still refuses.
 */

import { join } from 'node:path';
import { type CanonicalValue, canonicalStringify } from '../events/canonical.js';
import { differsOnlyAsAFormatterLeavesIt, parseStoredJson } from '../events/stored-json.js';

/**
 * The file system, taken from the runtime when it is asked: this module is in the bundle the site
 * verifies with in a page, which links `node:fs` to a reader of a mounted record that has no copy
 * and no temporary directory, and which never calls `verify` below, only `verifyChain`.
 */
const disk = (): typeof import('node:fs') => process.getBuiltinModule('node:fs');

/** The canonical text of `text` when it differs from it only in layout, else undefined. */
function canonicalOf(text: string): string | undefined {
  let value: unknown;
  try {
    value = parseStoredJson(text);
    const canonical = canonicalStringify(value as CanonicalValue);
    return canonical !== text && differsOnlyAsAFormatterLeavesIt(text, canonical)
      ? canonical
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A copy of the record at `root` with every line refused only for its layout replaced by its
 * canonical bytes, in a directory the caller removes; undefined when no line is such a line.
 */
export function readAsCanonical(root: string): string | undefined {
  const tails = join(root, 'tails');
  if (!disk().existsSync(tails)) return undefined;
  const rewrites = new Map<string, string>();
  for (const tail of disk().readdirSync(tails)) {
    const dir = join(tails, tail);
    let names: string[];
    try {
      names = disk().readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const isTailProof = name === 'tailproof.json';
      if (!isTailProof && name !== 'checkpoints.jsonl' && !/^\d{6}\.jsonl$/.test(name)) continue;
      const file = join(dir, name);
      const text = disk().readFileSync(file, 'utf-8');
      const lines = isTailProof ? [text.replace(/\n+$/, '')] : text.split('\n');
      let changed = false;
      const out = lines.map((line) => {
        const canonical = line === '' ? undefined : canonicalOf(line);
        if (canonical === undefined) return line;
        changed = true;
        return canonical;
      });
      if (changed)
        rewrites.set(join('tails', tail, name), isTailProof ? `${out[0]}\n` : out.join('\n'));
    }
  }
  if (rewrites.size === 0) return undefined;
  const copy = disk().mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'mnema-layout-'));
  disk().cpSync(root, copy, { recursive: true });
  for (const [relative, text] of rewrites) disk().writeFileSync(join(copy, relative), text);
  return copy;
}

/** Removes what {@link readAsCanonical} made. */
export function discard(copy: string): void {
  disk().rmSync(copy, { recursive: true, force: true });
}
