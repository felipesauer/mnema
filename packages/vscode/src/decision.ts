/**
 * One decision opened whole, as a read-only document: the text of `mnema show <id> --json`.
 *
 * The document is the command line's answer laid out for reading, at the moment it was read, and
 * nothing the answer did not carry. Which decision it is, is the `id` in the address: an `ADR-n`
 * number can be carried by two decisions, so it only names the tab.
 */

import { decisionDisposition } from '@mnema/context';
import { isDecisionState } from '@mnema/core';

/** The scheme of the documents this extension serves. */
export const DECISION_SCHEME = 'mnema-decision';

/** Whether a state is one a person still has to judge: asked of the record's own classification, never restated. */
export const awaitsJudgment = (state: string | undefined): boolean =>
  state !== undefined &&
  isDecisionState(state) &&
  decisionDisposition(state) === 'awaiting-judgement';

/** The command that reads one decision whole. */
export const showArgs = (id: string): string[] => ['show', id, '--json'];

/** The name a tab shows: the `ADR-n` when it is known, the start of the id when it is not. */
export const decisionName = (adr: string | undefined, id: string): string =>
  adr !== undefined && /^[A-Za-z0-9-]+$/.test(adr) ? adr : id.slice(0, 8);

/** The path of the address: the name of the tab, as a markdown file so the editor colours it. */
export const decisionPath = (adr: string | undefined, id: string): string =>
  `/${decisionName(adr, id)}.md`;

/** The query of the address: the id, which is what says which decision it is. */
export const decisionQuery = (id: string): string => `id=${id}`;

/** The id an address carries, when it carries one. */
export function idOfQuery(query: string): string | undefined {
  const match = /^id=([A-Za-z0-9-]+)$/.exec(query);
  return match?.[1];
}

/** What a read of one decision came to. */
export interface DecisionRead {
  /** The document. */
  readonly text: string;
  /** The state the record said, when the answer was a decision. */
  readonly state: string | undefined;
  readonly adr: string | undefined;
  readonly title: string | undefined;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const two = (n: number): string => String(n).padStart(2, '0');

/** When it was read, in the person's own clock: the day and the time. */
const clock = (at: Date): string =>
  `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ` +
  `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`;

/** Who a record names: the identity, and the agent when it says one. */
function actor(value: unknown): string | undefined {
  if (!isObject(value)) return undefined;
  const who = text(value.who);
  if (who === undefined) return undefined;
  const which = text(value.which);
  return which === undefined ? who : `${who} (agent ${which})`;
}

/**
 * The document for one decision, from what the command line answered. An answer that failed is
 * shown as the command line said it, and no field is made up for it.
 */
export function readDecision(
  id: string,
  result: { readonly code: number | null; readonly stdout: string; readonly stderr: string },
  readAt: Date,
): DecisionRead {
  const header = `Read from \`mnema show ${id} --json\` at ${clock(readAt)}. Nothing here is more than that answer.`;
  const failed = (said: string): DecisionRead => ({
    text: `${header}\n\n${said}\n`,
    state: undefined,
    adr: undefined,
    title: undefined,
  });
  if (result.code !== 0) {
    return failed(`mnema refused: ${(result.stderr || result.stdout).trim() || 'no reason given'}`);
  }
  let answer: unknown;
  try {
    answer = JSON.parse(result.stdout);
  } catch {
    return failed(`The answer was not JSON:\n\n${result.stdout.trimEnd()}`);
  }
  const record = isObject(answer) && isObject(answer.record) ? answer.record : undefined;
  if (!isObject(answer) || record === undefined) {
    return failed(`The answer was not a record:\n\n${result.stdout.trimEnd()}`);
  }
  const adr = text(record.adr);
  const title = text(record.title);
  const state = text(record.state);
  const lines = [
    `# ${[adr, title].filter((part) => part !== undefined).join(': ') || id}`,
    '',
    header,
    '',
  ];
  const field = (label: string, value: string | undefined): void => {
    if (value !== undefined) lines.push(`- ${label}: ${value}`);
  };
  field('Id', text(record.id) ?? id);
  field('State', state);
  // The scope is what `show` said at the top of its answer: a list's own scope is not this one.
  field('Scope', text(answer.scope));
  field('Recorded by', actor(record.recordedBy));
  field('Accepted by', actor(record.acceptedBy));
  field('Created', text(record.createdAt));
  field('Updated', text(record.updatedAt));
  const rationale = text(record.rationale);
  if (rationale !== undefined) lines.push('', '## Why', '', rationale);
  const alternatives = text(record.alternatives);
  if (alternatives !== undefined) lines.push('', '## Alternatives', '', alternatives);
  const moves = Array.isArray(record.proof)
    ? (record.proof as unknown[]).flatMap((move) => {
        if (!isObject(move)) return [];
        const parts = [text(move.at), text(move.action), text(move.said)].filter(
          (part) => part !== undefined,
        );
        return parts.length === 0 ? [] : [`- ${parts.join(' · ')}`];
      })
    : [];
  if (moves.length > 0) lines.push('', '## Moves', '', ...moves);
  return { text: `${lines.join('\n')}\n`, state, adr, title };
}
