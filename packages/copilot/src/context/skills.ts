/**
 * skills: the patterns an agent works by, and the one it is asked to rule on.
 *
 * A skill is a distilled way of working, and until now it was write-only — the
 * `body`, which IS the pattern, was projected and never returned to anyone. This
 * is the read that gives it back: the patterns by name for an index, and by body
 * on demand.
 *
 * WHICH BODIES ARE SERVED IS DECIDED BY DISPOSITION, NEVER BY ONE STATE.
 * {@link SKILL_DISPOSITION} is the table and {@link BODY_SERVED} says what each
 * disposition gets:
 *   - `in-force` — served, and served as an INSTRUCTION: this is how work is done here;
 *   - `awaiting-judgement` — served too, and only to a caller that NAMES it by id;
 *   - `closed` — refused, with the state said out loud.
 *
 * The refusal of a `closed` body is where the argument that used to justify refusing
 * four states now lives, and it is the whole of what that argument ever covered:
 * handing an agent the body of a way of working the team RETIRED is worse than
 * handing it nothing. Nothing in it reaches a pattern that is still being decided.
 *
 * NOBODY GETS A CANDIDATE BY OMISSION, and that is the half of the old rule that
 * survives. {@link adoptedSkills} — the list asked with no id, the one an opening
 * context and a committed brief are built from — carries `in-force` and nothing else.
 * Only {@link lookupServedSkill}, which answers an id its caller typed, reaches the
 * waiting ones. The split is not ours: a prompt or model registry serves the
 * production label by default and a candidate only to whoever names the version.
 *
 * THE PREMISE THIS FALSIFIES was written here, and the falsification is the reason
 * the rule moved. This module used to say "AND NO READ OF THE AGENT'S SURFACE SERVES
 * ONE OF THOSE BODIES", and read the refusal as protecting the body. It protected
 * nothing. The gate does not require a consultation, so an agent holding the id an
 * opening read hands it could `review`, `adopt`, and then be served the body — two
 * writes, and both of them false on the chain: a review and an adoption by somebody
 * who could not read what they ruled on. The refusal made the body dearer, not
 * unreachable, and charged the record for it. And the same surface already served
 * the whole `rationale` of a decision still `proposed` ({@link readRecord}, no state
 * filter at all) — the same list, the same disposition, the same reader, one half
 * getting the text of what it must judge and the other half nothing. The asymmetry
 * was an artefact of `skills` being the only read that WRITES, never a doctrine.
 *
 * WHAT DID NOT MOVE: a body leaves through ONE door, and that door records the
 * consultation. `read_record` still refuses a skill outright (`USE_SKILLS_TOOL`) for
 * exactly that reason — not to keep bodies in, but to keep the fact of a reading from
 * escaping unrecorded, because whether work was informed by a pattern is derivable
 * from nothing else afterwards. Asserted in `mcp-e2e.test.ts` — "skills with an id
 * serves the body of a pattern awaiting a judgement, and records the consultation".
 *
 * The command line is unchanged, and still serves every state on purpose: `mnema
 * show <id>` reads for a PERSON who is curating, and records nothing because there
 * is no session there to attribute a consultation to (`show.ts`).
 *
 * TWO OF THOSE STATES ARE ALSO SOMETHING TO SAY UNASKED, and that is the second read
 * here. A pattern `proposed` waits for a review and a `reviewed` one waits for the
 * adoption; both are a judgement somebody owes, and a curation backlog nobody is
 * told about is a backlog that does not clear.
 * {@link skillsAwaitingJudgement} names them — WITHOUT the body, which is what keeps
 * an index an index: a name invites a ruling and costs one line, a body is paragraphs
 * of instruction and belongs to whoever asked for that pattern by id.
 *
 * ONE TABLE SAYS WHICH IS WHICH. {@link SKILL_DISPOSITION} gives every state of the
 * machine a meaning, and every list and every refusal here is DERIVED from it, none
 * restating its own set beside it — the same reason `decisions.ts` has one.
 *
 * ACROSS THE TREES the caller can see, not one. A skill is a CAPABILITY, and a
 * capability does not belong to a tree the way a piece of work does: the team's
 * patterns are adopted in the public tree, an agent's own in the private one,
 * and a personal convention in the global one — and all three apply to whatever
 * the agent is doing. This is the deliberate asymmetry with bootstrap's work
 * list, which stays on the actor's single tree because work IS scoped.
 *
 * Reading per-tree projections and concatenating is not an approximation of
 * reading the union: a skill's whole history lands in ONE tree (a move follows
 * the entity), so the per-tree fold and the union fold see the same events for
 * it. Concatenating warm caches is the same answer as replaying every tail, at
 * an indexed lookup instead of a linear scan.
 *
 * WITH THE BODY GOES ITS PROVENANCE — the agent that adopted it, or nobody when a
 * person did, or NOBODY AT ALL when the pattern has not been adopted. This is the
 * only entity whose content comes back as instruction, so it is the only one whose
 * consumer could not otherwise see who put it there. ONE fact, not an account: the
 * fuller reading (who proposed it too, and whether both ends are the same agent)
 * belongs where a person is looking at it.
 *
 * The `state` travels with the body for the neighbouring reason, and it is the
 * WORKFLOW's own word rather than a second one: "candidate" or "pending" beside
 * `proposed` would be two vocabularies for one fact, and the reader would have to
 * learn which of them means what. The sentence that says what a non-adopted body IS
 * belongs to the surface serving it, which is where the reader is.
 */

