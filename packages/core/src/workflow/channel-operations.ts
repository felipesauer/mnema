/**
 * Switching a channel: the one write whose subject is this product's own behaviour.
 *
 * WHAT IT IS FOR. The tie behind it reads: every charge mnema makes is switchable, and
 * the switching is recorded — switching off is legitimate, switching off in SILENCE is
 * not. This is the second half. A configuration file or an environment variable answers
 * the first half and defeats the second: neither is attributed, neither is dated, neither
 * travels, and a reader of the record could never tell "no rule addressed that file" from
 * "somebody had turned the push off that week".
 *
 * IT IS A FACT AND NOT A GATE, so it has the shape of the knowledge writes rather than of
 * a transition: one append, no gate, no prior state to check. There is deliberately no
 * "already off" refusal — switching off a channel that is already off is a person saying
 * so again, and the record is a log of what people did, not a store to be kept minimal.
 * Reading the position is the last event's job ({@link projectChannelSwitches}), and it
 * gives the same answer either way.
 *
 * IT DOES NOT KNOW WHICH CHANNELS EXIST, and that is the boundary rather than a gap. A
 * channel is a place the SURFACE puts the record in front of a model unasked, and the
 * vocabulary of those places lives with that surface (`code/src/record-framing.ts`) —
 * this package has no idea the product injects anything at all. So the caller names the
 * channel and the surface is what refuses a name no channel answers to. What that costs
 * is written where the subject is classified (`content/fields.ts`): the channel is a
 * caller's string, so it goes through the content door like every other one, and a
 * screened name matches nothing rather than switching something else.
 *
 * IT IS NOT PERMISSION, exactly as authorizing a cut is not. Anyone who can write to this
 * record can switch any channel of it, because anyone who can write can record any fact —
 * the declaration is signed and attributed, so a switch somebody objects to is a fact that
 * points at whoever made it. What the SURFACE decides is narrower and is decided there:
 * this write has no counterpart on the MCP server, so an agent cannot switch off what
 * governs its own work through the door built for it.
 *
 * WHICH TREE is not decided here either — the caller opens the tree for the resolved scope
 * and hands the writer in. The default is PUBLIC (`topology/routing.ts`), so the ordinary
 * switch travels with the repository and the team reads it; `--scope private` is a switch
 * that means one machine, and the cost of that choice is that a committed document cannot
 * carry it.
 */

import { channelSwitched } from '@mnema/chain';
import {
  type ContentTooLargeErr,
  type ScreenedWrite,
  screenContent,
  screened,
} from '../content/screen.js';
import { resolveExecutingAgent, type SelfAuthorizedErr } from '../identity/authority.js';
import { appendEvent, type UnreadableEventErr } from './append.js';
import { systemClock } from './clock.js';
import { authorizingAnchor, ensureFounded } from './identity-operations.js';
import type { WriteContext } from './operations.js';

/** The switch was recorded: the channel now stands where this fact says. */
export interface SwitchOk extends ScreenedWrite {
  readonly ok: true;
  /** The channel that was switched — the event's subject, as it was recorded. */
  readonly channel: string;
  /** Where it now stands: `true` on, `false` off. */
  readonly on: boolean;
}

/**
 * The refusals switching a channel can earn — the two every fact can, and nothing of
 * its own.
 *
 * There is no refusal for a channel this package does not know, because it knows none
 * (see the module note), and none for switching a channel to where it already stands.
 */
export type SwitchError = SelfAuthorizedErr | ContentTooLargeErr | UnreadableEventErr;

/** What the caller asks to switch. */
export interface SwitchInput {
  /** The channel to switch, as the pushing surface names it. */
  readonly channel: string;
  /** Where to put it: `true` on, `false` off. */
  readonly on: boolean;
  /**
   * Why, when the caller said why. Never required: what the tie asks for is the FACT —
   * who switched what, and when — and a product that refused to be switched off without
   * composing prose would be charging for the switch.
   */
  readonly reason?: string;
  /** The agent that executed it, if any. `who` is derived from the writer's key. */
  readonly which?: string;
  /** The run this belongs to, if any. */
  readonly run?: string;
}

/**
 * Records that a channel was switched: appends the single `channel.switched` whose
 * subject IS the channel.
 *
 * The channel name and the reason are screened together with the pinned run, and the
 * SCREENED channel is what reaches the chain — never `input.channel`. That is the door's
 * own rule and it is not softened for a value that will be looked up: a name that came
 * back replaced switches something no surface asks about, which leaves the product
 * speaking, and the caller is told what was replaced.
 */
export function switchChannel(ctx: WriteContext, input: SwitchInput): SwitchOk | SwitchError {
  const content = screenContent({
    channel: input.channel,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    run: input.run,
  });
  if (!content.ok) return content;

  const who = authorizingAnchor(ctx);
  const agent = resolveExecutingAgent(who, input.which);
  if (!agent.ok) return agent;
  const which = agent.which;

  ensureFounded(ctx);
  const appended = appendEvent(
    ctx.writer,
    channelSwitched(
      {
        at: (ctx.clock ?? systemClock)(),
        who,
        signerFp: ctx.writer.signerFingerprint,
        subject: content.fields.channel,
        ...(which !== undefined ? { which } : {}),
        ...(content.fields.run !== undefined ? { run: content.fields.run } : {}),
      },
      {
        on: input.on,
        ...(content.fields.reason !== undefined ? { reason: content.fields.reason } : {}),
      },
    ),
  );
  if (!appended.ok) return appended;
  return {
    ok: true,
    channel: content.fields.channel,
    on: input.on,
    ...screened([...content.replaced, ...agent.replaced]),
  };
}
