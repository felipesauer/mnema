/**
 * An agent ruling a decision in force — free, always on the record, always said, and with a
 * switch for whoever wants it shut.
 *
 * THE DECISION THIS FILE CARRIES, as the person who owns the product made it: *"the agent may
 * do that freely, keeping the record's trail and a notice to the user, and there could even be a
 * setting."* So an agent's `accept` is NOT refused by default and is NOT held for a person.
 * What the product owes instead is the three things the sentence names:
 *   - the trail: the accepting event's envelope already says which agent executed it, and the
 *     readings (`show`, `brief`, the console) say it from there — nothing is added to the
 *     record;
 *   - the notice: the tool's reply says the acceptance was recorded as an agent's (the CLI says
 *     it too, when an agent drives it with `--which`), and the document the next session opens
 *     with marks every rule an agent accepted (`presentation/brief.ts`);
 *   - the setting: `agent-accepts` is a channel like the others, a fact recorded by `mnema
 *     switch off agent-accepts`, and with it off an agent's accept is refused in words that
 *     say how to turn it back on and how a person accepts instead.
 *
 * WHO IS AN AGENT HERE is who the envelope says: an act with a `which` on it. Through the MCP
 * server that is every act (the server's `which` is the connecting client); through the command
 * line it is an act declared with `--which`. Whether the human at the keyboard typed what the
 * agent ran is a fact about the machine this product cannot see, and it does not pretend to.
 */

import { channelStates, type ScopedCache } from '@mnema/copilot';
import type { DecisionAction } from '@mnema/core';
import { oneLine } from './one-line.js';
import { AGENT_ACCEPTS_CHANNEL } from './record-framing.js';

/** The one action the switch is about, typed so a rename in the workflow does not leave it behind. */
const ACCEPT: DecisionAction = 'accept';

/** The code a refused acceptance carries. */
export const AGENT_ACCEPTS_IS_OFF = 'AGENT_ACCEPTS_IS_OFF';

/**
 * Whether `agent` may accept: `undefined` when it may, and the refusal's code and words when
 * the switch is off. A person (no agent) and every action other than `accept` are not asked —
 * the switch is about an agent ruling a decision in force and about nothing else it does.
 */
export function agentMayAccept(
  sources: readonly ScopedCache[],
  move: { readonly action: string; readonly agent: string | undefined },
): { readonly code: string; readonly message: string } | undefined {
  if (move.agent === undefined || move.action !== ACCEPT) return undefined;
  const state = channelStates(sources, [AGENT_ACCEPTS_CHANNEL])[0];
  if (state === undefined || state.on) return undefined;
  return {
    code: AGENT_ACCEPTS_IS_OFF,
    message:
      `an agent cannot accept a decision here: ${AGENT_ACCEPTS_CHANNEL} was switched off by ` +
      `${oneLine(state.by ?? '')} at ${oneLine(state.at ?? '')}. ` +
      'A person accepts it with `mnema decision move accept <id> --note "<why>"`, ' +
      'and `mnema switch on agent-accepts` lets an agent accept again. The decision was not moved.',
  };
}

/**
 * What an acceptance by an agent says about itself, in the reply to the agent that made it —
 * a statement of what is now true, which is also what a person reading the transcript needs.
 */
export function acceptedByAnAgent(agent: string): string {
  return (
    `This acceptance is recorded as made by an agent (${oneLine(agent)}), not by a person: ` +
    'the record keeps which agent executed it, `mnema show <id>` and the document a session ' +
    'opens with say so beside the rule, and the decision now governs as accepted. ' +
    'Whether agents may accept is a switch: `mnema switch off agent-accepts` stops it.'
  );
}
