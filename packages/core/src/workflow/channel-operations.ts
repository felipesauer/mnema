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

import { channelAsked, channelServed, channelSwitched } from '@mnema/chain';
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

/**
 * What a channel recorded about ITSELF: it served, or it asked for a person.
 *
 * These two writes sit beside {@link switchChannel} because they are facts under the same
 * subject — a channel's own history holds what was done to it and what it did — and they
 * differ from it in one way that matters: nobody asks for them. A person switches a
 * channel; the PRODUCT records that a channel served and that it asked. So there is no
 * verb behind either, no `--reason` to compose, and no surface that lets a caller assert
 * one: the only producer is the push itself, which is what makes the rule id in an asking
 * a value that came out of the record rather than out of a caller.
 *
 * WHY THE ASKING IS WRITTEN BEFORE THE HOST IS ANSWERED, and it is the sharpest rule
 * here. A charge that is not in the record is the product acting outside its own record —
 * so the fact is appended FIRST, and the reply that stops somebody's edit is composed
 * only if it landed. It is the order a waiver already has with the cut it authorizes
 * (`unprovenWaiverReason`), and it makes the failure fall the safe way: a record that
 * cannot be written charges nothing, which is the direction that cannot trap somebody
 * else's work.
 */

/** The service was recorded: this channel was live in this run. */
export interface ServedOk extends ScreenedWrite {
  readonly ok: true;
  /** The channel that served — the event's subject, as it was recorded. */
  readonly channel: string;
}

/** The asking was recorded: this rule stopped a write at this path. */
export interface AskedOk extends ScreenedWrite {
  readonly ok: true;
  /** The channel that asked — the event's subject, as it was recorded. */
  readonly channel: string;
  /** The rule the charge cites, as it was recorded. */
  readonly rule: string;
}

/** The refusals either can earn — the ones every fact can, and nothing of their own. */
export type ChannelFactError = SelfAuthorizedErr | ContentTooLargeErr | UnreadableEventErr;

/** What the caller records: which channel, in which run, driven by which agent. */
export interface ServedInput {
  /** The channel that served, as the pushing surface names it. */
  readonly channel: string;
  /** The agent that executed it, if any. `who` is derived from the writer's key. */
  readonly which?: string;
  /** The run this belongs to, if any. */
  readonly run?: string;
}

/** What the caller records about one asking. */
export interface AskedInput extends ServedInput {
  /**
   * The id of the rule that asked. NOT screened, and that is the one departure from the
   * door's habit in this file: it is an id the derivation of what is in force produced, so
   * it came out of the record, and a scrubber would read a v7 as entropy and destroy the
   * one field a charge is required to carry. The classification says so
   * (`content/fields.ts`), and what keeps it true is that nothing but the push writes this.
   */
  readonly rule: string;
  /** The path the asking was about, as the surface compared it. A caller's string. */
  readonly path: string;
}

/**
 * Records that a channel served in this run: appends the single `channel.served` whose
 * subject IS the channel.
 *
 * The caller decides WHETHER to write one — once per run and per channel is the rule, and
 * it belongs to the surface that knows what a session already recorded, not here. This
 * appends whatever it is asked to, exactly as switching does.
 */
export function recordChannelServed(
  ctx: WriteContext,
  input: ServedInput,
): ServedOk | ChannelFactError {
  const content = screenContent({ channel: input.channel, run: input.run });
  if (!content.ok) return content;

  const who = authorizingAnchor(ctx);
  const agent = resolveExecutingAgent(who, input.which);
  if (!agent.ok) return agent;

  ensureFounded(ctx);
  const appended = appendEvent(
    ctx.writer,
    channelServed({
      at: (ctx.clock ?? systemClock)(),
      who,
      signerFp: ctx.writer.signerFingerprint,
      subject: content.fields.channel,
      ...(agent.which !== undefined ? { which: agent.which } : {}),
      ...(content.fields.run !== undefined ? { run: content.fields.run } : {}),
    }),
  );
  if (!appended.ok) return appended;
  return {
    ok: true,
    channel: content.fields.channel,
    ...screened([...content.replaced, ...agent.replaced]),
  };
}

/**
 * Records that a channel asked for a person: appends the single `channel.asked` whose
 * subject IS the channel and whose payload cites the rule.
 *
 * The channel and the path are screened; the rule is not, for the reason
 * {@link AskedInput.rule} gives. The SCREENED path is what reaches the chain, and a path
 * that came back replaced is recorded replaced rather than dropped: what the fact is for is
 * that the asking happened and which rule caused it, and both survive a scrubbed path.
 */
export function recordChannelAsked(
  ctx: WriteContext,
  input: AskedInput,
): AskedOk | ChannelFactError {
  const content = screenContent({
    channel: input.channel,
    path: input.path,
    run: input.run,
  });
  if (!content.ok) return content;

  const who = authorizingAnchor(ctx);
  const agent = resolveExecutingAgent(who, input.which);
  if (!agent.ok) return agent;

  ensureFounded(ctx);
  const appended = appendEvent(
    ctx.writer,
    channelAsked(
      {
        at: (ctx.clock ?? systemClock)(),
        who,
        signerFp: ctx.writer.signerFingerprint,
        subject: content.fields.channel,
        ...(agent.which !== undefined ? { which: agent.which } : {}),
        ...(content.fields.run !== undefined ? { run: content.fields.run } : {}),
      },
      { rule: input.rule, path: content.fields.path },
    ),
  );
  if (!appended.ok) return appended;
  return {
    ok: true,
    channel: content.fields.channel,
    rule: input.rule,
    ...screened([...content.replaced, ...agent.replaced]),
  };
}
