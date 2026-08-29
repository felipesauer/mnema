/**
 * Where the product's own switches stand — the one reading whose subject is MNEMA and
 * not the work.
 *
 * ## What a switch is, and why the answer is not just a row
 *
 * A channel is a place this product puts the record in front of a model WITHOUT being
 * asked. Somebody may switch one off, and the tie behind that says the switching is
 * recorded: it is a signed, attributed, dated fact of the chain, which means it has a
 * SCOPE like every other fact — a switch committed to the repository is the team's, one
 * recorded privately is one machine's. So "is this channel off" is not a row lookup, it
 * is a question over the trees the caller can see, and the rule for folding them is what
 * this module owns.
 *
 * ## OFF WINS, and it is not a preference
 *
 * There is no total order across trees. An event's `at` is a clock on the machine that
 * wrote it, and two trees have no shared sequence to compare — the chain orders events
 * WITHIN a tail, and that is the whole of what it proves. So "the most recent switch
 * across the trees" is a comparison of two unordered things, and a product deciding
 * whether to speak by that comparison would decide differently on two machines whose
 * clocks disagree.
 *
 * What is left is a rule that needs no order, and there are two of them. OFF wins, or ON
 * wins. OFF wins here because of what each failure looks like: a switch somebody flipped
 * and that did not take effect is the product ignoring an instruction it recorded, in the
 * one place the tie exists to protect. The other direction is the product going quiet
 * because of a switch nobody meant — recoverable by switching it on, and visible in the
 * reading that says WHICH tree decided.
 *
 * It is the same direction {@link PushedRule.travels} takes for the same kind of reason:
 * when two readings of a tree cannot be ordered, answer with the one that cannot mislead.
 *
 * ## It answers about the channels it is ASKED about
 *
 * The vocabulary of channels lives in the surface that pushes them, downstream of this
 * package, so the caller names them and the answer is total over that set. Nothing here
 * can invent a channel and nothing here reports one the caller did not name — which is
 * what keeps a switch of some name nobody recognizes out of a document a person reads. A
 * record holding `channel.switched` for `xyzzy` is a fact the record holds and the audit
 * reads; it is not something a governance document announces.
 *
 * ## Every consumer reads it here
 *
 * Two channels consult this today — the document a session opens with, and the push
 * before a file is written — and they pass different sources: the document carries the
 * tree that TRAVELS and nothing else, the push carries every tree the session can see.
 * That is one function asked two questions, not two rules: the fold, the tie-break and
 * the meaning of an absence are decided once, here, and a consumer that narrowed the
 * sources narrowed what it is asking about and not how the answer is computed.
 */

import type { ChannelSwitchProjection, Scope } from '@mnema/core';
import type { ScopedCache } from '../sources.js';

/**
 * Where one channel stands, and what put it there.
 *
 * `on` is the answer; everything else is why, and is present only when a switch decided
 * it. A channel nothing ever switched comes back `{ channel, on: true }` and nothing
 * more — the absence of an attribution IS the fact that nobody switched it, and a
 * placeholder there would read as a switch somebody made.
 */
export interface ChannelState {
  /** The channel, as the caller named it. */
  readonly channel: string;
  /** Whether it is on — `true` when nothing switched it off in any tree given. */
  readonly on: boolean;
  /**
   * The anchor that switched it, when a switch decided this state. Absent when the
   * channel is on because nothing ever switched it.
   */
  readonly by?: string;
  /** The executing agent that switched it, when an agent was driving. */
  readonly which?: string;
  /** When that switch happened. */
  readonly at?: string;
  /** Why, when the switch carried a reason. */
  readonly reason?: string;
  /**
   * Whether the tree that decided this state TRAVELS — whether a clone of the
   * repository holds the switch.
   *
   * It is the fact a reader needs to know whether a teammate sees the same thing. False
   * says the switch is on this machine or in this person's own tree and nowhere else,
   * which is exactly the case a committed document cannot report.
   */
  readonly travels?: boolean;
}

/**
 * The one tree whose facts a clone of the repository gets — the same scope
 * `context/brief.ts` composes its document out of, named here because
 * {@link ChannelState.travels} is a claim about that and not about a preference.
 */
const TRAVELS_TO_A_CLONE: Scope = 'public';

/**
 * Where each of `channels` stands across the trees of `sources` — one answer per
 * channel asked about, in the order they were asked.
 *
 * ON is the answer for a channel no tree ever switched, and it is the product's default
 * rather than this function's convention: nothing arrives switched off. A single tree
 * saying OFF makes it off, for the reason the module note gives.
 */
export function channelStates(
  sources: readonly ScopedCache[],
  channels: readonly string[],
): readonly ChannelState[] {
  return channels.map((channel) => stateOf(sources, channel));
}

/**
 * One channel's state: the OFF switch of some tree if any tree holds one, else on.
 *
 * When more than one tree says off, the tie-break is by CONTENT — the earliest instant,
 * then the anchor — and never by the order the sources were opened. A reading whose
 * answer depended on that order could not be compared between two runs, and one of its
 * consumers is a document whose whole worth is that the same record prints the same
 * bytes.
 */
function stateOf(sources: readonly ScopedCache[], channel: string): ChannelState {
  const off: { readonly source: ScopedCache; readonly row: ChannelSwitchProjection }[] = [];
  for (const source of sources) {
    const row = source.cache.channelSwitch(channel);
    // No row is "never switched here", which says nothing about the other trees; a row
    // whose last switch turned it ON says this tree wants it on, which also says nothing
    // — one tree cannot switch a channel back on for another.
    if (row !== null && !row.on) off.push({ source, row });
  }
  if (off.length === 0) return { channel, on: true };
  const decided = off.sort(earliestSwitchOffFirst)[0] as {
    readonly source: ScopedCache;
    readonly row: ChannelSwitchProjection;
  };
  return {
    channel,
    on: false,
    by: decided.row.who,
    ...(decided.row.which !== undefined ? { which: decided.row.which } : {}),
    at: decided.row.switchedAt,
    ...(decided.row.reason !== undefined ? { reason: decided.row.reason } : {}),
    travels: decided.source.scope === TRAVELS_TO_A_CLONE,
  };
}

/**
 * The switch-off that answers for a channel: earliest instant first, ties broken by who
 * — oldest first, which is the opposite of the record's `newestFirst` and is deliberate.
 *
 * A channel is off because SOMEONE turned it off, and the answer names the switch that
 * did it, so the FIRST one is the one that holds; a later tree turning the same channel
 * off again did not decide anything. Written as a named comparator rather than inline at
 * the call because `one-rule-for-newest-first.test.ts` requires every ordering over an
 * instant to carry a name it can classify.
 */
function earliestSwitchOffFirst(
  a: { readonly row: ChannelSwitchProjection },
  b: { readonly row: ChannelSwitchProjection },
): number {
  return compare(a.row.switchedAt, b.row.switchedAt) || compare(a.row.who, b.row.who);
}

/**
 * Whether `channel` may speak, given `sources` — the one question a pushing channel asks
 * before it composes anything.
 *
 * It is {@link channelStates} asked about one channel, not a second reading of the rule:
 * a channel that decided for itself whether a switch applies is a channel that comes to
 * disagree with the document telling a reader what to expect.
 */
export function channelIsOn(sources: readonly ScopedCache[], channel: string): boolean {
  return stateOf(sources, channel).on;
}

/** String order, as a number, so two keys can be tried in sequence. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
