/**
 * THE WORKFLOWS, AS PART OF THE FORMAT — which moves a decision, a task, a skill and a run may
 * make, and the one function every reader judges a move by (FORMAT.md §6.7).
 *
 * WHY THE TABLES LIVE HERE AND NOT IN THE DOMAIN. They used to be code of the product
 * (`core/workflow/*-transitions.ts`), consulted by the gate when it wrote and by no reader
 * when it read: a move written by hand with a valid key, `rejected → accepted`, verified and
 * was served as the decision's state. A reader can only judge a move by a table it has, and
 * `verify` lives in this package, which imports nothing of the domain. So the tables are data
 * of the format now, published in `event-schema.json`, and the domain's gate takes them from
 * here — one table, read by the gate that writes and by every reader that folds.
 *
 * WHAT A READER DOES WITH A MOVE THIS JUDGES ILLEGAL: it does not apply it, and `verify` names
 * it in its census, informational, the exit unchanged — the precedent of a stranger's
 * retraction (§6.4). The event is intact, hashed, chained and signed; what it lacks is a place
 * in the workflow, and that is a reading of the record rather than a fact about its bytes.
 *
 * THE STATE A MOVE IS JUDGED FROM. A move names the state it left (`from`). It is legal from
 * the state the subject is in at that point of the merged order (FORMAT.md, "Reading many
 * tails") — or, when that does not admit it, from the state its writer SAW: the moves its own
 * tail holds before it, and those up to the entries its tail cites in `after`. The second is
 * what keeps two machines that moved one decision without seeing each other a divergence, as
 * the format has always said, and not an illegal move; the first is what reads a record whose
 * writers cited nothing — every record from before citations — as it was written.
 */

import { oneLine } from '../one-line.js';
import type { CatalogEvent, TransitionFields } from './catalog.js';

/** One legal move: from a state, an action reaches a state, carrying the proof it requires. */
export interface WorkflowMove {
  readonly from: string;
  readonly action: string;
  readonly to: string;
  /** The proof fields the move must carry, each present (§4.1 already makes it non-empty). */
  readonly requires: readonly (keyof TransitionFields)[];
  /**
   * Whether the move names a successor in `by`: a decision whose birth the record holds, and
   * not the subject itself. A move without this carries no `by`.
   */
  readonly by?: true;
}

/** One workflow: its states, the move that gives a subject its first state, and the rest. */
export interface Workflow {
  readonly states: readonly string[];
  /** The birth: `from: null`, this action, to this state — once per subject. */
  readonly birth: { readonly action: string; readonly to: string };
  readonly moves: readonly WorkflowMove[];
}

/**
 * The three workflows a transition kind moves. Each row is a legal move and nothing else is;
 * the birth is not a row, because a subject is born once and never moved into being.
 *
 * Decisions: `supersede` is legal from `proposed` and from `accepted`, and names the successor.
 * Tasks: the one machine with a cycle — a task reopened leaves `IN_PROGRESS` again.
 * Skills: `deprecate` is the only way out of `adopted`.
 */
