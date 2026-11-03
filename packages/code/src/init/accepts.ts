/**
 * WHAT A FOUNDING RECORDS ABOUT AGENTS ACCEPTING: the answer to the question `mnema init` asks, written in
 * the record's public tree, as the person's decision or as an agent's proposal.
 *
 * THE ANSWER IS A DECISION, AND WHOSE IT IS DEPENDS ON WHO GAVE IT. A person at the terminal, or typing
 * `--accepts` themselves, decides: the decision is recorded and accepted with the person's own key, with a
 * note that quotes what they answered. An agent that runs `mnema init --which <agent> --accepts yes` is
 * deciding the extent of its own authority, and a decision signed as the person's would put its answer in
 * the person's mouth: so it is recorded as the agent's PROPOSAL, and waits for the person
 * (`mnema decision review`). The product's default (agents may accept what the person chooses) holds
 * either way and writes nothing: only an answer that is not the default does anything more than a
 * decision says.
 *
 * `no` IS A DECISION AND A SWITCH. A decision that says agents may not accept, beside an acceptance an
 * agent is still free to make, would be a sentence the product does not keep; the switch that already
 * refuses an agent's `accept` (`agent-accepts.ts`) is what makes it so, and it is recorded with the
 * decision, as the person's. An agent's `no` records the proposal only: an agent does not close its own
 * permission on the person's behalf, either.
 *
 * NOTHING HERE IS CHANGED BY `--yes`, which answers no question about this: it is not recorded, and the
 * summary says it was not asked (`wiring/init.ts`).
 */

import type { DiscoveryEnv } from '@mnema/core';
import { runDecision } from '../commands/decision.js';
import { runDecisionTransition } from '../commands/decision-transition.js';
import { runSwitch } from '../commands/switch.js';
import type { Accepts } from './plan.js';
import { ACCEPTS_OPTIONS } from './screens.js';

/** Where the answer is recorded, and who runs the verb. */
export interface WhoMayAcceptContext {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
}

/** How the person gave the answer: on the screen, or as a flag. */
export type GivenBy = 'screen' | 'flag';

/** The decision a `yes` is. */
const YES = {
  title: 'Agents may accept the decisions the person chooses',
  rationale:
    'Answered when the project was founded with `mnema init`. An agent that records an option the person picked among the ones it offered, or a choice the person dictated, may accept it at once, quoting their answer in the note; what an agent proposes on its own waits for the person (`mnema decision review`). `mnema switch off agent-accepts` turns the permission off.',
  alternatives:
    'Every decision stays proposed until a person accepts it: not chosen at the founding, and `mnema switch off agent-accepts` makes it so at any time.',
} as const;

/** The decision a `no` is. */
const NO = {
  title: 'Every decision waits for a person to accept it',
  rationale:
    'Answered when the project was founded with `mnema init`, with the switch agent-accepts off: an agent records a decision as proposed and a person accepts it (`mnema decision review`), and an agent’s own accept is refused. `mnema switch on agent-accepts` turns the permission back on.',
  alternatives:
    'Agents may accept what the person chooses: not chosen at the founding, and `mnema switch on agent-accepts` makes it so at any time.',
} as const;

/** What an agent's proposal says on top of the decision's own rationale. */
const PROPOSED_BY_AN_AGENT =
  ' Proposed by an agent that ran `mnema init` with `--accepts`: it is the agent’s answer and not the person’s, and it waits for the person.';

/** What was recorded. */
export interface WhoMayAcceptRecorded {
  readonly ok: true;
  /** The decision's citable label. */
  readonly adr: string;
  /** Whether it is the person's, accepted, or the agent's proposal, waiting. */
  readonly as: 'accepted' | 'proposed';
  /** Whether the switch was turned off as well. */
  readonly switchedOff: boolean;
}

/** The record refused, and why, in the words the refusing operation used. */
export interface WhoMayAcceptRefused {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

/**
 * Records the answer. `agent` is the executing agent where one gave it (`--which`, or the key an agent
 * runs under); absent is the person.
 */
export function recordWhoMayAccept(
  ctx: WhoMayAcceptContext,
  answer: Accepts,
  by: { readonly agent?: string; readonly given: GivenBy; readonly run?: string },
): WhoMayAcceptRecorded | WhoMayAcceptRefused {
  const text = answer === 'yes' ? YES : NO;
  const agent = by.agent;
  const recorded = runDecision(ctx, {
    title: text.title,
    rationale: agent === undefined ? text.rationale : `${text.rationale}${PROPOSED_BY_AN_AGENT}`,
    alternatives: text.alternatives,
    scope: 'public',
    ...(agent !== undefined ? { which: agent } : {}),
    ...(by.run !== undefined ? { run: by.run } : {}),
  });
  if (!recorded.ok) {
    return recorded.reason === 'REFUSED'
      ? { ok: false, code: recorded.code, message: recorded.message }
      : { ok: false, code: recorded.reason, message: 'there is no project here to record in' };
  }
  if (agent !== undefined) {
    return { ok: true, adr: recorded.adr, as: 'proposed', switchedOff: false };
  }
  const option = ACCEPTS_OPTIONS.find((each) => each.word === answer)?.description ?? answer;
  const said =
    by.given === 'screen'
      ? `The person answered "${option}" when the project was founded.`
      : `The person gave --accepts ${answer} to mnema init when the project was founded.`;
  const accepted = runDecisionTransition(ctx, {
    id: recorded.id,
    action: 'accept',
    proof: { note: said },
    ...(by.run !== undefined ? { run: by.run } : {}),
  });
  if (!accepted.ok) {
    return accepted.reason === 'REFUSED'
      ? { ok: false, code: accepted.code, message: accepted.message }
      : { ok: false, code: accepted.reason, message: 'the decision could not be accepted' };
  }
  if (answer === 'yes') return { ok: true, adr: recorded.adr, as: 'accepted', switchedOff: false };
  const switched = runSwitch(ctx, {
    channel: 'agent-accepts',
    on: false,
    reason: said,
    scope: 'public',
    ...(by.run !== undefined ? { run: by.run } : {}),
  });
  if (!switched.ok) {
    return switched.reason === 'REFUSED'
      ? { ok: false, code: switched.code, message: switched.message }
      : { ok: false, code: switched.reason, message: 'the switch could not be recorded' };
  }
  return { ok: true, adr: recorded.adr, as: 'accepted', switchedOff: true };
}
