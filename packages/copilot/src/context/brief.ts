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
 * IT TAKES THE NAME OF ONE CHANNEL, and that is the only argument here that is not the
 * record. The document explains a silence — nothing arrives when a file is edited — and a
 * silence has two causes now: no rule addresses the path, or the push was switched off. The
 * second is a fact of the chain like any other, but WHICH fact it is depends on what the
 * channel is called, and channels are named by the surface that pushes them
 * (`code/src/record-framing.ts`), three packages downstream of here. So the caller names it
 * and this composition reads its state. Nothing else about the channel is known here, and
 * nothing here decides whether it may speak — that is the channel's own reading, over its
 * own sources ({@link channelIsOn}).
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
 * THAT LAST SENTENCE HAD NO NUMBER AND NOW HAS ONE — **99.1 bytes per rule in force**,
 * the slope of the document this answer composes, over an envelope of about 359 bytes
 * (`measurements/channel-cost/README.md`). It is what makes "no cut by size" affordable
 * rather than merely principled: a record holding a hundred rules in force pays about
 * ten kilobytes, once, where a session opens. The number belongs to the DOCUMENT's shape
 * rather than to this function, and that shape has already moved once — an earlier
 * reading measured 21/63/148 lines where the published one measures 25/68/153 — so it is
 * cited to its capture instead of being pinned by a case here.
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

import {
  type AdrCollision,
  ASKS_FOR_A_PERSON_RELATION,
  GOVERNS_RELATION,
  type ProjectionCache,
  type Scope,
} from '@mnema/core';
import type { ScopedCache } from '../sources.js';
import { type DecisionRef, decisionsInForce } from './decisions.js';
import { adoptedSkills, type SkillRef } from './skills.js';
import { type ChannelState, channelStates } from './switches.js';

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
  /**
   * How many of the rules above have an ADDRESS — a path they were linked to with
   * `rel: "governs"` in a tree that travels.
   *
   * WHY A NUMBER IS IN THIS ANSWER AT ALL, since everything else in it is a list. The
   * product pushes a rule at the moment a file it addresses is about to be written, and
   * that channel is SILENT when no rule addresses the path — a decision taken with a
   * measurement behind it, because the alternative pays for "nothing governs this" on
   * every edit of every session. Silence only means something to a reader who knows the
   * mechanism is there, and this is where they are told: once, when the session opens.
   * Zero is a legitimate value and it is the most informative one — it says the record
   * holds rules and none of them has been placed.
   *
   * IT COUNTS RULES, NOT ADDRESSES. A rule addressed at two paths is one rule with an
   * address; the reader of this document is deciding whether to expect anything, not
   * auditing the graph. The audit's own answer counts addresses and names the stale ones
   * (`mnema rules`, `governing_rules`).
   *
   * WHAT IT DELIBERATELY DOES NOT COUNT is how many of those addresses name a path the
   * working tree no longer holds. That number is a fact about a CHECKOUT, and this
   * document is committed and compared with `diff`: a count that moved when somebody
   * switched branch would make the staleness check report a difference that is not the
   * record's. The two readings that touch a disk report it.
   */
  readonly addressed: number;
  /**
   * How many of the rules below ASK FOR A PERSON somewhere — the number that gives the
   * hardest silence on this surface its meaning.
   *
   * WHY IT IS SEPARATE FROM {@link Brief.addressed} rather than folded into it. That number
   * says how many rules can ARRIVE at an edit; this one says how many can STOP one, and the
   * two are different powers over the reader's afternoon. A document that reported only the
   * first would leave somebody whose write was refused with no way to know from this file
   * that the mechanism exists — and a gate is the one thing in this product a person needs
   * to have been told about BEFORE it happens to them.
   *
   * Zero is a legitimate value and it is the ordinary one: it says the record holds rules,
   * some of them may be placed, and none of them gates anything.
   *
   * It counts RULES and not addresses, and it does not count staleness, for the two reasons
   * {@link Brief.addressed} gives — the reader is deciding what to expect, and this file is
   * committed and compared with `diff`.
   */
  readonly asking: number;
  /**
   * Where the channel that pushes a rule at an EDIT stands, in the tree that travels.
   *
   * WHY IT IS IN THIS ANSWER, and it is the same argument {@link Brief.addressed} makes
   * carried one step further. That number exists to give a SILENCE a meaning: nothing
   * arrives at an edit, and the reader has been told there are addresses, so the silence
   * reads as "none of them names this file". A switched-off push produces the identical
   * silence and means something else entirely — "somebody turned it off" — and a document
   * that reported the count while omitting the switch would explain the silence WRONGLY,
   * which is worse than not explaining it. So the state is here and the document says it.
   *
   * IT IS READ FROM THE TREE THAT TRAVELS, like everything else in this answer, and that
   * is a real limit rather than a detail. A switch recorded `--scope private` governs this
   * machine's pushes and is not in this file — the same omission every private rule has,
   * declared to the reader in the same words — so a document saying the push is on is
   * saying it of the COMMITTED record. The reading that spans every tree is `mnema
   * switch`, and it is the only place a private switch is ever spelled.
   *
   * It stays pure over the record and therefore byte-stable: a switch is a fact of the
   * chain, so two clones of one repository print the same line, and the `diff` that
   * detects a stale copy still means exactly what it meant.
   */
  readonly editPush: ChannelState;
  /**
   * Where the channel that STOPS a write stands, in the tree that travels.
   *
   * It is here for the reason {@link Brief.editPush} is, and the consequence is heavier. A
   * gate that is switched off produces exactly the silence a gate that has nothing to close
   * on produces; but the direction of the mistake is reversed from the other channel's — a
   * reader wrongly told that nothing gates this project loses nothing, while a reader
   * wrongly told that something does will go looking for a refusal that cannot come. Both
   * are fixed by saying which it is.
   *
   * Read from the committed tree, like everything else in this answer, and what that costs
   * is the same: a switch somebody recorded `--scope private` is invisible here, so on that
   * machine the document still says the gate is live. The reading that spans every tree is
   * `mnema switch`, and the document points at it.
   */
  readonly asksAPerson: ChannelState;
}

