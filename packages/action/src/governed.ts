/**
 * Which changed files a rule in force addresses, and whether a person has answered the ones that
 * ask for one.
 *
 * The addressing itself is `mnema rules <path> --json`; this module reads that answer and decides
 * nothing about paths. "In force" is what the record's own classification says of the rule's
 * state, asked of `decisionDisposition` and never restated here: a decision that is not in force
 * is on the table or off it, and governs nothing.
 */

import { decisionDisposition } from '@mnema/context';
import { isDecisionState } from '@mnema/core';

/** One rule that addresses a file. */
export interface RuleHit {
  readonly id: string;
  readonly name: string | undefined;
}

/** A rule that addresses a file and is NOT in force: an accept and a retirement of it crossed. */
export interface ApartRule extends RuleHit {
  /** The record's own line: which moves crossed, and the way out. */
  readonly divergence: string;
}

/** A tail of another record the reading left out, and the record it names. */
export interface LeftOutTail {
  readonly tail: string;
  readonly record: string;
}

/** A changed file and the rules in force that address it, by what the rule does. */
export interface GovernedFile {
  readonly path: string;
  /** Set when the file is one end of a rename: says which end it is and where the other is. */
  readonly rename?: string;
  readonly governs: readonly RuleHit[];
  readonly asks: readonly RuleHit[];
  readonly refuses: readonly RuleHit[];
  /** The rules that address it and are out of force for a divergence, each with why. */
  readonly apart: readonly ApartRule[];
  /**
   * The tails of another record the reading left out (`anotherRecord` in `mnema rules --json`):
   * nothing they hold is above, whatever it addresses. Empty for a record of one name.
   */
  readonly anotherRecord: readonly LeftOutTail[];
}

/** The reading of `mnema rules --json` for one file, with only the rules in force kept. */
export function rulesInForce(path: string, reading: unknown): GovernedFile {
  const answer = (typeof reading === 'object' && reading !== null ? reading : {}) as Record<
    string,
    unknown
  >;
  return {
    path,
    governs: inForce(answer.rules),
    asks: inForce(answer.asks),
    refuses: inForce(answer.refuses),
    apart: apartFrom([answer.rules, answer.asks, answer.refuses].flat()),
    anotherRecord: leftOutFrom(answer.anotherRecord),
  };
}

function leftOutFrom(list: unknown): LeftOutTail[] {
  if (!Array.isArray(list)) return [];
  return (list as unknown[]).flatMap((item): LeftOutTail[] => {
    if (typeof item !== 'object' || item === null) return [];
    const { tail, record } = item as Record<string, unknown>;
    return typeof tail === 'string' && typeof record === 'string' ? [{ tail, record }] : [];
  });
}

/** Every tail of another record the readings of `files` left out, once each. */
export function leftOutOf(files: readonly GovernedFile[]): LeftOutTail[] {
  const seen = new Map<string, LeftOutTail>();
  for (const file of files) for (const left of file.anotherRecord) seen.set(left.tail, left);
  return [...seen.values()];
}

function apartFrom(list: unknown): ApartRule[] {
  if (!Array.isArray(list)) return [];
  const found = new Map<string, ApartRule>();
  for (const item of list as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { rule, name, kind, divergence } = item as Record<string, unknown>;
    if (typeof rule !== 'string' || kind !== 'decision' || typeof divergence !== 'string') {
      continue;
    }
    found.set(rule, { id: rule, name: typeof name === 'string' ? name : undefined, divergence });
  }
  return [...found.values()];
}

function inForce(list: unknown): RuleHit[] {
  if (!Array.isArray(list)) return [];
  const hits: RuleHit[] = [];
  for (const item of list as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { rule, name, kind, state, divergence } = item as Record<string, unknown>;
    if (typeof rule !== 'string' || kind !== 'decision') continue;
    // An accept and a retirement of the decision crossed: the fold says `accepted` and nothing
    // governs (ADR-121). The reading says so in `divergence`, and the state alone would not.
    if (typeof divergence === 'string') continue;
    if (
      typeof state !== 'string' ||
      !isDecisionState(state) ||
      decisionDisposition(state) !== 'in-force'
    )
      continue;
    hits.push({ id: rule, name: typeof name === 'string' ? name : undefined });
  }
  return hits;
}

/**
 * One file's rules from two readings of the record: every rule either reading has in force, once.
 * A pull request can add a rule, and it can supersede one; only the first may change what judges
 * it, so the reading at its base is never dropped for the one at its head.
 */
export function bothReadings(a: GovernedFile, b: GovernedFile): GovernedFile {
  const once = (x: readonly RuleHit[], y: readonly RuleHit[]): RuleHit[] => [
    ...x,
    ...y.filter((hit) => !x.some((seen) => seen.id === hit.id)),
  ];
  return {
    ...a,
    governs: once(a.governs, b.governs),
    asks: once(a.asks, b.asks),
    refuses: once(a.refuses, b.refuses),
    apart: [...a.apart, ...b.apart.filter((hit) => !a.apart.some((seen) => seen.id === hit.id))],
    anotherRecord: leftOutOf([a, b]),
  };
}

/** Whether a file is addressed by anything in force at all. */
export const isGoverned = (file: GovernedFile): boolean =>
  file.governs.length + file.asks.length + file.refuses.length + file.apart.length > 0;

/** One review of a pull request, as the API reports it. */
export interface Review {
  readonly user: string;
  readonly state: string;
}

/** The states that decide where a reviewer stands; a plain comment moves nobody. */
const DECIDING = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

/**
 * Whether somebody other than the author stands approved: each reviewer counts by their latest
 * deciding review, in the order given (oldest first, which is how the API lists them). It is the
 * pull request's approvals as they stand, not tied to the commit they were given on.
 */
export function approvedByAnotherPerson(reviews: readonly Review[], author: string): boolean {
  const standing = new Map<string, string>();
  for (const review of reviews) {
    if (review.user === author || !DECIDING.has(review.state)) continue;
    standing.set(review.user, review.state);
  }
  return [...standing.values()].some((state) => state === 'APPROVED');
}

/**
 * The files in the pull request that an accepted `asks-for-a-person` or `refuses-a-write` rule
 * addresses: both wait for a person other than the author before the pull request passes.
 */
export const needingAPerson = (files: readonly GovernedFile[]): GovernedFile[] =>
  files.filter((file) => file.asks.length > 0 || file.refuses.length > 0);
