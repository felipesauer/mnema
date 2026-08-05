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
 * A title IS the rule in short form — the body of a decision is the argument for it
 * and what it turned down, and the body of a pattern is the recipe — and a file that
 * is read on every single prompt pays for its length every time. The bodies come
 * from a second read asked about the one item that turned out to bear on the task
 * ({@link readRecord} for a decision's `rationale` and `alternatives`, {@link
 * adoptedSkills} for a pattern).
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
 * the content of a committed document is what a clone gets, the ADR label is NUMBERED
 * inside one chain — this line said "unique inside one chain", which is what the
 * numbering intends and not what it guarantees; two tails of one chain falsify it, and
 * the paragraph below is what the answer does about that —
 * a rule kept on one machine does not govern the team's work, and
 * the `diff` against a copy comes to mean ONE thing — the copy is stale — where it
 * used to mean "stale or from another tree", and a signal with two meanings is not a
 * signal. Everything else the caller can see is still the AGENT's context, which is
 * what {@link bootstrap} answers, over the union, unchanged.
 *
 * ONE TREE IS NOT ONE CHAIN, WHICH IS WHY THE ANSWER ALSO DECLARES. Serving the
 * committed tree alone fixed the ADR-1 that came from FOLDING two trees, and left the
 * one that comes from inside a single tree: the number is minted from the writer's
 * view of the chain, so two clones deciding offline both mint `ADR-7` legitimately and
 * the labels meet when the tails do. Nothing at write time could have refused either —
 * the machines could not see each other — and nothing may renumber them afterwards,
 * because the label is frozen into a signed event and a record that edited its past
 * would be worth nothing. So what this composition owes the document is the FACT:
 * which printed label names more than one rule, and which ids those are ({@link
 * Brief.collisions}). Asserted in `brief.test.ts` — "declares a printed label that two
 * decisions of one chain answer to" — over two tails, which is the only way a chain
 * gets there.
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

import type { AdrCollision, ProjectionCache, Scope } from '@mnema/core';
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
   * most recently settled first. Never the body: neither the `rationale` nor the
   * `alternatives` it turned down. Both come from {@link readRecord}, asked about
   * the one decision that bears on the task at hand.
   */
  readonly decisions: readonly DecisionRef[];
  /**
   * The patterns adopted in the tree that travels, by name, ordered by name. Never
   * the body: the pattern itself comes from {@link adoptedSkills}, asked for the one
   * that matches.
   */
  readonly skills: readonly SkillRef[];
  /**
   * The `ADR-<n>` labels PRINTED above that more than one decision of the same
   * chain answers to, each with every id that carries it. Empty in the ordinary
   * case, which is what keeps the document's bytes exactly what they were.
   *
   * It is here rather than left to the printer because it is a fact about the
   * record, and this is the one place that decides which record the document is
   * made of. What a consumer does with it is a presentation question; that a
   * citable handle in a committed file names two rules is not.
   */
  readonly collisions: readonly AdrCollision[];
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
  const decisions = decisionsInForce(travels);
  return {
    decisions,
    // The body is dropped by MAPPING, not by typing: a `ServedSkill` satisfies
    // `SkillRef`, so assigning the list straight across would compile and carry
    // every pattern's whole text along at run time — into a file that is read on
    // every prompt. The same drop, for the same reason, as the opening context's.
    // What it drops the `state` for is narrower: this file carries only what
    // GOVERNS, and `adoptedSkills` answers `adopted` and nothing else, so a state
    // printed here would be one word repeated once per rule.
    skills: adoptedSkills(travels).map(({ id, name }) => ({ id, name })),
    collisions: printedCollisions(travels, decisions),
  };
}

/**
 * The labels this answer PRINTS that are not unique in the chain they came from.
 *
 * Two halves, and each is a decision rather than a detail.
 *
 * PER CACHE, because a cache is one chain and one chain is the unit an `ADR-<n>`
 * is numbered in. Asking the question over the pooled decisions would answer a
 * different one — a workspace holding two projects' committed records holds two
 * `ADR-1`s that were never meant to be compared, and neither of their citations is
 * ambiguous to the person reading either repository.
 *
 * FILTERED TO WHAT IS PRINTED, because this document's whole claim is about the
 * handles IN IT: a bullet says `ADR-7`, a reader cites `ADR-7`, and the warning
 * says when that citation does not land on one rule. A collision between two rules
 * this file does not carry is a fact about the record, which is the audit's answer
 * and not this file's — putting it here would make a governance document warn about
 * governance it does not state. The ids it names are NOT filtered the same way: the
 * other holder of the label is regularly a rule that is no longer in force, and
 * naming only the printed half would describe the ambiguity while hiding what makes
 * it one.
 *
 * The order is total and comes from the content — by label, then by the first id —
 * so the trees' order cannot reach the document's bytes.
 */
function printedCollisions(
  travels: readonly ProjectionCache[],
  decisions: readonly DecisionRef[],
): AdrCollision[] {
  const printed = new Set(decisions.map((decision) => decision.adr));
  return travels
    .flatMap((cache) => cache.adrCollisions())
    .filter((collision) => printed.has(collision.adr))
    .sort((a, b) => compare(a.adr, b.adr) || compare(a.ids[0] ?? '', b.ids[0] ?? ''));
}

/** String order, as a number, so two keys can be tried in sequence. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