import {
  isSkillState,
  type ProjectionCache,
  SKILL_STATES,
  type SkillProjection,
  type SkillState,
} from '@mnema/core';
import { type Disposition, statesMeaning } from './disposition.js';

/**
 * What each state of the skill machine means to a reader — TOTAL, so a sixth state
 * cannot be added to the workflow without being classified here.
 *
 * Read against `SKILL_TRANSITIONS`, which is the source of truth for every claim
 * below:
 *   - `proposed` — `review` and `reject` leave from it; somebody has to look.
 *   - `reviewed` — `adopt` and `reject` leave from it; somebody has to rule. It is
 *     the state that makes this machine's waiting side TWO states, and it is why
 *     the state travels with the item: "needs a review" and "needs a decision"
 *     ask for different moves and would otherwise be the same line.
 *   - `adopted` — it is a live pattern. `deprecate` is still legal from it, which
 *     is why "has a legal move" is the wrong criterion for either of the opening
 *     read's lists — including the work list, which is where that rule came from
 *     and where it was equally wrong (`tasks.ts`).
 *   - `rejected`, `deprecated` — terminal, no row leaves either.
 *
 * Exported so the claims above are CHECKABLE against the table they are read from,
 * rather than asserted in prose: `disposition.test.ts` cross-checks every row of
 * this against `SKILL_TRANSITIONS`. The TABLE is not on the package's public
 * surface — what is, is {@link skillDisposition}, one state's answer, because a
 * surface that frames a served body has to know whether the body is a way of working
 * or a proposal, and re-deriving that from the state would be this table copied
 * where nobody could see it drift.
 *
 * Both halves of that sentence are CHECKED and no longer only declared:
 * `no-classification-table-reaches-the-surface.test.ts` walks the runtime exports of
 * every entry point in the workspace and asserts that this table is absent from all
 * of them and that {@link skillDisposition} is present on this package's. What it
 * does NOT cover is written in its own doc — a consumer that reimplements the
 * classification from scratch touches neither the table nor the function.
 */
export const SKILL_DISPOSITION: Readonly<Record<SkillState, Disposition>> = {
  proposed: 'awaiting-judgement',
  reviewed: 'awaiting-judgement',
  adopted: 'in-force',
  rejected: 'closed',
  deprecated: 'closed',
};

/**
 * Whether the BODY of a pattern in each disposition is served — the ONE place that
 * decision is written, and the reason it is a table and not a condition: a fourth
 * disposition does not COMPILE until it has an answer here, where a predicate naming
 * the two it serves would silently refuse a disposition it had never heard of.
 *
 * `closed` is the only `false`, and the argument is the module doc's: a way of
 * working the team retired is worse than nothing. The two that are served are served
 * differently, and that difference is not here — it is in WHICH READ reaches them
 * ({@link adoptedSkills} vs {@link lookupServedSkill}), because "what a caller gets
 * without asking" is a question about the read and not about the state.
 */
const BODY_SERVED: Readonly<Record<Disposition, boolean>> = {
  'in-force': true,
  'awaiting-judgement': true,
  closed: false,
};

/** The states whose skills are live patterns — derived, never restated. */
const ADOPTED = statesMeaning(SKILL_STATES, skillDisposition, 'in-force');

/** The states whose skills are waiting on somebody — derived, never restated. */
const AWAITING_JUDGEMENT = statesMeaning(SKILL_STATES, skillDisposition, 'awaiting-judgement');

/**
 * What one state MEANS to a reader — the classification, for the one consumer that
 * has to say something about a body it was handed and must not decide it twice.
 *
 * A surface serving a body frames it: a pattern in force is an instruction, and one
 * awaiting a judgement is a proposal that governs nothing. The words are the
 * surface's; the classification is this module's, asked rather than restated.
 */