export const WORKFLOWS = {
  'decision.transitioned': {
    states: ['proposed', 'accepted', 'rejected', 'superseded'],
    birth: { action: 'create', to: 'proposed' },
    moves: [
      { from: 'proposed', action: 'accept', to: 'accepted', requires: ['note'] },
      { from: 'proposed', action: 'reject', to: 'rejected', requires: ['note'] },
      { from: 'proposed', action: 'supersede', to: 'superseded', requires: ['reason'], by: true },
      { from: 'accepted', action: 'supersede', to: 'superseded', requires: ['reason'], by: true },
    ],
  },
  'task.transitioned': {
    states: ['DRAFT', 'READY', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE', 'CANCELED'],
    birth: { action: 'create', to: 'DRAFT' },
    moves: [
      { from: 'DRAFT', action: 'submit', to: 'READY', requires: [] },
      { from: 'DRAFT', action: 'cancel', to: 'CANCELED', requires: ['reason'] },
      { from: 'READY', action: 'start', to: 'IN_PROGRESS', requires: [] },
      { from: 'READY', action: 'cancel', to: 'CANCELED', requires: ['reason'] },
      { from: 'IN_PROGRESS', action: 'block', to: 'BLOCKED', requires: ['reason'] },
      { from: 'IN_PROGRESS', action: 'submit_review', to: 'IN_REVIEW', requires: [] },
      { from: 'IN_PROGRESS', action: 'complete', to: 'DONE', requires: ['note'] },
      { from: 'IN_PROGRESS', action: 'cancel', to: 'CANCELED', requires: ['reason'] },
      { from: 'BLOCKED', action: 'unblock', to: 'IN_PROGRESS', requires: [] },
      { from: 'IN_REVIEW', action: 'approve', to: 'DONE', requires: ['note'] },
      { from: 'IN_REVIEW', action: 'request_changes', to: 'IN_PROGRESS', requires: ['feedback'] },
      { from: 'DONE', action: 'reopen', to: 'IN_PROGRESS', requires: ['reason'] },
    ],
  },
  'skill.transitioned': {
    states: ['proposed', 'reviewed', 'adopted', 'rejected', 'deprecated'],
    birth: { action: 'create', to: 'proposed' },
    moves: [
      { from: 'proposed', action: 'review', to: 'reviewed', requires: ['note'] },
      { from: 'proposed', action: 'reject', to: 'rejected', requires: ['note'] },
      { from: 'reviewed', action: 'adopt', to: 'adopted', requires: ['note'] },
      { from: 'reviewed', action: 'reject', to: 'rejected', requires: ['note'] },
      { from: 'adopted', action: 'deprecate', to: 'deprecated', requires: ['reason'] },
    ],
  },
} as const satisfies { readonly [kind: string]: Workflow };

/** A kind whose events move a subject through a workflow. */
export type TransitionKind = keyof typeof WORKFLOWS;

/**
 * A move a reader judges: a transition of one of the three workflows, or the end of a run. A
 * run has no table — it is open from its `run.started` and ends once — so its move is the one
 * kind here with no `from`.
 */
export type MoveEvent = Extract<
  CatalogEvent,
  { readonly kind: TransitionKind | 'run.ended' }
>;

/** The state a run is in: `open` from its start, `ended` from its end. */
export const RUN_OPEN = 'open';
export const RUN_ENDED = 'ended';

/** Whether `event` is a move a reader judges. */
export function isMove(event: CatalogEvent): event is MoveEvent {
  return event.kind === 'run.ended' || Object.hasOwn(WORKFLOWS, event.kind);
}

/**
 * Why a move is not applied — one rule each, so the census can say which.
 *
 * - `not-born`: the subject has no birth before it (a run: no `run.started`).
 * - `born-twice`: a birth (`from: null`) of a subject already born.
 * - `not-in-the-table`: `(from, action) → to` is no row of the workflow, so a state that is not
 *   one of its states lands here too; for a birth, an action or a `to` that is not the birth's.
 * - `proof-missing`: a field the row requires is absent.
 * - `successor`: a move that must name its successor in `by` does not name a decision the record
 *   holds a birth of, or names its own subject — or a move that takes no successor carries one.
 * - `not-the-state-seen`: `from` is neither the state the subject is in at that point nor the
 *   state its writer saw.
 * - `ended-twice`: a run's end after an end its writer had seen.
 */
export type MoveRule =
  | 'not-born'
  | 'born-twice'
  | 'not-in-the-table'
  | 'proof-missing'
  | 'successor'
  | 'not-the-state-seen'
  | 'ended-twice';

/** A move a reader does not apply, and why. */
export interface IllegalMove {
  readonly rule: MoveRule;
  /** One line, naming what the move said and what the rule found. */
  readonly detail: string;
}

/** What a reader knows of the subject when it reaches a move. */
export interface MoveStanding {
  /**
   * The state the subject is in at this point of the merged order, applying only the moves
   * that were legal; undefined before its birth. A run's is {@link RUN_OPEN} or {@link RUN_ENDED}.
   */
  readonly now: string | undefined;
  /**
   * The state its writer saw — the same fold over only the moves its own tail holds before it
   * and those up to what its tail cites. Asked only when {@link now} does not admit the move,
   * which is the rare case, so a reader that cannot answer it cheaply may stop there.
   */
  seen(): string | undefined;
  /** Whether the record holds the birth of decision `id` — what a successor must name. */
  born(id: string): boolean;
}

/** The one judgment of a move; undefined when it is legal. */
export function judgeMove(event: MoveEvent, standing: MoveStanding): IllegalMove | undefined {
  if (event.kind === 'run.ended') return judgeEnd(event, standing);
  const machine: Workflow = WORKFLOWS[event.kind];
  const { from, to, action } = event.payload;
  const said = `${from === null ? 'null' : oneLine(from)} → ${oneLine(to)} by "${oneLine(action)}"`;
  if (from === null) {
    if (standing.now !== undefined) {
      return { rule: 'born-twice', detail: `a birth (${said}) of a subject born already` };
    }
    if (action !== machine.birth.action || to !== machine.birth.to) {
      return {
        rule: 'not-in-the-table',
        detail: `a birth ${said}, where a birth is null → ${machine.birth.to} by "${machine.birth.action}"`,
      };
    }
    return judgeSuccessor(event, undefined, said, standing);
  }
  if (standing.now === undefined) {
    return { rule: 'not-born', detail: `a move ${said} of a subject with no birth before it` };
  }
  const row = machine.moves.find((move) => move.from === from && move.action === action);
  if (row === undefined || row.to !== to) {
    return { rule: 'not-in-the-table', detail: `a move ${said}, which the workflow does not hold` };
  }
  const fields: TransitionFields = event.payload.fields ?? {};
  const missing = row.requires.filter((field) => fields[field] === undefined);
  if (missing.length > 0) {
    return {
      rule: 'proof-missing',
      detail: `a move ${said} without the ${missing.join(', ')} it requires`,
    };
  }
  const successor = judgeSuccessor(event, row, said, standing);
  if (successor !== undefined) return successor;
  if (from === standing.now) return undefined;
  const seen = standing.seen();
  if (from === seen) return undefined;
  return {
    rule: 'not-the-state-seen',
    detail:
      `a move ${said} of a subject that was ${oneLine(standing.now)} there, ` +
      `and ${seen === undefined ? 'not born' : oneLine(seen)} to the one that wrote it`,
  };
}

/** The `by` of a move: named, born and not the subject where the row asks; absent elsewhere. */
function judgeSuccessor(
  event: Exclude<MoveEvent, { readonly kind: 'run.ended' }>,
  row: WorkflowMove | undefined,
  said: string,
  standing: MoveStanding,
): IllegalMove | undefined {
  const by = event.kind === 'decision.transitioned' ? event.payload.by : undefined;
  if (row?.by !== true) {
    if (by === undefined) return undefined;
    return { rule: 'successor', detail: `a move ${said} that names a successor it does not take` };
  }
  if (by === undefined) {
    return { rule: 'successor', detail: `a move ${said} that names no successor` };
  }
  if (by === event.subject) {
    return { rule: 'successor', detail: `a move ${said} that names its own subject as successor` };
  }
  if (!standing.born(by)) {
    return {
      rule: 'successor',
      detail: `a move ${said} naming a successor ${oneLine(by)} the record holds no birth of`,
    };
  }
  return undefined;
}

/** A run ends once: from its start, and never after an end its writer saw. */
function judgeEnd(
  _event: Extract<MoveEvent, { readonly kind: 'run.ended' }>,
  standing: MoveStanding,
): IllegalMove | undefined {
  if (standing.now === undefined) {
    return { rule: 'not-born', detail: 'the end of a run with no start before it' };
  }
  if (standing.now === RUN_OPEN) return undefined;
  if (standing.seen() === RUN_OPEN) return undefined;
  return { rule: 'ended-twice', detail: 'the end of a run that had ended already' };
}

/** The state a legal move leaves its subject in. */
export function stateAfter(event: MoveEvent): string {
  return event.kind === 'run.ended' ? RUN_ENDED : event.payload.to;
}
