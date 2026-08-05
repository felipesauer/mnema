/**
 * skills: the adopted patterns an agent may actually use.
 *
 * A skill is a distilled way of working, and until now it was write-only — the
 * `body`, which IS the pattern, was projected and never returned to anyone. This
 * is the read that gives it back: the ADOPTED skills, by name for an index and
 * by body on demand.
 *
 * ONLY `adopted` IS SERVED AS A PATTERN. Proposed, reviewed, rejected and
 * deprecated are states of the process of DECIDING about a pattern, not patterns
 * to work by. Serving a deprecated body would hand an agent a way of working the
 * team retired — the one outcome worse than serving nothing.
 *
 * BUT TWO OF THOSE STATES ARE STILL SOMETHING TO SAY, and that is the second read
 * here. A pattern `proposed` waits for a review and a `reviewed` one waits for the
 * adoption; both are a judgement somebody owes, and a curation backlog nobody is
 * told about is a backlog that does not clear.
 * {@link skillsAwaitingJudgement} names them — WITHOUT the body, which is the
 * distinction that keeps this from being the previous paragraph's opposite: a name
 * is an invitation to rule on a pattern, a body is an instruction to work by it.
 *
 * AND NO READ OF THE AGENT'S SURFACE SERVES ONE OF THOSE BODIES. Measured, not
 * assumed: {@link lookupAdoptedSkill} refuses precisely those states
 * (`NOT_ADOPTED`), and the `read_record` tool refuses a skill outright
 * (`USE_SKILLS_TOOL`, so a body cannot leave through a second door) — the two
 * refusals point at each other. It is the axis rather than an oversight, and the
 * command line makes the opposite call on purpose: `mnema show <id>` serves a
 * proposed pattern's text, because the person reading it is CURATING. So what
 * {@link skillsAwaitingJudgement} gives an agent is the name and the state — enough
 * to raise it, or to move it — and nothing here claims a door that would refuse it.
 * Asserted in `mcp-e2e.test.ts` — "answers the SECOND READ each kind names, for
 * every item awaiting a judgement".
 *
 * ONE TABLE SAYS WHICH IS WHICH. {@link SKILL_DISPOSITION} gives every state of the
 * machine a meaning, and both lists are DERIVED from it, neither restating its own
 * set beside it — the same reason `decisions.ts` has one.
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
 * person did. This is the only entity whose content comes back as instruction, so
 * it is the only one whose consumer could not otherwise see who put it there.
 * ONE fact, not an account: the fuller reading (who proposed it too, and whether
 * both ends are the same agent) belongs where a person is looking at it.
 */

import {
  type ProjectionCache,
  SKILL_STATES,
  type SkillProjection,
  type SkillState,
} from '@mnema/core';
import { type Disposition, statesWith } from './disposition.js';

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
 *     is why "has a legal move" is the wrong criterion for the waiting list.
 *   - `rejected`, `deprecated` — terminal, no row leaves either.
 *
 * Exported so the claims above are CHECKABLE against the table they are read from,
 * rather than asserted in prose: `disposition.test.ts` cross-checks every row of
 * this against `SKILL_TRANSITIONS`. It is not on the package's public surface — a
 * consumer gets the two lists, not the classification behind them.
 */
export const SKILL_DISPOSITION: Readonly<Record<SkillState, Disposition>> = {
  proposed: 'awaiting-judgement',
  reviewed: 'awaiting-judgement',
  adopted: 'in-force',
  rejected: 'closed',
  deprecated: 'closed',
};

/** The states whose skills are live patterns — derived, never restated. */
const ADOPTED = statesWith(SKILL_STATES, SKILL_DISPOSITION, 'in-force');

/** The states whose skills are waiting on somebody — derived, never restated. */
const AWAITING_JUDGEMENT = statesWith(SKILL_STATES, SKILL_DISPOSITION, 'awaiting-judgement');

