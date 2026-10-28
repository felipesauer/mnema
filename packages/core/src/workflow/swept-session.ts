/**
 * The task of a session nobody saw end, and how the record says so.
 *
 * A session that stopped with no `SessionEnd` has its task blocked by the next session of the project
 * that dispatches, with a reason that says how it is known and no more. That reason is the only mark the
 * block leaves in the record, so the writer and the readers that must tell such a task from one a person
 * blocked share the sentence here: a second copy of it would be a mark one side could change alone.
 */

import type { TransitionProof } from '../projections/proof.js';
import { taskDisposition } from './disposition.js';
import { isTaskState } from './states.js';

/** The first sentence of the reason a swept session's task is blocked with. */
const LEAD = 'The session stopped with no end, so how it ended is unknown.';

/** The line of a proof that carries the reason, in the shape `transitionProse` writes it. */
const REASON = `reason: ${LEAD}`;

const LAST_SEEN = /It was last seen at (\S+?); /;

/**
 * The reason a swept session's task is blocked with: what is known and no more. The session stopped
 * with no `SessionEnd`, so nobody saw how it ended: this says so, when it was last seen, and the count.
 */
export function sweptReason(handoffs: number, skipped: number, lastSeen: string): string {
  return (
    `${LEAD} It was last seen at ${lastSeen}; ` +
    `${handoffs} ${handoffs === 1 ? 'handoff was' : 'handoffs were'} recorded in it.` +
    (skipped === 0
      ? ''
      : ` ${skipped} ${skipped === 1 ? 'dispatch was' : 'dispatches were'} not mirrored.`)
  );
}

/**
 * When a task was last seen alive, if its CURRENT block is a sweep's: the last `block` the task went
 * through carries the sweep's reason. A task a person blocked, or blocked again after the sweep's block
 * was lifted, is not one, and neither is a task in any other state. The time falls back to the block's
 * own `at` when the reason has none that reads.
 */
export function lastSeenOfSweptTask(
  state: string,
  proof: readonly TransitionProof[] | undefined,
): string | undefined {
  if (!isTaskState(state) || taskDisposition(state) !== 'stalled') return undefined;
  let blocked: TransitionProof | undefined;
  for (const one of proof ?? []) if (one.action === 'block') blocked = one;
  const line = blocked?.said.split('\n').find((said) => said.startsWith(REASON));
  if (blocked === undefined || line === undefined) return undefined;
  return LAST_SEEN.exec(line)?.[1] ?? blocked.at;
}
