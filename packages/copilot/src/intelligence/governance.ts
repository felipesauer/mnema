/**
 * governance: which rules of the record address this path, and which address
 * nothing at all.
 *
 * The record already holds rules — a decision that was accepted, a pattern that
 * was adopted — and until now nothing tied one of them to a place in the code.
 * A link under {@link GOVERNS_RELATION} does: its subject is the rule, its target
 * is a path, and this reads that graph BACKWARDS — given a path, which rules
 * cover it.
 *
 * ## TWO relations, ONE derivation
 *
 * {@link ASKS_FOR_A_PERSON_RELATION} has the same shape and a different power: it says
 * that under this part of the tree, nobody writes without somebody looking. Everything
 * about how an address is normalized, compared, ordered and counted is identical, so it
 * is the same walk with a different label — {@link addressesUnder} — and never a second
 * reading of the same rule. Two readings of an address is how the segment comparison
 * would come to mean one thing for the text that informs and another for the gate that
 * stops somebody, and the second would be found by whoever it trapped.
 *
 * ## It does not charge, and it does not rule
 *
 * Nothing here refuses, escalates or blocks. A rule's STATE travels out with it
 * (`accepted`, `superseded`, an adopted pattern, a rejected one) and the caller decides
 * what to do with it. That is deliberate: deciding "in force" a second time here is a
 * second rule that can come to disagree with `decisionsInForce`, and the disagreement
 * would be silent — one reader would simply obey a different set.
 *
 * "NOTHING HERE DECIDES WHETHER A RULE STILL HOLDS" was the first half of that sentence
 * and it is no longer true of the module, only of {@link governingRules}. There are two
 * readings in this file now, and the second one — {@link rulesInForceAt} — narrows to
 * what is in force, because it answers a channel that PUSHES rather than a caller that
 * asked. The rule the sentence protected is intact and is what makes the second reading
 * safe: it does not decide "in force" itself either, it asks the two derivations that
 * already do.
 *
 * ## An address is a PREFIX, by segments — never a glob
 *
 * `src/collate` governs `src/collate` and everything under `src/collate/`. It does
 * NOT govern `src/collate_test.rb`, and that is the whole reason the comparison is
 * over path SEGMENTS rather than over characters: a string prefix would hand a rule
 * a file nobody addressed, and it would do it silently. Held by
 * `governance.test.ts` ("does NOT govern a sibling whose name merely starts the
 * same"), and the mutation that turns the comparison back into a string prefix
 * lights it and its end-to-end twin — two red, nothing else.
 *
 * A glob was refused, with the reason written down: a glob is a second language
 * with its own semantics, and a glob with a typo governs NOTHING, in silence —
 * exactly the class of defect this reading exists to make visible. A prefix either
 * matches or it does not, and its absence is countable (see the third number). The
 * diffuse reach a glob would buy belongs to SEARCH, where being wrong costs one
 * extra paragraph of context rather than the work.
 *
 * ## Three numbers, always, including when all three are zero
 *
 * An answer that only listed the matching rules could not be told from an answer
 * where the whole mechanism is empty, and neither could be told from one where the
 * rules exist and their addresses have gone stale. A rule whose address named a
 * file that was since moved, renamed or deleted stops governing SILENTLY — and a
 * charge that never fires is indistinguishable from a charge that had nothing to
 * fire about. So every answer carries {@link GovernanceCounts}: how many rules
 * cover this path, how many address this project at all, and how many address
 * something the working tree does not hold. The third is not decoration; without it
 * the reading is not finished — measured: emptying the stale list turns TEN cases
 * red, across both surfaces and the golden.
 *
 * ## What it normalizes, and what it deliberately does not
 *
 * Both the path asked about and every address are reduced to POSIX segments
 * relative to the project root: `.` segments dropped, `..` resolved textually, a
 * trailing slash dropped, an absolute path made relative when it lies under the
 * root. Everything else is left alone, and the consequences are the answer's, not a
 * hidden fix:
 *   - a SYMLINK is not resolved. Two names for one file are two addresses here, and
 *     a rule addressed at one is not found through the other. Resolving would mean
 *     touching the disk per segment, and this bench has already been bitten by
 *     treating a textual resolution as a real one. The DISK PROBE does follow one,
 *     because it is `existsSync` and that is what existing means — so an address at a
 *     live link is held and one at a dangling link is stale. Both halves are fixed by
 *     `code/tests/the-rule-has-an-address.test.ts` ("does not resolve a symlink" and
 *     "asks the working tree through the link");
 *   - a path outside the project has no address at all, so nothing matches it. The
 *     answer says so by carrying no {@link GoverningRules.relative}, rather than by
 *     coming back empty and looking like "nothing governs this";
 *   - a backslash is a legal character in a POSIX name, so it is never read as a
 *     separator. An address written on a system that separates with one addresses
 *     a file whose name contains it, and matches nothing.
 *
 * ## Which trees it reads, and why not all of them
 *
 * An address is relative to A ROOT, and the root is the asking project's. So the
 * sources are narrowed to that project's own trees: a rule written in ANOTHER
 * project's record addresses that project's `src/`, and importing it here would
 * make it govern code nobody addressed — the same defect the segment comparison
 * exists to prevent, one level up. The machine-global tree is left out for the same
 * reason: it belongs to no project, so a path in it is relative to nothing.
 *
 * A rule in the project's PRIVATE tree is read and reported, with its scope, and
 * nothing here refuses it. It is worth saying what that means, since the reading is
 * what a charge will later cite: a private rule is invisible to a clone, so a charge
 * citing one cites something a teammate cannot open. That is a product decision and
 * it is not taken here — the reading reports the tree, so whoever charges can.
 */

