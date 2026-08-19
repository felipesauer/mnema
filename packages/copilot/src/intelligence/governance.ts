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
 * ## It does not charge, and it does not rule
 *
 * Nothing here refuses, escalates or blocks; nothing here decides whether a rule
 * still holds. A rule's STATE travels out with it (`accepted`, `superseded`, an
 * adopted pattern, a rejected one) and the caller decides what to do with it. That
 * is deliberate: deciding "in force" a second time here is a second rule that can
 * come to disagree with `decisionsInForce`, and the disagreement would be silent —
 * one reader would simply obey a different set.
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

import { GOVERNS_RELATION, type LinkEdge, type Scope, type SearchKind } from '@mnema/core';
import { type RecordBody, readRecord } from '../context/search.js';
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
  /** The three numbers. */
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
  const addressed: Addressed[] = [];

  for (const source of sources) {
    if (!governsThisProject(source, query.root)) continue;
    for (const edge of source.cache.linksByRelation(GOVERNS_RELATION)) {
      addressed.push(describe(sources, source, edge, query));
    }
  }

  const stale = addressed.filter((entry) => !entry.rule.onDisk);
  const matching = asked === null ? [] : addressed.filter((entry) => covers(entry, asked));

  return {
    path: query.path,
    ...(asked !== null ? { relative: posix(asked) } : {}),
    rules: ordered(matching),
    stale: ordered(stale),
    counts: { matching: matching.length, governing: addressed.length, stale: stale.length },
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
