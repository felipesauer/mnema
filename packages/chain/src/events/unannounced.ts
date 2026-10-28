/**
 * WHICH FACTS CARRY A `which` NOBODY ANNOUNCED: the one reading of a `run.unannounced`
 * (FORMAT.md section 6.9), for every reader that says who did a thing.
 *
 * A `run.unannounced` marks the run its subject names, for the key that signed it, when that same
 * key's `run.started` opened the run: a mark of a run its key never opened marks nothing. A fact
 * belongs to a marked run when the SAME key signed it and it is pinned to that run (its `run`),
 * or is a `run.*` fact whose subject is that run (its birth, its mark, its end). Keyed by the
 * signer and not by the run alone, so one key's mark says nothing of what another key wrote under
 * the same run id: the writer marks its own facts, and nobody else's. Two marks of one run mark it
 * once, whatever their `handshake` says: the mark is read, its `handshake` is not.
 *
 * Nothing here judges a fact. The mark is the writer's own statement, as `which` is: it moves no
 * verdict, and a fact of an unmarked run makes no claim either way (every run written before the
 * kind existed is one).
 */

import type { CatalogEvent } from './catalog.js';

/** The envelope fields the reading needs: the signer, the subject, the run, the kind. */
type Marked = Pick<CatalogEvent, 'kind' | 'signerFp' | 'subject' | 'run'>;

/** The key a marked run is held under: the signer and the run, which no fingerprint can hold. */
function keyOf(signerFp: string, run: string): string {
  return `${signerFp}\u0000${run}`;
}

/** The run a fact belongs to: its `run`, or, for a `run.*` fact, the run its subject is. */
function runOf(event: Marked): string | undefined {
  if (event.run !== undefined) return event.run;
  return event.kind.startsWith('run.') ? event.subject : undefined;
}

/**
 * The runs the `run.unannounced` facts among `events` mark, each for the key that signed it, and
 * only where a `run.started` of that same key opened that run.
 */
export function unannouncedRuns(events: Iterable<Marked>): ReadonlySet<string> {
  const opened = new Set<string>();
  const marks = new Set<string>();
  for (const event of events) {
    if (event.kind === 'run.started') opened.add(keyOf(event.signerFp, event.subject));
    else if (event.kind === 'run.unannounced') marks.add(keyOf(event.signerFp, event.subject));
  }
  const marked = new Set<string>();
  for (const mark of marks) if (opened.has(mark)) marked.add(mark);
  return marked;
}

/**
 * The runs marked by the marks a reader already selected, as signer and run: what a reader that
 * keeps the events in an index rather than in memory hands over, each already a mark whose key's
 * `run.started` opened the run.
 */
export function unannouncedRunsOf(
  marks: Iterable<{ readonly signerFp: string; readonly run: string }>,
): ReadonlySet<string> {
  const marked = new Set<string>();
  for (const mark of marks) marked.add(keyOf(mark.signerFp, mark.run));
  return marked;
}

/** True when `event` belongs to a run `marked` holds for the key that signed it. */
export function isUnannounced(event: Marked, marked: ReadonlySet<string>): boolean {
  if (marked.size === 0) return false;
  const run = runOf(event);
  return run !== undefined && marked.has(keyOf(event.signerFp, run));
}
