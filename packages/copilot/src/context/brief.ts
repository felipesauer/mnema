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
 * IT COMPOSES, AND DECIDES NOTHING about which rules hold. Which decisions govern is
 * {@link decisionsInForce}'s answer and which patterns apply is {@link
 * adoptedSkills}', and neither rule is restated here. That is the whole reason this
 * function exists instead of two calls at the surface: "in force" written a second
 * time is two rules that can come to disagree about which calls govern, and the
 * disagreement would be invisible — one of the two readers would simply obey a
 * different set. The opening context ({@link bootstrap}) composes the same two
 * derivations, so the file and the session's first read cannot disagree about what
 * being in force means. What they are asked ABOUT differs, and deliberately: see the
 * tree paragraph below.
 *
 * NAMES, NEVER BODIES, like the reads it is built out of. A decision arrives as its
 * title, its citable `ADR-<n>` label and its id; a pattern as its name and its id.
 * A title IS the rule in short form — the body of a decision is the argument for
 * it, and the body of a pattern is the recipe — and a file that is read on every
 * single prompt pays for its length every time. The bodies come from a second read
 * asked about the one item that turned out to bear on the task ({@link readRecord}
 * for a decision's `rationale`, {@link adoptedSkills} for a pattern).
 *
 * NO CUT BY SIZE, AND THE ASYMMETRY WITH {@link bootstrap} IS DELIBERATE. The
 * opening context cuts its lists and reports the total, because a queue of work is a
 * queue: the freshest end is the useful end and the stale end can wait for a second
 * read. A rule cannot wait. A decision left out of this answer is a decision the
 * agent will not follow, and it would be left out silently — so there is no limit
 * here and no total beside the list, because with nothing cut by size a total is the
 * list's own length. What bounds the size instead is that each item is a NAME: the
 * cost is a handful of fields per rule, not an argument per rule.
 *
 * ONLY THE TREE THAT TRAVELS, AND THIS USED TO BE THE UNION. The paragraph here read
 * "ACROSS THE TREES the caller can see, because both derivations do and for their
 * reason: the team's calls are in the public tree, this machine's in the private one,
 * a personal convention in the global one, and all three govern whatever is being
 * done here." Two measurements falsified it, both over a record with three accepted
 * decisions of which one was recorded `--scope private`:
 *   - the document came back with TWO lines labelled `ADR-1`. The label is numbered
 *     within one chain and frozen at write time, so the union prints one number for
 *     two different rules — and the label exists to be cited. A citable handle that
 *     does not identify is the defect, not the breadth;
 *   - and the private decision's TITLE reached a file whose published recipe is
 *     `mnema brief > AGENTS.md` and a commit. The private tree exists precisely so
 *     that what is in it does not travel.
 * So what this composes is the tree that travels ({@link TRAVELS}) and nothing else:
 * the content of a committed document is what a clone gets, the ADR label is unique
 * inside one chain, a rule kept on one machine does not govern the team's work, and
 * the `diff` against a copy comes to mean ONE thing — the copy is stale — where it
 * used to mean "stale or from another tree", and a signal with two meanings is not a
 * signal. Everything else the caller can see is still the AGENT's context, which is
 * what {@link bootstrap} answers, over the union, unchanged.
 *
 * THE FILTER IS HERE, IN THE COMPOSITION, AND NOT IN THE DERIVATIONS. {@link
 * decisionsInForce} and {@link adoptedSkills} still read every cache they are handed,
 * because {@link bootstrap} needs them to: that answer is the agent's own context and
 * the private tree is the agent's. Narrowing either derivation would fix this
 * consumer and break the other one in silence — the opening read would simply stop
 * mentioning half of what the agent may see, and nothing in its answer would say so.
 * One rule, one function; the consumer that needs less passes less.
 *
 * The order is a property of the CONTENT in both lists (when a decision came into
 * force, then its id; a pattern's name, then its id), so which trees are passed, and
 * in what order, cannot reshuffle the answer — which is what lets a consumer detect a
 * stale copy by comparing bytes. Filtering by scope keeps that: it drops sources, and
 * dropping sources cannot reorder what the remaining ones say.
 */

import type { ProjectionCache, Scope } from '@mnema/core';
import type { ScopedCache } from '../sources.js';
import { type DecisionRef, decisionsInForce } from './decisions.js';
import { adoptedSkills, type SkillRef } from './skills.js';

/**
 * The one tree whose record TRAVELS — typed, so a typo fails the build.
 *
 * It is the scope, which is a ROLE and not a tree's name ("the team's record", as
 * against this machine's): a caller holding two projects' public trees is holding two
 * committed records, and this composition would carry both. That is the caller's
 * question to get right — the command line resolves ONE project's trees for this
 * verb — and it is not a case this filter can decide, since "which project is this
 * document for" is not something a scope says.
 */
const TRAVELS: Scope = 'public';

/** What governs the work here: the calls that hold, and the patterns to work by. */
export interface Brief {
  /**
   * The decisions in force in the tree that travels — `accepted`, and nothing else —
   * most recently settled first. Never the `rationale`: the argument comes from
   * {@link readRecord}, asked about the one decision that bears on the task at hand.
   */
  readonly decisions: readonly DecisionRef[];
  /**
   * The patterns adopted in the tree that travels, by name, ordered by name. Never
   * the body: the pattern itself comes from {@link adoptedSkills}, asked for the one
   * that matches.
   */
  readonly skills: readonly SkillRef[];
}

/**
 * Everything that governs the work in the trees of `sources` that TRAVEL — the
 * decisions in force and the adopted patterns, each by name. A source in any other
 * scope is read for nothing: it is handed over so that this one place decides which
 * trees a document carries.
 *
 * It carries NO work list, and that is the sharpest of its properties rather than
 * an omission. A file injected into every prompt is regenerated when someone
 * remembers to; a queue of work changes by the hour, so a copy of it would be wrong
 * between two regenerations — and wrong in silence, which is the defect this product
 * exists not to have. A rule does not have that failure mode: a rule that was
 * superseded since the file was written is a rule that governed until then, and the
 * live answer is one read away ({@link bootstrap}).
 *
 * It takes the SOURCES and not the caches, unlike the derivations under it, because
 * the tree is part of this answer: a rule in the private tree is one this composition
 * must leave out, and a caller that had already dropped the scope could not be asked
 * to. The surface hands over every tree it opened, so the omission happens where it
 * is written down — a second copy of "only the public one" at each surface is the
 * shape that drifts.
 */
export function brief(sources: readonly ScopedCache[]): Brief {
  const travels: ProjectionCache[] = sources
    .filter((source) => source.scope === TRAVELS)
    .map((source) => source.cache);
  return {
    decisions: decisionsInForce(travels),
    // The body is dropped by MAPPING, not by typing: an `AdoptedSkill` satisfies
    // `SkillRef`, so assigning the list straight across would compile and carry
    // every pattern's whole text along at run time — into a file that is read on
    // every prompt. The same drop, for the same reason, as the opening context's.
    skills: adoptedSkills(travels).map(({ id, name }) => ({ id, name })),
  };
}