import {
  ASKS_FOR_A_PERSON_RELATION,
  GOVERNS_RELATION,
  type LinkEdge,
  type Scope,
  type SearchKind,
} from '@mnema/core';
import { decisionsInForce } from '../context/decisions.js';
import { type RecordBody, readRecord } from '../context/search.js';
import { adoptedSkills } from '../context/skills.js';
import type { ScopedCache } from '../sources.js';

/** What to ask: a path, the project it is in, and how to test the working tree. */
export interface GovernanceQuery {
  /** The path to ask about, as the caller writes it — relative or absolute. */
  readonly path: string;
  /**
   * The project's root directory — the parent of its `.mnema/`, absolute. Every
   * address is relative to this, and it is what tells a source of THIS project
   * from a source of a sibling one.
   */
  readonly root: string;
  /**
   * Does the working tree hold anything at this project-relative path? Injected
   * rather than done here, so the derivation stays pure over the record and the
   * one place that touches a disk is the surface that owns one.
   *
   * A prefix address matches something exactly when the path it names exists, so
   * one test per address answers the third count.
   */
  readonly onDisk: (relative: string) => boolean;
}

/** One rule of the record and the address it was given. */
export interface AddressedRule {
  /** The rule's id — the subject of the link, and what a charge would cite. */
  readonly rule: string;
  /** The address as the record holds it, verbatim. */
  readonly recorded: string;
  /**
   * The address as it was compared: POSIX segments joined by `/`, relative to the
   * root, the project root itself being the empty string. Absent when the recorded
   * address lies outside the project and therefore addresses nothing here.
   */
  readonly address?: string;
  /**
   * How specific the address is — how many segments it names. The ordering key:
   * the longest address wins, because the most specific rule is the one that
   * speaks to this file. Absent exactly when {@link address} is.
   */
  readonly segments?: number;
  /** True when the working tree holds the address. False is the stale case. */
  readonly onDisk: boolean;
  /** What kind of record the rule is, when a tree of this project holds it. */
  readonly kind?: SearchKind;
  /** The rule's short name, when its kind has one (a memory has none). */
  readonly name?: string;
  /** Its state, when its kind has one — never interpreted here. */
  readonly state?: string;
  /** The tree that holds the rule itself, absent when no tree here holds it. */
  readonly scope?: Scope;
  /** The tree whose record ASSERTS the address, which may not be the rule's own. */
  readonly assertedIn: Scope;
  /** The identity that authorized the assertion. */
  readonly who: string;
  /** ISO-8601 instant of the assertion. */
  readonly at: string;
}

/**
 * The three numbers, present on every answer including when all three are zero.
 *
 * They are counts over RULES, never over links: the same rule addressed at two
 * paths is two addresses and two entries, because each address matches or goes
 * stale on its own.
 */
