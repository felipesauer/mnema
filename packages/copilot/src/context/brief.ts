/**
 * brief: everything that governs the work here, in one answer.
 *
 * Every other read in this layer is asked for. This one exists to be served
 * WITHOUT being asked: what it composes is meant to reach an agent through a file
 * the host reads on its own — `AGENTS.md`, `CLAUDE.md` — so the record arrives
 * whether or not the agent thought to look for it. The measured weakness it
 * answers is that adoption depended on the agent going looking, and a record it
 * never opened is indistinguishable from an empty one.
 *
 * IT COMPOSES, AND DECIDES NOTHING. Which decisions govern is {@link
 * decisionsInForce}'s answer and which patterns apply is {@link adoptedSkills}',
 * and neither rule is restated here. That is the whole reason this function exists
 * instead of two calls at the surface: "in force" written a second time is two
 * rules that can come to disagree about which calls govern, and the disagreement
 * would be invisible — one of the two readers would simply obey a different set.
 * The opening context ({@link bootstrap}) composes the same two, which is what
 * makes the file and the session's first read say the same thing by construction.
 *
 * NAMES, NEVER BODIES, like the reads it is built out of. A decision arrives as its
 * title, its citable `ADR-<n>` label and its id; a pattern as its name and its id.
 * A title IS the rule in short form — the body of a decision is the argument for
 * it, and the body of a pattern is the recipe — and a file that is read on every
 * single prompt pays for its length every time. The bodies come from a second read
 * asked about the one item that turned out to bear on the task ({@link readRecord}
 * for a decision's `rationale`, {@link adoptedSkills} for a pattern).
 *
 * NO CUT, AND THE ASYMMETRY WITH {@link bootstrap} IS DELIBERATE. The opening
 * context cuts its lists and reports the total, because a queue of work is a queue:
 * the freshest end is the useful end and the stale end can wait for a second read.
 * A rule cannot wait. A decision left out of this answer is a decision the agent
 * will not follow, and it would be left out silently — so there is no limit here
 * and no total beside the list, because with nothing cut a total is the list's own
 * length. What bounds the size instead is that each item is a NAME: the cost is a
 * handful of fields per rule, not an argument per rule.
 *
 * ACROSS THE TREES the caller can see, because both derivations do and for their
 * reason: the team's calls are in the public tree, this machine's in the private
 * one, a personal convention in the global one, and all three govern whatever is
 * being done here. The order is a property of the CONTENT in both lists (when a
 * decision came into force, then its id; a pattern's name, then its id), so which
 * trees are passed, and in what order, cannot reshuffle the answer — which is what
 * lets a consumer detect a stale copy by comparing bytes.
 */

import type { ProjectionCache } from '@mnema/core';
import { type DecisionRef, decisionsInForce } from './decisions.js';
import { adoptedSkills, type SkillRef } from './skills.js';

/** What governs the work here: the calls that hold, and the patterns to work by. */
export interface Brief {
  /**
   * The decisions in force — `accepted`, and nothing else — most recently settled
   * first. Never the `rationale`: the argument comes from {@link readRecord}, asked
   * about the one decision that bears on the task at hand.
   */
  readonly decisions: readonly DecisionRef[];
  /**
   * The adopted patterns, by name, ordered by name. Never the body: the pattern
   * itself comes from {@link adoptedSkills}, asked for the one that matches.
   */
  readonly skills: readonly SkillRef[];
}

/**
 * Everything that governs the work across `caches`: the decisions in force and the
 * adopted patterns, each by name.
 *
 * It carries NO work list, and that is the sharpest of its properties rather than
 * an omission. A file injected into every prompt is regenerated when someone
 * remembers to; a queue of work changes by the hour, so a copy of it would be wrong
 * between two regenerations — and wrong in silence, which is the defect this product
 * exists not to have. A rule does not have that failure mode: a rule that was
 * superseded since the file was written is a rule that governed until then, and the
 * live answer is one read away ({@link bootstrap}).
 */
export function brief(caches: readonly ProjectionCache[]): Brief {
  return {
    decisions: decisionsInForce(caches),
    // The body is dropped by MAPPING, not by typing: an `AdoptedSkill` satisfies
    // `SkillRef`, so assigning the list straight across would compile and carry
    // every pattern's whole text along at run time — into a file that is read on
    // every prompt. The same drop, for the same reason, as the opening context's.
    skills: adoptedSkills(caches).map(({ id, name }) => ({ id, name })),
  };
}
