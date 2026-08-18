/**
 * Whether the run that MOVED a pattern had been served its body, and — where the
 * record cannot say — the fact that it cannot.
 *
 * The signal a study promised in place of a gate. The gate would have been "you move
 * what you read", refused because it cannot be enforced evenly: `skill.consulted` is
 * written by the surface that SERVES a body, and only the agent's surface serves one.
 * A person curating patterns opens the file with `mnema show`, which records nothing
 * and structurally cannot — so a rule that fired on a missing consultation would fire
 * on the correct human behaviour, which is not a signal at all.
 *
 * WHAT MAKES IT ENUNCIABLE IS THE RUN, and the rule comes out of the data rather than
 * out of a convention written for people. Both facts carry the same envelope field, so
 * for a move of skill S inside run R the record answers one of exactly three ways:
 *
 *   - R holds a `skill.consulted` of S — CONSULTED.
 *   - R holds none of S, but holds one of some OTHER pattern — MOVED WITHOUT CONSULTING.
 *     This is the only case this reading asserts anything in, and what licenses it is R
 *     itself: a run that recorded a consultation has PROVED the witness was operating,
 *     so its silence about S means something.
 *   - R holds no consultation at all, or the move carries no run — NOT OBSERVABLE.
 *     Never "did not consult". The silence says nothing because nothing here was
 *     listening, and that is the state every move a person makes is in.
 *
 * THE THIRD ANSWER IS THE WHOLE READING. Collapsing it into the second is the exact
 * defect that blocked this signal for a fortnight, and it would come back silent: a
 * report naming the people who curate patterns correctly as the ones who skipped the
 * reading. It is also why the exemption is not written for PEOPLE — an exception that
 * said "unless a human did it" would be the same asymmetry wearing a kinder face, and
 * the record cannot tell a human from an agent anyway. What it can tell is whether the
 * run it is looking at ever recorded a reading.
 *
 * TWO ACTIONS, `review` AND `adopt`, and the set is the decision's rather than this
 * file's convenience. Those are the two moves that carry a pattern TOWARD being served
 * as instruction — a review says someone looked, an adopt puts the body into the prompt
 * of every session that reaches the tree. `reject` and `deprecate` take a pattern OUT of
 * that path, and a body nobody will be handed again is not one this reading has an
 * interest in.
 *
 * ORDER INSIDE THE RUN IS NOT ASKED. A consultation recorded after the move still counts
 * as the run having read the body, because the unit here is the SESSION and not the
 * instant: the stream this folds is a k-way merge across a record's trees, whose total
 * order is a tie-break this product chose and not an order two writers agreed on. Two
 * facts of one session sorted by it would be precision the record does not have.
 *
 * IT POINTS AND DOES NOT CONCLUDE, like the shapes beside it, and it is not a gate: no
 * move is refused, no exit code changes, and nothing here is written. `mnema antipatterns`
 * is where it surfaces, on the command line only — the agent's surface gets no tool for
 * it, because handing an agent a reading of whether it consulted before it moved inverts
 * the axis the product is built on (the MCP surface is the agent's, the command line is
 * the auditor's).
 *
 * The claims of {@link PatternMoveWitness.note} are held to being true by
 * `packages/code/tests/what-the-record-can-witness.test.ts` — the third answer and the
 * absence of the accusing sentence from it, a person driving the real CLI
 * (`run start` → `show` → `skill move`) and coming back NOT OBSERVABLE, and a digest of
 * the sandbox proving the reading wrote nothing.
 */

import type { CatalogEvent } from './events.js';

/** The event whose subject is the pattern that was read. */
const CONSULTED = 'skill.consulted';

/** The event a move of a pattern is written as. */
const MOVED = 'skill.transitioned';

/**
 * The two moves this reading asks about — the ones that carry a pattern toward being
 * served as instruction. See the module doc for why the retiring moves are not here.
 */
const ASKED_ABOUT: ReadonlySet<string> = new Set(['review', 'adopt']);

/** A move this reading asks about. */
export type PatternMoveAction = 'review' | 'adopt';