export interface GovernanceCounts {
  /** How many addresses cover the path asked about. */
  readonly matching: number;
  /** How many addresses this project's record holds at all. */
  readonly governing: number;
  /** How many of those name something the working tree does not hold. */
  readonly stale: number;
  /**
   * The same three numbers for the relation that ASKS FOR A PERSON — the gate rather
   * than the text.
   *
   * They are here, and they are three rather than one, because the gate has exactly the
   * three worlds the governing addresses do and they are worse to confuse: a path where
   * no gate applies, a project whose record holds no gate at all, and a gate whose
   * address went stale when a directory was renamed and now stops nobody. The last is
   * the dangerous one — a gate that quietly stopped closing is indistinguishable from a
   * gate that never had anything to close on — and only a number that names it separately
   * can be looked at.
   */
  readonly asks: AddressCounts;
}

/** The three numbers of ONE relation's addresses around a path. */
export interface AddressCounts {
  /** How many of that relation's addresses cover the path asked about. */
  readonly matching: number;
  /** How many that relation holds in this project's record at all. */
  readonly addressed: number;
  /** How many of those name something the working tree does not hold. */
  readonly stale: number;
}

/** Which rules govern a path, and what the record's addresses look like around it. */
export interface GoverningRules {
  /** The path as the caller wrote it. */
  readonly path: string;
  /**
   * The path as it was compared: POSIX, relative to the root (`.` for the root
   * itself). ABSENT when the path
   * lies outside the project — which is why an empty list there does not read as
   * "nothing governs this file".
   */
  readonly relative?: string;
  /**
   * The addresses covering the path, MOST SPECIFIC FIRST — most segments, then the
   * address itself, then the rule's id, so the order is total and comes from the
   * data rather than from the order trees were read in.
   */
  readonly rules: readonly AddressedRule[];
  /**
   * The addresses that match nothing in the working tree — named, not merely
   * counted, because a count of stale rules is fixed by making the count smaller
   * and a list is fixed by looking at what it names. Same order rule as
   * {@link rules}.
   */
  readonly stale: readonly AddressedRule[];
  /**
   * The addresses that ASK FOR A PERSON around this path — the gate, reported beside
   * the text rather than instead of it.
   *
   * It is named as well as counted, for the reason the stale list is: a person who
   * cannot see WHICH fact gates a directory cannot remove it, supersede it or argue
   * with it, and the one thing worse than a gate is a gate whose cause nobody can find.
   * Whatever state its rule is in travels with it exactly as it does above — this
   * reading judges neither, and only the charge narrows to what is in force.
   */
  readonly asks: readonly AddressedRule[];
  /** The gate addresses that match nothing in the working tree. Same order rule. */
  readonly asksStale: readonly AddressedRule[];
  /** The three numbers, and the other relation's three. */
  readonly counts: GovernanceCounts;
}

/**
 * Reads which rules of `root`'s record govern `query.path`.
 *
 * Every `governs` link of this project's trees is read once, each address reduced
 * to segments and tested against the working tree once, and the ones covering the
 * asked path are ordered by specificity. The counts are computed over the same
 * single pass, so the list and the numbers cannot disagree.
 */
export function governingRules(
  sources: readonly ScopedCache[],
  query: GovernanceQuery,
): GoverningRules {
  const asked = relativeSegments(query.path, query.root);
  const governs = addressesUnder(sources, query, GOVERNS_RELATION, asked);
  const asks = addressesUnder(sources, query, ASKS_FOR_A_PERSON_RELATION, asked);

  return {
    path: query.path,
    ...(asked !== null ? { relative: posix(asked) } : {}),
    rules: ordered(governs.matching),
    stale: ordered(governs.stale),
    asks: ordered(asks.matching),
    asksStale: ordered(asks.stale),
    counts: {
      matching: governs.matching.length,
      governing: governs.all.length,
      stale: governs.stale.length,
      asks: {
        matching: asks.matching.length,
        addressed: asks.all.length,
        stale: asks.stale.length,
      },
    },
  };
}

/**
 * Every address of ONE relation in this project's trees, split into what covers the
 * asked path and what covers nothing on disk — the whole walk, done once per relation.
 *
 * It exists so the two relations cannot come to disagree about what an address MEANS.
 * Normalizing, the segment comparison, the disk probe and the counting are here and
 * nowhere else, so a change to any of them lands on the text that informs and on the
 * gate that stops somebody in the same edit. `all` travels out beside the two lists
 * because the middle number counts the addresses this project holds at all, and
 * recomputing it from the lists would be a second arithmetic that could differ.
 */
