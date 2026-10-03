/**
 * `mnema recall` — the notes recorded here, as the text a session opens with.
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
 * IT CHOOSES THE NOTES BY WHAT THE SESSION TOUCHES, AND THE INDEX RANKS THEM. This read
 * said *"it does not decide which notes, or in what order — `search` does"*, and served the
 * newest of each kind. That premise held the channel to a question nobody opening a session
 * asks: the newest note is not the one about the work in front of it. So the notes that
 * share a word with what this session touches (`what-the-session-touches.ts` — the changed
 * files, the tasks in progress, the branch, the last commits) come first, ranked by the
 * index's own bm25; the rest of the list is the newest of the others, by the core's one rule
 * for that. The ranking is still the index's and never a second one written here: this
 * asks it two questions (`pertinentFirst`) where it used to ask one. And with no signal —
 * a clean tree outside git, say — the list is the newest, record for record, as before; the
 * text says which order it used.
 *
 * IT REFUSES OUTSIDE A PROJECT, and when its own channel is switched off, in the shape
 * `mnema brief` refuses in — one refusal per producer of a channel, read by one function
 * ({@link switchedOff}). Both are non-zero exits on stderr, which is what the plugin's
 * handler already treats as silence.
 *
 * Read-only in the strict sense — it records nothing: a cache per visible tree, brought forward
 * from the one the tree keeps (`CacheOptions.persist`), four index
 * queries, and two git reads that take no lock. No writer, no key, no event.
 */

import { dirname } from 'node:path';
import { type PertinentSearch, pertinentFirst } from '@mnema/context';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { RECALL_CHANNEL } from '../record-framing.js';
import {
  linkBreaksOf,
  type ScopedLinkBreak,
  THE_READING_THAT_OPENED_THESE,
  withScopedCaches,
} from '../tree-sources.js';
import { type SessionTouch, whatTheSessionTouches } from '../what-the-session-touches.js';
import { type BriefSwitchedOff, switchedOff } from './brief.js';

/** What the recall needs — injected so it is testable. */
export interface RecallContext {
  /** The working directory to resolve the trees from. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`). */
  readonly env: DiscoveryEnv;
}

/** The notes: the memories and the observations, the near ones first, then the newest. */
export interface RecallDone {
  readonly ok: true;
  /** What the session touches — the words the notes were ranked by, and where they came from. */
  readonly touched: SessionTouch;
  /** The memories: the near ones first, then the newest, with how many there are in all. */
  readonly memories: PertinentSearch;
  /** The observations, in the same order, with how many there are in all. */
  readonly observations: PertinentSearch;
  /** The tails among those read that do not chain — empty for a sound record. */
  readonly linkBreaks: readonly ScopedLinkBreak[];
}

/** The read was refused — there is no project whose notes a session here would be handed. */
export interface RecallRefused {
  readonly ok: false;
  readonly reason: 'NO_PROJECT';
}

/**
 * Reads the notes out of every tree visible from `ctx.cwd`, the near ones first — the committed one, this
 * machine's own and the personal one — which is the whole difference from {@link runBrief}'s
 * reading, and the reason it is a verb of its own.
 */
export function runRecall(ctx: RecallContext): RecallDone | RecallRefused | BriefSwitchedOff {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const projectPublic = trees.projectPublic;
  if (projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  return withScopedCaches(trees, (sources) => {
    const off = switchedOff(sources, RECALL_CHANNEL);
    if (off !== undefined) return off;
    // The project's directory is the one holding its committed tree — the one the session
    // opened in, or above it — and it is what the working tree and the commits are read in.
    const touched = whatTheSessionTouches(dirname(projectPublic), sources);
    return {
      ok: true as const,
      // On `err` at the surface, as the document's: what the record says about its own proof
      // qualifies the answer and is not part of it.
      linkBreaks: linkBreaksOf(sources, THE_READING_THAT_OPENED_THESE),
      touched,
      memories: pertinentFirst(sources, { kind: 'memory', words: touched.words }),
      observations: pertinentFirst(sources, { kind: 'observation', words: touched.words }),
    };
  });
}