/** One move of a pattern, as the record holds it. */
export interface PatternMove {
  /** The pattern that moved — the event's subject. */
  readonly skill: string;
  /** Which move it was. */
  readonly action: PatternMoveAction;
  /** When, as the envelope stamped it. */
  readonly at: string;
  /**
   * The session it happened in, when it happened in one. Absent is not a gap to fill:
   * a move carrying no run is a move there is no session to ask about, and it is why
   * the third answer exists rather than a reason to guess at the first two.
   */
  readonly run?: string;
  /** The agent that carried it out, when one did. Absent means a person acted directly. */
  readonly which?: string;
}

/**
 * Every move of a pattern, in the one of three answers the record gives about it, and
 * the sentence saying what those answers can and cannot mean.
 */
export interface PatternMoveWitness {
  /**
   * What this reading can witness, said IN the answer rather than beside it.
   *
   * It rides with the data for the reason the harness's own caveat columns do: a
   * qualification kept in the prose next to a table travels one copy of that table and
   * then stops, and this one is load-bearing — a reader who takes the second count for
   * "these people did not do the reading" has misread every row of it. So it is a field
   * of the answer, printed under the counts and carried in the JSON.
   */
  readonly note: string;
  /** Moves whose own run recorded a consultation of the same pattern. */
  readonly consulted: readonly PatternMove[];
  /**
   * Moves whose run recorded a consultation of SOME OTHER pattern and none of this one
   * — the one case this reading asserts something in.
   */
  readonly movedWithoutConsulting: readonly PatternMove[];
  /**
   * Moves whose run recorded no consultation at all, or that carry no run. The record
   * has nothing to say about them, which is not the same news as the list above and is
   * never reported as it.
   */
  readonly notObservable: readonly PatternMove[];
}

/**
 * What this reading can witness, and what it cannot — the words the surface prints and
 * the JSON carries, worded once, here, beside the rule they describe.
 *
 * Four claims, because four of them are load-bearing: WHERE a consultation comes from,
 * what the absence of one therefore means, which single case is an assertion, and that
 * nothing was refused or written to produce any of it.
 */
const WHAT_IT_CAN_WITNESS = [
  'What this can witness: a consultation is recorded when the AGENT surface serves a body, and',
  'nothing records a person who read the pattern with `mnema show`. So a move whose run recorded no',
  'consultation at all is NOT OBSERVABLE here — never a move made without consulting. The one case',
  'this asserts is a move whose own run recorded a consultation of some other pattern: there the',
  'record proves the witness was operating. Nothing was refused, and nothing was written to produce it.',
].join(' ');

/**
 * Sorts every `review` and `adopt` in the stream into the three answers the record can
 * give about it, in the stream's own order within each.
 *
 * The consultations are collected FIRST, over the whole stream, because the question
 * asked of a move is about its RUN and not about what came before it — see the module
 * doc on why the order inside a session is not asked.
 *
 * A consultation carrying no run is not collected at all. It witnesses nothing: it names
 * no session, so there is no move it can be the reading for, and counting it as one would
 * attribute a reading to whichever session happened to move a pattern next.
 */
export function patternMoveWitness(events: readonly CatalogEvent[]): PatternMoveWitness {
  const consultedInRun = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.kind !== CONSULTED || event.run === undefined) continue;
    const skills = consultedInRun.get(event.run) ?? new Set<string>();
    skills.add(event.subject);
    consultedInRun.set(event.run, skills);
  }
  const consulted: PatternMove[] = [];
  const movedWithoutConsulting: PatternMove[] = [];
  const notObservable: PatternMove[] = [];
  for (const event of events) {
    if (event.kind !== MOVED || !ASKED_ABOUT.has(event.payload.action)) continue;
    const move: PatternMove = {
      skill: event.subject,
      action: event.payload.action as PatternMoveAction,
      at: event.at,
      ...(event.run !== undefined ? { run: event.run } : {}),
      ...(event.which !== undefined ? { which: event.which } : {}),
    };
    const readInRun = event.run === undefined ? undefined : consultedInRun.get(event.run);
    if (readInRun === undefined) notObservable.push(move);
    else if (readInRun.has(move.skill)) consulted.push(move);
    else movedWithoutConsulting.push(move);
  }
  return { note: WHAT_IT_CAN_WITNESS, consulted, movedWithoutConsulting, notObservable };
}