/**
 * Whether a projected state is one this module serves the body of.
 *
 * The projection stores `state` as a literal string on purpose — a fact written
 * today stays legible if the workflow later renames a state — so the comparison is
 * widened to strings rather than the set being narrowed. A state outside the
 * workflow's vocabulary is therefore not adopted, which is the honest answer: this
 * module knows what `adopted` means and nothing about a word it has never seen.
 */
function isAdopted(state: string): boolean {
  return (ADOPTED as readonly string[]).includes(state);
}

/** An adopted skill named but not spelled out — what an index is made of. */
export interface SkillRef {
  /** The skill's id — the key that asks for its body. */
  readonly id: string;
  /** The skill's short name — DISPLAY, and the trigger a reader recognizes. */
  readonly name: string;
}

/** An adopted skill with the pattern itself. */
export interface AdoptedSkill extends SkillRef {
  /** The reusable pattern — the whole point of having recorded the skill. */
  readonly body: string;
  /**
   * The agent that adopted it — the act that made this body something an agent is
   * served. ABSENT means a person adopted it directly, which is a fact about the
   * pattern and not a missing value.
   *
   * It travels WITH the body, in one line, because nothing else the consumer
   * receives says where the pattern came from: a task or a decision carries its
   * movers on the events a timeline shows, and a served body carried nothing. It
   * is provenance, not a verdict — the fuller account (who proposed it, whether
   * the two ends are one agent) is the command line's, where a person is reading.
   */
  readonly adoptedBy?: string;
}

/** Asking for one skill by id: served, present but not adopted, or absent. */
export type SkillLookup =
  /** Adopted here — the body is served. */
  | { readonly outcome: 'adopted'; readonly skill: AdoptedSkill }
  /**
   * A skill with this id exists, but it is not an adopted pattern. The state is
   * reported (never the body), so an agent holding a stale name learns what
   * happened to it rather than being told it never existed.
   */
  | { readonly outcome: 'not-adopted'; readonly state: string }
  /** No tree the caller can see holds a skill with this id. */
  | { readonly outcome: 'unknown' };

/**
 * Every adopted skill across `caches`, with its body, ordered by name (ties
 * broken by id). The order is a property of the CONTENT, not of the tree the
 * skill happens to live in, so adding a tree to the list — or reading them in a
 * different order — never reshuffles the answer. Callers put this in a prompt;
 * a stable order is what keeps the host's cache of that prefix valid.
 */
export function adoptedSkills(caches: readonly ProjectionCache[]): AdoptedSkill[] {
  const all: AdoptedSkill[] = [];
  for (const cache of caches) {
    for (const state of ADOPTED) {
      for (const skill of cache.listSkillsByState(state)) all.push(toAdopted(skill));
    }
  }
  return all.sort(byNameThenId);
}

/**
 * A pattern nobody has ruled on yet — a name, plus the state that says WHICH
 * ruling is missing.
 *
 * NO BODY, and that is the whole difference from {@link AdoptedSkill}. A body is
 * served as something to work by, and a pattern still under review is not one. No
 * agent-facing read serves this one's text either (see the module doc); a person
 * reads it with `mnema show <id>`. No provenance — `adoptedBy` is a fact about an
 * adoption that has not happened.
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
 * Looks one skill up by id across `caches`, reporting whether it is an adopted
 * pattern. The first tree that holds the id answers — an id is minted once and
 * lives in one tree, so there is no second holder to disagree.
 */
export function lookupAdoptedSkill(caches: readonly ProjectionCache[], id: string): SkillLookup {
  for (const cache of caches) {
    const skill = cache.getSkill(id);
    if (skill === null) continue;
    if (!isAdopted(skill.state)) return { outcome: 'not-adopted', state: skill.state };
    return { outcome: 'adopted', skill: toAdopted(skill) };
  }
  return { outcome: 'unknown' };
}

function toAdopted(skill: SkillProjection): AdoptedSkill {
  const adoptedBy = skill.adoption?.by;
  return {
    id: skill.id,
    name: skill.name,
    body: skill.body,
    ...(adoptedBy !== undefined ? { adoptedBy } : {}),
  };
}

function byNameThenId(a: SkillRef, b: SkillRef): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