function addressesUnder(
  sources: readonly ScopedCache[],
  query: GovernanceQuery,
  relation: string,
  asked: readonly string[] | null,
): {
  readonly all: readonly Addressed[];
  readonly matching: readonly Addressed[];
  readonly stale: readonly Addressed[];
} {
  const all: Addressed[] = [];
  for (const source of sources) {
    if (!governsThisProject(source, query.root)) continue;
    for (const edge of source.cache.linksByRelation(relation)) {
      all.push(describe(sources, source, edge, query));
    }
  }
  return {
    all,
    matching: asked === null ? [] : all.filter((entry) => covers(entry, asked)),
    stale: all.filter((entry) => !entry.rule.onDisk),
  };
}

/**
 * One addressed rule and the segments it was compared by — the segments kept
 * beside the answer rather than inside it, so the comparison is done once and the
 * reply carries a path a reader can read.
 */
interface Addressed {
  readonly rule: AddressedRule;
  /** The address as segments, or null when it addresses nothing in this project. */
  readonly segments: readonly string[] | null;
}

/** The rules of a list, most specific first. */
function ordered(entries: readonly Addressed[]): AddressedRule[] {
  return [...entries].sort(bySpecificity).map((entry) => entry.rule);
}

/**
 * Whether a source's record can address paths under `root`.
 *
 * A tree that names its project answers for that project alone; the machine-global
 * tree names no project and belongs to none, so it is never a source of addresses.
 * A tree that names NO project and is not global is the command line's shape — it
 * resolves one project's trees and labels neither — so it is taken as this
 * project's, which is exactly what it is.
 */
function governsThisProject(source: ScopedCache, root: string): boolean {
  if (source.scope === 'global') return false;
  return source.project === undefined || source.project === root;
}

/** One `governs` edge, with everything the record knows about its ends. */
function describe(
  sources: readonly ScopedCache[],
  asserted: ScopedCache,
  edge: LinkEdge,
  query: GovernanceQuery,
): Addressed {
  const segments = relativeSegments(edge.target, query.root);
  const record = readRecord(sources, edge.subject);
  const placed = segments === null ? {} : { address: posix(segments), segments: segments.length };
  return {
    segments,
    rule: {
      rule: edge.subject,
      recorded: edge.target,
      ...placed,
      // An address that resolves nowhere in this project holds nothing by
      // definition; one that resolves is asked of the working tree.
      onDisk: segments !== null && query.onDisk(posix(segments)),
      ...(record !== null ? { kind: record.kind, scope: record.scope } : {}),
      ...nameAndState(record),
      assertedIn: asserted.scope,
      who: edge.who,
      at: edge.linkedAt,
    },
  };
}

/**
 * The rule's short name and its state, when its kind has them.
 *
 * Total over the record kinds, so a kind added to the union stops compiling here
 * rather than silently losing its name. A MEMORY has neither, and gets neither:
 * the index elsewhere stands an excerpt of the content in for a title, and
 * excerpting a second time here would be a second rule about how long an excerpt
 * is. The id travels either way, and a body is one `read_record` away.
 */
function nameAndState(record: RecordBody | null): { name?: string; state?: string } {
  if (record === null) return {};
  switch (record.kind) {
    case 'decision':
      return { name: record.record.title, state: record.record.state };
    case 'task':
      return { name: record.record.title, state: record.record.state };
    case 'skill':
      return { name: record.record.name, state: record.record.state };
    case 'observation':
      return { name: record.record.topic };
    case 'memory':
      return {};
  }
}

/**
 * Whether an address covers a path — a prefix over SEGMENTS.
 *
 * The empty address (the project root) covers everything, which is the honest
 * reading of a rule someone addressed at the whole repository. An address with more
 * segments than the path covers nothing, and one whose segments differ at any
 * position covers nothing: `src/collate` and `src/collate_test.rb` differ at the
 * second segment, which is the whole point.
 */
function covers(entry: Addressed, path: readonly string[]): boolean {
  const wanted = entry.segments;
  if (wanted === null) return false;
  if (wanted.length > path.length) return false;
  return wanted.every((segment, index) => path[index] === segment);
}

/** Most segments first, then the address, then the rule — a total order from the data. */
function bySpecificity(a: Addressed, b: Addressed): number {
  const depth = (b.segments?.length ?? -1) - (a.segments?.length ?? -1);
  if (depth !== 0) return depth;
  const address = compare(a.rule.address ?? a.rule.recorded, b.rule.address ?? b.rule.recorded);
  return address !== 0 ? address : compare(a.rule.rule, b.rule.rule);
}

