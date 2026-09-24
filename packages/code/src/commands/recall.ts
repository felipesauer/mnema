/**
 * `mnema recall` — the latest notes recorded here, as the text a session opens with.
 *
 * WHAT IT EXISTS TO CLOSE. A note an agent records here did not come back. The document a
 * session opens with (`mnema brief`) carries what GOVERNS — the decisions in force and the
 * adopted patterns — and a memory or an observation governs nothing, so it is in no line of
 * it. Measured on a real project over twelve days, in the same sessions: the host's own
 * memory, whose writes come back at the next session on their own, was written more than
 * twenty times with nobody asking; this record's three notes were written after a person asked,
 * and no session after them was ever handed a word of what they said. A place whose
 * writing comes back is written to; one whose writing vanishes is not.
 *
 * WHY IT IS NOT A PART OF THE DOCUMENT, which is where a reader will look first. An agent's
 * note lands in the tree that does NOT travel — a memory and an observation are routed by
 * who wrote them, and on the agent's surface that is always an agent
 * (`core/src/topology/routing.ts`) — and the document carries the committed tree alone,
 * because it is written to be redirected into a tracked file. So the notes that most need
 * to come back are exactly the ones the document may not carry; putting them in would
 * put a machine's private notes into a file somebody commits. This is the other half: a
 * text for THIS machine's session, out of every tree this machine holds for the project,
 * and never a file.
 *
 * IT DOES NOT DECIDE WHICH NOTES, OR IN WHAT ORDER — `search` does. What it asks is the
 * record's own index with no term, once per kind: the most recent records, newest first by
 * the core's one rule for that, merged across trees the way a single tree would have
 * served them, cut at the index's own limit and saying how many there were in all. A second
 * ordering of the same records would be a second answer to "which are the latest", and the
 * index already gives one — so the channel and the read a person runs (`mnema search --kind
 * memory`) cannot disagree about what was noted.
 *
 * IT REFUSES OUTSIDE A PROJECT, and when its own channel is switched off, in the shape
 * `mnema brief` refuses in — one refusal per producer of a channel, read by one function
 * ({@link switchedOff}). Both are non-zero exits on stderr, which is what the plugin's
 * handler already treats as silence.
 *
 * Read-only in the strict sense: a cache per visible tree, rebuilt in memory, and two index
 * queries. No writer, no key, no event.
 */

import { type RecordSearch, searchRecords } from '@mnema/copilot';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { RECALL_CHANNEL } from '../record-framing.js';
import {
  linkBreaksOf,
  type ScopedLinkBreak,
  THE_READING_THAT_OPENED_THESE,
  withScopedCaches,
} from '../tree-sources.js';
import { type BriefSwitchedOff, switchedOff } from './brief.js';

/** What the recall needs — injected so it is testable. */
export interface RecallContext {
  /** The working directory to resolve the trees from. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`). */
  readonly env: DiscoveryEnv;
}

/** The latest notes: the memories and the observations, each as the index serves them. */
export interface RecallDone {
  readonly ok: true;
  /** The most recent memories, newest first, with how many there are in all. */
  readonly memories: RecordSearch;
  /** The most recent observations, newest first, with how many there are in all. */
  readonly observations: RecordSearch;
  /** The tails among those read that do not chain — empty for a sound record. */
  readonly linkBreaks: readonly ScopedLinkBreak[];
}

/** The read was refused — there is no project whose notes a session here would be handed. */
export interface RecallRefused {
  readonly ok: false;
  readonly reason: 'NO_PROJECT';
}

/**
 * Reads the latest notes out of every tree visible from `ctx.cwd` — the committed one, this
 * machine's own and the personal one — which is the whole difference from {@link runBrief}'s
 * reading, and the reason it is a verb of its own.
 */
export function runRecall(ctx: RecallContext): RecallDone | RecallRefused | BriefSwitchedOff {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  return withScopedCaches(trees, (sources) => {
    const off = switchedOff(sources, RECALL_CHANNEL);
    if (off !== undefined) return off;
    return {
      ok: true as const,
      // On `err` at the surface, as the document's: what the record says about its own proof
      // qualifies the answer and is not part of it.
      linkBreaks: linkBreaksOf(sources, THE_READING_THAT_OPENED_THESE),
      memories: searchRecords(sources, { kind: 'memory' }),
      observations: searchRecords(sources, { kind: 'observation' }),
    };
  });
}
