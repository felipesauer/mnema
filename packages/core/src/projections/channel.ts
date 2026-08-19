/**
 * The channel projection: fold an ordered event stream into where each of this
 * product's own switches stands.
 *
 * A switch is not a workflow entity and it is not a point-in-time fact either, which
 * makes it the third shape in this directory. Like a task it has a CURRENT position
 * derived from a series of events; unlike a task there is no gate, no birth pair and no
 * vocabulary of actions — the position is the `on` of the last `channel.switched` for
 * that channel, and that one rule reads it without consulting anything else. The rule is
 * the tasks' own ("current state is the `to` of the last transition") with the workflow
 * taken out of it.
 *
 * A CHANNEL WITH NO EVENT IS NOT A ROW, and that absence is the whole default. There is
 * no birth, so a projection this fold never saw means the channel was never switched,
 * which means it is ON. A reader asking about a channel gets `null` and has to say what
 * `null` means; that it means ON is written where the readings are ({@link
 * ChannelSwitchProjection}), once, so no consumer decides it a second time.
 *
 * WHAT IT DOES NOT DO IS JUDGE THE NAME. The channels this product actually pushes are
 * named in the surface that pushes them, three packages away, and nothing here can reach
 * that vocabulary. So a switch of a channel no surface knows is projected exactly like
 * any other and simply matches nothing when a channel asks about itself — the fold
 * replays what the chain says and never decides what deserved to be written.
 */

import type { CatalogEvent } from '@mnema/chain';

/**
 * Where one channel's switch stands, as projected from the last event that moved it.
 *
 * There is no row at all for a channel nothing ever switched, so every consumer reads
 * an absence as ON. That is stated here rather than at each of them because it is the
 * product's default and not a query's convention: nothing arrives switched off.
 */
export interface ChannelSwitchProjection {
  /** The channel (the event subject) — the name the pushing surface knows it by. */
  readonly channel: string;
  /** Its position after the last switch: `true` on, `false` off. */
  readonly on: boolean;
  /** The anchor that switched it (the authorizing `who`). */
  readonly who: string;
  /** The executing agent that switched it, when an agent was driving. */
  readonly which?: string;
  /** `at` of that switch. */
  readonly switchedAt: string;
  /** Why, when the switch carried a reason. */
  readonly reason?: string;
}

/**
 * Folds ordered events into a map of channel → where its switch stands, keeping ONLY
 * `channel.switched`.
 *
 * Last seen wins, and here that is the rule rather than an unreachable fallback: a
 * channel is switched off and on again as often as somebody likes, and every one of
 * those is a distinct event under the same subject. The stream arrives in the record's
 * own order, so "last" is the chain's answer and not a comparison this fold makes.
 */
export function projectChannelSwitches(
  events: readonly CatalogEvent[],
): Map<string, ChannelSwitchProjection> {
  const result = new Map<string, ChannelSwitchProjection>();
  for (const event of events) {
    if (event.kind !== 'channel.switched') continue;
    result.set(event.subject, {
      channel: event.subject,
      on: event.payload.on,
      who: event.who,
      ...(event.which !== undefined ? { which: event.which } : {}),
      switchedAt: event.at,
      ...(event.payload.reason !== undefined ? { reason: event.payload.reason } : {}),
    });
  }
  return result;
}