/**
 * Segments as ONE readable path: the POSIX spelling, with the project root written
 * `.` rather than as the empty string it is in segments. A column of a report and a
 * probe of the working tree both take this, so "the root" is one spelling and not
 * two — and `.` is what a person would have typed to mean it.
 */
function posix(segments: readonly string[]): string {
  return segments.length === 0 ? '.' : segments.join('/');
}

/**
 * A path reduced to the segments it names, relative to `root`, or null when it
 * names something outside the project.
 *
 * Textual and deliberate about it: `.` segments drop, `..` pops the previous one, a
 * trailing slash is nothing, and repeated slashes are one — and the climbing is
 * resolved BEFORE the root is compared, so `/repo/../repo/src` is `src` rather than
 * a miss. An absolute path is made relative when it lies under the root and is null
 * otherwise; a relative path that climbs past its own start is null for the same
 * reason. No symlink is resolved and no disk is touched — see the module note on
 * what that costs.
 */
function relativeSegments(path: string, root: string): string[] | null {
  const parts = normalized(path);
  if (parts === null) return null;
  if (!path.startsWith('/')) return parts;
  const base = normalized(root) ?? [];
  if (parts.length < base.length) return null;
  if (!base.every((part, index) => parts[index] === part)) return null;
  return parts.slice(base.length);
}

/**
 * The segments a path names, with `.` dropped and `..` resolved textually, or null
 * when the climbing goes above the first segment — which for an absolute path is
 * above the filesystem root and for a relative one is out of the project.
 */