export function skillDisposition(state: SkillState): Disposition {
  return SKILL_DISPOSITION[state];
}

/**
 * Whether this module serves the body of a pattern recorded in `state` — the single
 * site where a recorded word becomes that decision, and a NARROWING: what it
 * accepts is the workflow's own vocabulary.
 *
 * The projection stores `state` as a literal string on purpose — a fact written
 * today stays legible if the workflow later renames a state — so a word the workflow
 * has never had reaches here, and the honest answer for it is no: this module can
 * classify what {@link SKILL_DISPOSITION} covers and nothing else, and a body it
 * cannot classify is a body it does not serve. That is also what keeps the served
 * `state` a closed vocabulary rather than recorded text, which is why a surface can
 * print it on a line it counts.
 */
function servesBody(state: string): state is SkillState {
  return isSkillState(state) && BODY_SERVED[SKILL_DISPOSITION[state]];
}

/** A skill named but not spelled out — what an index is made of. */
export interface SkillRef {
  /** The skill's id — the key that asks for its body. */
  readonly id: string;
  /** The skill's short name — DISPLAY, and the trigger a reader recognizes. */
  readonly name: string;
}

/**
 * A skill whose body is served, with the pattern itself and the state it is in.
 *
 * It is `Served` and not `Adopted` because a name has to say what the thing IS: an
 * adopted pattern and a candidate somebody named both come back through here, and a
 * type called `AdoptedSkill` carrying a `proposed` body is the type lying about its
 * own content. ONE type for both, not two — what differs is a field
 * ({@link ServedSkill.state}), and two types would be two shapes for one answer,
 * each needing its own handling at every consumer.
 */
export interface ServedSkill extends SkillRef {
  /** The reusable pattern — the whole point of having recorded the skill. */
  readonly body: string;
  /**
   * The workflow state this body was served in — `adopted` for a way of working
   * here, `proposed` or `reviewed` for one the project has not ruled on.
   *
   * It is the WORKFLOW's word and not a second one, and it is the whole label: a
   * consumer asks {@link skillDisposition} what it means, and the sentence that says
   * "this is not how work is done here" is written where the reader is. Typed as the
   * closed vocabulary, which is what lets a surface print it on a line whose count
   * has to match the count of items served.
   */
  readonly state: SkillState;
  /**
   * The agent that adopted it — the act that made this body something an agent is
   * served as instruction. ABSENT means a person adopted it directly, OR that
   * nothing has adopted it at all: the two are told apart by the `state`, and a
   * consumer that says "adopted by a person" without reading it says something false
   * about a candidate.
   *
   * It travels WITH the body, in one line, because nothing else the consumer
   * receives says where the pattern came from: a task or a decision carries its
   * movers on the events a timeline shows, and a served body carried nothing. It
   * is provenance, not a verdict — the fuller account (who proposed it, whether
   * the two ends are one agent) is the command line's, where a person is reading.
   */
  readonly adoptedBy?: string;
}

/** Asking for one skill by id: the body, the state that says why not, or absent. */
export type SkillLookup =
  /** Served — the body comes back, with the state it is in. */
  | { readonly outcome: 'served'; readonly skill: ServedSkill }
  /**
   * A skill with this id exists and its body is not served: the project CLOSED it,
   * or the record holds a state this module cannot classify. The state is reported
   * (never the body), so an agent holding a stale name learns what happened to it
   * rather than being told it never existed.
   */
  | { readonly outcome: 'not-served'; readonly state: string }
  /** No tree the caller can see holds a skill with this id. */
  | { readonly outcome: 'unknown' };

/**
 * Every adopted skill across `caches`, with its body, ordered by name (ties
 * broken by id). The order is a property of the CONTENT, not of the tree the
 * skill happens to live in, so adding a tree to the list — or reading them in a
 * different order — never reshuffles the answer. Callers put this in a prompt;
 * a stable order is what keeps the host's cache of that prefix valid.
 *
 * `in-force` AND NOTHING ELSE, which is the one thing the change of rule did not
 * touch: this is the answer a caller gets without naming anything, and it feeds an
 * opening context and a committed brief. A candidate arriving here would be a
 * candidate served as an instruction to somebody who never asked for it, which is
 * the only part of the old rule that was ever protecting anything. Asserted in
 * `skills.test.ts` — "serves ONLY the adopted: proposed, reviewed, rejected and
 * deprecated are absent" — and over the tool in `mcp-e2e.test.ts`.
 *
 * The state is the BUCKET each row was read under, not a second reading of the
 * projection — the same thing {@link skillsAwaitingJudgement} does, for the same
 * reason: the indexed read already knows the answer.
 */
