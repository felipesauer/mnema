/**
 * A LINE OF A KIND NO VERSION DECLARES, APPENDED TO A RECORD THE WAY A NEWER MNEMA ON THIS MACHINE
 * WRITES IT (ADR-113): chained after the last line of the record's one tail, covered by a checkpoint
 * the same key signs under the scheme and record name the tail's last checkpoint carries, and its
 * head kept where the writer keeps it, so the next write here continues the tail.
 *
 * It is the fixture of every test that needs a record holding lines this binary reads past: the
 * line is built from the project's own helpers (`entryHash`, `signCheckpoint`), never typed by hand.
 */

import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type CanonicalValue,
  canonicalStringify,
  catalogUpcasters,
  checkpointHash,
  entryHash,
  listTails,
  loadOrCreateKeyPair,
  readTailCheckpoints,
  readTailEntries,
  serializeCheckpoint,
  signCheckpoint,
  writtenAsStored,
} from '@mnema/chain';

/** The kind no version declares (`x.from-the-future`, reserved by `FORMAT.md` section 7.1). */
export const FUTURE = 'x.from-the-future';

/**
 * Appends one line of `kind` to the one tail of the record at `record`, signed by the key under
 * `home`, naming `subject`. Returns the tail it went into.
 */
export function aNewerMnemaWrites(
  where: { readonly record: string; readonly home: string },
  payload: Readonly<Record<string, CanonicalValue>>,
  line: { readonly kind?: string; readonly subject?: string } = {},
): string {
  const { record, home } = where;
  const [tail, ...others] = listTails({ root: record });
  if (tail === undefined || others.length > 0) throw new Error('setup: not one tail');
  const entries = readTailEntries({ root: record }, tail, catalogUpcasters());
  const last = entries.at(-1);
  if (last === undefined) throw new Error('setup: an empty tail');
  const keyPair = loadOrCreateKeyPair({ root: join(home, '.mnema', 'identity') });
  const event = {
    v: 1,
    kind: line.kind ?? FUTURE,
    at: new Date(Date.parse(last.event.at) + 1000).toISOString(),
    who: last.event.who,
    signerFp: keyPair.fingerprint,
    subject: line.subject ?? 'something-new',
    payload,
  };
  const seq = last.link.seq + 1;
  const hash = entryHash({ event: writtenAsStored(event), tail, seq, prev: last.link.hash });
  const segment = join(record, 'tails', tail, '000001.jsonl');
  appendFileSync(
    segment,
    `${canonicalStringify({ event, link: { tail, seq, prev: last.link.hash, hash } })}\n`,
  );
  const checkpoints = readTailCheckpoints({ root: record }, tail);
  const previous = checkpoints.at(-1);
  if (previous === undefined || previous.toSeq !== last.link.seq) {
    throw new Error('setup: the tail is not covered to its end');
  }
  const signed = signCheckpoint({
    tail,
    fromSeq: seq,
    events: [writtenAsStored(event)],
    prev: checkpointHash(previous),
    keyPair,
    ...(previous.record !== undefined ? { record: previous.record } : {}),
  });
  appendFileSync(
    join(record, 'tails', tail, 'checkpoints.jsonl'),
    `${serializeCheckpoint(signed)}\n`,
  );
  // The note of the last entry this installation wrote (`kept-head.ts`): a newer writer keeps it
  // as this one does, so the next write here continues this tail rather than starting another.
  const head = join(record, 'locks', `${tail}.head`);
  if (!existsSync(head)) throw new Error(`setup: no kept head at ${head}`);
  writeFileSync(head, `${seq} ${hash}\n`);
  return tail;
}
