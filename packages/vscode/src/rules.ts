/**
 * The rules in force over one file, read from `mnema rules <path> --json`.
 *
 * Which rules address a path is the CLI's answer. What is kept of it is only the decisions in
 * force — asked of `decisionDisposition`, never restated here — and nothing about paths is
 * decided in this module.
 */

import { decisionDisposition } from '@mnema/context';
import { isDecisionState } from '@mnema/core';

/** What a rule does to the file it addresses. */
export type Relation = 'governs' | 'asks-for-a-person' | 'refuses-a-write';

/** One decision in force that addresses a file. */
export interface RuleView {
  readonly id: string;
  readonly name: string;
  readonly relation: Relation;
  /** Who accepted it, as the record says, when it says. */
  readonly acceptedBy: string | undefined;
  /** True when the record says nobody but the one who proposed it has looked. */
  readonly unconfirmed: boolean;
}

const LISTS: readonly (readonly [string, Relation])[] = [
  ['rules', 'governs'],
  ['asks', 'asks-for-a-person'],
  ['refuses', 'refuses-a-write'],
];

/** The decisions in force in the answer of `mnema rules --json`; nothing when it is not that answer. */
export function readRules(stdout: string): RuleView[] {
  let answer: unknown;
  try {
    answer = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) return [];
  const views: RuleView[] = [];
  for (const [field, relation] of LISTS) {
    const list = (answer as Record<string, unknown>)[field];
    if (!Array.isArray(list)) continue;
    for (const item of list as unknown[]) {
      if (typeof item !== 'object' || item === null) continue;
      const { rule, name, kind, state, acceptance } = item as Record<string, unknown>;
      if (typeof rule !== 'string' || kind !== 'decision') continue;
      if (
        typeof state !== 'string' ||
        !isDecisionState(state) ||
        decisionDisposition(state) !== 'in-force'
      )
        continue;
      const accepted =
        typeof acceptance === 'object' && acceptance !== null
          ? (acceptance as Record<string, unknown>)
          : {};
      views.push({
        id: rule,
        name: typeof name === 'string' ? name : rule,
        relation,
        acceptedBy: typeof accepted.by === 'string' ? accepted.by : undefined,
        unconfirmed: accepted.unconfirmed === true,
      });
    }
  }
  return views;
}

const PHRASE: Record<Relation, string> = {
  governs: 'governs',
  'asks-for-a-person': 'asks for a person',
  'refuses-a-write': 'refuses a write',
};

/** The line above a file: how many rules in force address it, by what they do. */
export function lensTitle(rules: readonly RuleView[]): string | undefined {
  if (rules.length === 0) return undefined;
  const parts = LISTS.flatMap(([, relation]) => {
    const n = rules.filter((r) => r.relation === relation).length;
    return n === 0 ? [] : [`${n} ${PHRASE[relation]}`];
  });
  return `mnema: ${parts.join(', ')}`;
}

/** One rule as a line a person can pick: its name, what it does, and who accepted it. */
export function ruleLabel(rule: RuleView): { label: string; description: string } {
  const who =
    rule.acceptedBy === undefined
      ? 'acceptance not shown'
      : `accepted by ${rule.acceptedBy}${rule.unconfirmed ? ' (nobody else has looked)' : ''}`;
  return { label: rule.name, description: `${PHRASE[rule.relation]} · ${who}` };
}