export function adoptedSkills(caches: readonly ProjectionCache[]): ServedSkill[] {
  const all: ServedSkill[] = [];
  for (const cache of caches) {
    for (const state of ADOPTED) {
      for (const skill of cache.listSkillsByState(state)) all.push(toServed(skill, state));
    }
  }
  return all.sort(byNameThenId);
}

/**
 * A pattern nobody has ruled on yet — a name, plus the state that says WHICH
 * ruling is missing.
 *
 * NO BODY, and that is the whole difference from {@link ServedSkill}. This is an
 * INDEX — every item of it, unasked, in every session's opening context — so a body
 * here would be paragraphs of a pattern nobody asked about, in the one payload that
 * has to stay short. The body is one read away, by the id on this line
 * ({@link lookupServedSkill}), and the fact that it was read is recorded there.
 *
 * This doc used to say that no agent-facing read served this one's text at all. That
 * was true of the code and wrong as a rule: it is not judgeable without its text (see
 * the module doc for what falsified it). No provenance either — `adoptedBy` is a fact
 * about an adoption that has not happened.
 */
export interface SkillAwaitingJudgement extends SkillRef {
  /**
   * Always `skill`: the discriminant, and what says this line is a PATTERN awaiting
   * a ruling rather than a call awaiting one.
   */
  readonly kind: 'skill';
  /**
   * The state it is waiting in, which is what says what is owed: `proposed` needs
   * a review, `reviewed` needs the adoption call. Typed as the workflow's own
   * state, and it is the state the row was READ under (the bucket the indexed
   * lookup asked for), not a second reading of the projection.
   */
  readonly state: SkillState;
  /** `at` of its last transition — what the composed list orders on. */
  readonly updatedAt: string;
}

/**
 * Every skill awaiting a judgement across `caches`, in no particular order.
 *
 * ORDERING IS THE CALLER'S HERE, and that is the difference from
 * {@link adoptedSkills}. This answer is half of ONE list — skills and decisions
 * interleaved by when each last moved (see {@link bootstrap}) — so an order imposed
 * here would be an order the composition immediately discards.
 *
 * The states come from {@link SKILL_DISPOSITION} and each is fetched by
 * `listSkillsByState`, the INDEXED read: listing every skill and filtering in
 * memory would read the whole table to throw almost all of it away.
 */
export function skillsAwaitingJudgement(
  caches: readonly ProjectionCache[],
): SkillAwaitingJudgement[] {
  const pending: SkillAwaitingJudgement[] = [];
  for (const cache of caches) {
    for (const state of AWAITING_JUDGEMENT) {
      for (const skill of cache.listSkillsByState(state)) {
        pending.push({
          kind: 'skill',
          id: skill.id,
          name: skill.name,
          state,
          updatedAt: skill.updatedAt,
        });
      }
    }
  }
  return pending;
}

/**
 * Looks one skill up by id across `caches` and serves its body unless the state
 * refuses it ({@link servesBody}). The first tree that holds the id answers — an id
 * is minted once and lives in one tree, so there is no second holder to disagree.
 *
 * THIS IS THE READ THAT REACHES A CANDIDATE, and asking by id is the whole of the
 * permission: the caller named the pattern it wants to rule on. It does not judge
 * whether the caller SHOULD have it — the state comes back with the body, and what
 * that means to a reader is said by the surface serving it.
 */
export function lookupServedSkill(caches: readonly ProjectionCache[], id: string): SkillLookup {
  for (const cache of caches) {
    const skill = cache.getSkill(id);
    if (skill === null) continue;
    if (!servesBody(skill.state)) return { outcome: 'not-served', state: skill.state };
    return { outcome: 'served', skill: toServed(skill, skill.state) };
  }
  return { outcome: 'unknown' };
}

/**
 * The projection as a served body. `state` is passed in rather than read off the
 * projection, so what lands on the answer is the word a caller already NARROWED to
 * the workflow's vocabulary — the bucket of an indexed read, or the state
 * {@link servesBody} accepted.
 */
function toServed(skill: SkillProjection, state: SkillState): ServedSkill {
  const adoptedBy = skill.adoption?.by;
  return {
    id: skill.id,
    name: skill.name,
    body: skill.body,
    state,
    ...(adoptedBy !== undefined ? { adoptedBy } : {}),
  };
}

function byNameThenId(a: SkillRef, b: SkillRef): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
