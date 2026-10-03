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

/** A changed file and the rules in force that address it, by what the rule does. */
export interface GovernedFile {
  readonly path: string;
  readonly governs: readonly RuleHit[];
  readonly asks: readonly RuleHit[];
  readonly refuses: readonly RuleHit[];
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
  };
}

function inForce(list: unknown): RuleHit[] {
  if (!Array.isArray(list)) return [];
  const hits: RuleHit[] = [];
  for (const item of list as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { rule, name, kind, state } = item as Record<string, unknown>;
    if (typeof rule !== 'string' || kind !== 'decision') continue;
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

/** Whether a file is addressed by anything in force at all. */
export const isGoverned = (file: GovernedFile): boolean =>
  file.governs.length + file.asks.length + file.refuses.length > 0;

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

/** The files in the pull request that an accepted `asks-for-a-person` rule addresses. */
export const askingForAPerson = (files: readonly GovernedFile[]): GovernedFile[] =>
  files.filter((file) => file.asks.length > 0);