/**
 * The channels this document reports on, named by the caller.
 *
 * A shape rather than two positional strings, and it is the same rule the vocabulary of
 * channels has had since it existed: the names live with the surface that PUSHES them, so
 * this package takes them and cannot invent one. Two strings in a row would compile with
 * the pair swapped, which would make the document report the gate's state as the push's —
 * one of the few mistakes here that reads as a working document and says the opposite of
 * the truth.
 */
export interface BriefChannels {
  /** The channel that hands over the rules addressed at a file, as it is written. */
  readonly editPush: string;
  /** The channel that stops the write until a person looks. */
  readonly asksAPerson: string;
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
export function brief(sources: readonly ScopedCache[], channels: BriefChannels): Brief {
  const committed = sources.filter((source) => source.scope === TRAVELS);
  const travels: ProjectionCache[] = committed.map((source) => source.cache);
  const decisions = decisionsInForce(travels);
  const skills = adoptedSkills(travels);
  return {
    decisions,
    // The body is dropped by MAPPING, not by typing: a `ServedSkill` satisfies
    // `SkillRef`, so assigning the list straight across would compile and carry
    // every pattern's whole text along at run time — into a file that is read on
    // every prompt. The same drop, for the same reason, as the opening context's.
    // What it drops the `state` for is narrower: this file carries only what
    // GOVERNS, and `adoptedSkills` answers `adopted` and nothing else, so a state
    // printed here would be one word repeated once per rule.
    skills: skills.map(({ id, name }) => ({ id, name })),
    collisions: printedCollisions(travels, decisions),
    addressed: countAddressed(travels, [...decisions, ...skills]),
    // Asked of the COMMITTED sources alone, for the reason the whole answer is: a switch
    // this file could not carry would make the document claim a mechanism is on when the
    // machine reading it has turned it off. The channel is NAMED by the caller because the
    // vocabulary of channels belongs to the surface that pushes them, and this package has
    // no idea what any of them are.
    asking: countAsking(travels, [...decisions, ...skills]),
    // Asked of the COMMITTED sources alone, for the reason the whole answer is: a switch
    // this file could not carry would make the document claim a mechanism is on when the
    // machine reading it has turned it off. Both channels in ONE call, so the fold, the
    // tie-break and the meaning of an absence are the same for the two of them — a document
    // that read one channel one way and the other another way would be two rules about what
    // "off" means, in one paragraph.
    ...channelPair(committed, channels),
  };
}

/**
 * The two channel states this document carries, read in one call.
 *
 * Split out so the pair is built ONCE from one reading rather than assembled by two calls a
 * later edit could make asymmetric. The order of the array is the order of the names, which
 * is what {@link channelStates} promises, so the indexes are the names' and not a guess.
 */
function channelPair(
  committed: readonly ScopedCache[],
  channels: BriefChannels,
): { readonly editPush: ChannelState; readonly asksAPerson: ChannelState } {
  const [editPush, asksAPerson] = channelStates(committed, [
    channels.editPush,
    channels.asksAPerson,
  ]);
  return { editPush: editPush as ChannelState, asksAPerson: asksAPerson as ChannelState };
}

/**
 * How many of `rules` have at least one address asserted in a tree that travels.
 *
 * The links are read from the SAME caches the rules came from, which is what makes the
 * number a fact about this document rather than about the workspace: an address asserted
 * in the private tree is not counted, for the reason nothing private is printed — it does
 * not travel, and a reader of a clone would find a number they cannot account for.
 *
 * It intersects with the rules PRINTED rather than counting `governs` links, and that is
 * the difference that matters: a link whose subject is a superseded decision, or a task,
 * or an id no tree here holds, is a link this document says nothing about. Counting those
 * would tell the reader to expect a rule at an edit that nothing will ever push.
 */
function countAddressed(
  travels: readonly ProjectionCache[],
  rules: readonly { readonly id: string }[],
): number {
  return countUnder(travels, rules, GOVERNS_RELATION);
}

/**
 * How many of `rules` ask for a person somewhere — the same count under the other relation.
 *
 * It is {@link countUnder} asked a second question and not a second counting rule, which is
 * what keeps the two numbers on the document's first paragraph from being computed two ways.
 * Everything the note above says about intersecting with the rules PRINTED holds here for a
 * sharper reason: a gate whose subject is a superseded decision is a gate nothing will ever
 * close, and counting it would tell the reader to expect a refusal that cannot come.
 */
function countAsking(
  travels: readonly ProjectionCache[],
  rules: readonly { readonly id: string }[],
): number {
  return countUnder(travels, rules, ASKS_FOR_A_PERSON_RELATION);
}

/** How many of `rules` are the subject of a link under `relation`, in the trees that travel. */
function countUnder(
  travels: readonly ProjectionCache[],
  rules: readonly { readonly id: string }[],
  relation: string,
): number {
  const subjects = new Set<string>();
  for (const cache of travels) {
    for (const edge of cache.linksByRelation(relation)) subjects.add(edge.subject);
  }
  return rules.filter((rule) => subjects.has(rule.id)).length;
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