function normalized(path: string): string[] | null {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * One rule that governs a path and still holds — the shape a channel that PUSHES
 * carries, which is narrower than what {@link GoverningRules} reports on request.
 *
 * Every field is present, and that is the difference. {@link AddressedRule} leaves the
 * name, the kind and the state optional because it answers about an address whatever
 * the record holds at the other end of it — including nothing. This shape is built
 * from the two derivations that decide what is IN FORCE, so a rule that reached it has
 * a projection some tree holds, and the name came out of that projection rather than
 * out of a second lookup that could have missed.
 */
export interface PushedRule {
  /** The rule's id — what a charge would cite, and what {@link readRecord} takes. */
  readonly id: string;
  /** What the rule says: a decision's title, a pattern's name. */
  readonly name: string;
  /** The address it was matched by, as it was compared or as the record wrote it. */
  readonly address: string;
  /**
   * Whether the tree that holds the rule TRAVELS — whether a clone of the repository
   * gets it.
   *
   * False is the case that has to be visible: a rule recorded `--scope private` or in
   * the machine's global tree governs the work here and its id resolves nowhere else,
   * so a reader that cited it would be citing something a teammate cannot open. It is
   * false whenever the tree is not the committed one AND whenever no tree here holds
   * the rule at all — unsure and not-travelling get the same answer, which is the
   * direction that cannot mislead.
   */
  readonly travels: boolean;
}

/** The rules in force addressed at a path, and the path they were matched against. */
export interface RulesAtPath {
  /** The path as the caller wrote it. */
  readonly path: string;
  /**
   * The path as it was compared: POSIX, relative to the project root. Absent when the
   * path lies outside the project — in which case {@link rules} is empty, because
   * nothing in this project addresses it.
   */
  readonly relative?: string;
  /** The rules, most specific first — {@link governingRules}' own order, kept. */
  readonly rules: readonly PushedRule[];
}

/**
 * The rules of `sources` that govern `query.path` AND are still in force.
 *
 * ## Why this exists beside {@link governingRules} instead of being a flag on it
 *
 * The reading that answers a CALLER reports every address it found with each rule's
 * state beside it, and judges none of them — a caller that asked can read a `superseded`
 * and decide. A channel that PUSHES has no such reader: the text arrives unasked, in the
 * middle of somebody's work, and a superseded decision arriving that way is this product
 * asserting that a rule governs when the record says it stopped. So the push carries what
 * is in force and nothing else, and the two answers are two functions rather than one
 * function with a mode, because the difference is not a filter — it is which of the two
 * has the right to decide.
 *
 * ## It does not decide "in force" a second time
 *
 * The set comes from {@link decisionsInForce} and {@link adoptedSkills}, which are the
 * product's only readings of it: supersession is a graph fact and `accepted` is a state,
 * and a second rule here — "state is not superseded", say — is exactly the silent
 * divergence `governance.ts` already refuses to open. The NAME comes out of the same two
 * answers for the same reason: reading it from a second lookup could hand back a title
 * for a rule those two never listed.
 *
 * A consequence worth naming: nothing else can be in force. A task, a memory or an
 * observation given a `governs` link is not a rule, so it is addressed and never pushed —
 * `governing_rules` reports it, with its kind, to whoever asks.
 *
 * ## The three numbers are NOT here, and that is deliberate
 *
 * A count that disagreed with the list would be worse than no count, and it would: the
 * `matching` of an asked reading counts the addresses covering the path whatever their
 * state, so it is larger than this list whenever a superseded rule addresses the file. The
 * numbers belong to the reading that reports all of them, and to the once-per-session
 * document — never to a text pushed on every edit, where they would be paid for again and
 * again to say the same thing.
 */
export function rulesInForceAt(
  sources: readonly ScopedCache[],
  query: GovernanceQuery,
): RulesAtPath {
  return inForceUnder(sources, query, GOVERNS_RELATION);
}

/**
 * The rules of `sources` that ASK FOR A PERSON at `query.path` AND are still in force —
 * the reading a CHARGE stands on, and the only one in this file whose answer can stop
 * somebody's work.
 *
 * ## Why it is in force and never merely addressed
 *
 * It is the same narrowing {@link rulesInForceAt} does and the argument is one step
 * harder here. A superseded decision arriving as pushed text is the product asserting a
 * rule the record says stopped; a superseded decision GATING a file is the product
 * stopping work on the authority of something the team retired, and the person it stops
 * has no way to see that from the refusal. So the set comes from the two derivations that
 * decide what is in force, and nothing here decides it a second time.
 *
 * ## What an empty answer means, and it is one thing only
 *
 * No gate applies. It does not mean the mechanism is missing and it does not mean the
 * channel is off — those are the caller's to distinguish, and both are answered where a
 * session opens. The three numbers that separate them belong to {@link governingRules},
 * which reports all of them to whoever asks, and never to a text paid for on every edit.
 */
export function asksForAPersonAt(
  sources: readonly ScopedCache[],
  query: GovernanceQuery,
): RulesAtPath {
  return inForceUnder(sources, query, ASKS_FOR_A_PERSON_RELATION);
}

/**
 * The in-force rules addressed at a path under ONE relation — the single site both
 * readings above route through.
 *
 * TWO ENTRY POINTS AND ONE BODY, deliberately, and the relation is not a parameter of
 * either of them. What a caller chooses is the QUESTION ("which rules govern this" or
 * "which rules gate this"), never the label, because a label a caller passes is a label a
 * caller can invent — and the reading behind a charge must not answer for a relation
 * nobody defined. `the-record-asks-for-a-person.test.ts` holds that both entry points
 * come through here, so a third question cannot be answered by a third copy of this.
 */
function inForceUnder(
  sources: readonly ScopedCache[],
  query: GovernanceQuery,
  relation: string,
): RulesAtPath {
  const asked = relativeSegments(query.path, query.root);
  const found = addressesUnder(sources, query, relation, asked);
  const caches = sources.map((source) => source.cache);
  const inForce = new Map<string, string>();
  for (const decision of decisionsInForce(caches)) inForce.set(decision.id, decision.title);
  for (const skill of adoptedSkills(caches)) inForce.set(skill.id, skill.name);
  return {
    path: query.path,
    ...(asked !== null ? { relative: posix(asked) } : {}),
    rules: ordered(found.matching).flatMap((rule) => {
      const name = inForce.get(rule.rule);
      if (name === undefined) return [];
      return [
        {
          id: rule.rule,
          name,
          // The compared form when the address resolved into this project, and the
          // record's own spelling otherwise. A matching rule always has the first —
          // `covers` compares its segments — so the fallback is a type narrowing and
          // not a case, and it prints something true either way.
          address: rule.address ?? rule.recorded,
          travels: rule.scope === TRAVELS_TO_A_CLONE,
        },
      ];
    }),
  };
}

/**
 * The one tree whose rules a clone of the repository gets — the same scope
 * `context/brief.ts` composes its document out of, named here because
 * {@link PushedRule.travels} is a claim about that and not about a preference.
 */
const TRAVELS_TO_A_CLONE: Scope = 'public';
