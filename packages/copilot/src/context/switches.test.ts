/**
 * The fold of a switch across trees: OFF wins, the tie is broken by CONTENT, and an
 * absence is the answer that nobody switched it.
 *
 * WHY IT IS A FOLD AND NOT A ROW LOOKUP: a switch is a signed, attributed, dated fact of
 * the chain, so it has a SCOPE — one committed to the repository is the team's, one
 * recorded privately is one machine's — and there is no total order between two trees to
 * ask which switch is the latest. Every case here therefore holds TWO sources, except the
 * ones whose subject IS a single tree; a case with one source only ever walks the ON path
 * that any test opening a document already walks, and asserts nothing about the rule.
 *
 * The instants and the anchors are written by the bench helper, at values the caller
 * chooses, because a tie-break is only testable if a tie can be built: two trees that
 * cannot be given one `switchedAt` cannot be asked which of them decided.
 */

import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { type Bench, makeBench, switchChannel } from '../../tests/support/chain.js';
import type { ScopedCache } from '../sources.js';
import { channelIsOn, channelStates } from './switches.js';

/**
 * The channel these cases ask about, as a LITERAL and not the constant the surface
 * exports: this package cannot reach that vocabulary, and what is being checked is that
 * the fold answers about the channel it was HANDED.
 */
const CHANNEL = 'edit-rules-push';

/**
 * Two anchors in the shape the product mints, ordered so the second key of the tie-break
 * has a direction a case can name. `EARLIER_ANCHOR` sorts first as a string.
 */
const EARLIER_ANCHOR = 'mnid:1111111111111111111111111111aaaa';
const LATER_ANCHOR = 'mnid:9999999999999999999999999999ffff';

/** Two instants a case can hand two trees, in a stated order. */
const EARLIER = '2026-02-01T00:00:00.000Z';
const LATER = '2026-03-01T00:00:00.000Z';

describe('channelStates — where a switch stands across the trees a caller can see', () => {
  let benches: Bench[] = [];
  let open: ScopedCache[] = [];
  afterEach(() => {
    for (const source of open) source.cache.close();
    for (const b of benches) rmSync(b.root, { recursive: true, force: true });
    open = [];
    benches = [];
  });

  function bench(): Bench {
    const b = makeBench();
    benches.push(b);
    return b;
  }

  function source(b: Bench, scope: ScopedCache['scope'] = 'public'): ScopedCache {
    const s: ScopedCache = { scope, chainRoot: b.root, cache: b.cache() };
    open.push(s);
    return s;
  }

  it('a channel no tree ever switched comes back on, and carries NOTHING else', () => {
    // The absence of an attribution IS the fact that nobody switched it. A placeholder
    // there — a `by`, an `at`, a `travels: false` — would read as a switch somebody made,
    // so the comparison is over the whole object and not over `on`.
    const team = bench();
    const mine = bench();

    expect(channelStates([source(team), source(mine, 'private')], [CHANNEL])).toEqual([
      { channel: CHANNEL, on: true },
    ]);
  });

  it('one tree saying off makes it off, and names the switch that did it', () => {
    const team = bench();
    const mine = bench();
    switchChannel(team, CHANNEL, false, {
      at: EARLIER,
      who: EARLIER_ANCHOR,
      which: 'claude',
      reason: 'too noisy',
    });

    expect(channelStates([source(team), source(mine, 'private')], [CHANNEL])).toEqual([
      {
        channel: CHANNEL,
        on: false,
        by: EARLIER_ANCHOR,
        which: 'claude',
        at: EARLIER,
        reason: 'too noisy',
        travels: true,
      },
    ]);
  });

  it('a switch with no agent and no reason carries neither key', () => {
    // A person switching it directly leaves no `which`, and a switch with no stated
    // reason leaves no `reason`; the answer says so by having no key rather than an
    // empty one.
    const team = bench();
    const mine = bench();
    switchChannel(team, CHANNEL, false, { at: EARLIER, who: EARLIER_ANCHOR });

    expect(channelStates([source(team), source(mine, 'private')], [CHANNEL])).toEqual([
      { channel: CHANNEL, on: false, by: EARLIER_ANCHOR, at: EARLIER, travels: true },
    ]);
  });

  it('a tree whose last switch turned it ON says nothing about the other trees', () => {
    // One tree cannot switch a channel back on for another, so an ON row is not a vote:
    // the OFF in the second tree still decides, and the answer names IT.
    const team = bench();
    const mine = bench();
    switchChannel(team, CHANNEL, true, { at: LATER, who: LATER_ANCHOR });
    switchChannel(mine, CHANNEL, false, { at: EARLIER, who: EARLIER_ANCHOR });

    expect(channelStates([source(team), source(mine, 'private')], [CHANNEL])).toEqual([
      { channel: CHANNEL, on: false, by: EARLIER_ANCHOR, at: EARLIER, travels: false },
    ]);
  });

  it('a tree that switched it off and on again is a tree that says nothing', () => {
    // Within ONE tail the chain does order the facts, so the last switch is that tree's
    // position; the fold reads a position and never a history.
    const team = bench();
    const mine = bench();
    switchChannel(team, CHANNEL, false, { at: EARLIER, who: EARLIER_ANCHOR });
    switchChannel(team, CHANNEL, true, { at: LATER, who: EARLIER_ANCHOR });

    expect(channelStates([source(team), source(mine, 'private')], [CHANNEL])).toEqual([
      { channel: CHANNEL, on: true },
    ]);
  });

  it('two trees saying off: the EARLIEST switch decided, in either source order', () => {
    // The answer names the switch that turned it off, so the first one holds; a later
    // tree turning the same channel off again decided nothing. Asked in both orders
    // because an answer that depended on the order the sources were opened could not be
    // compared between two runs — and one consumer of this is a document whose whole
    // worth is that the same record prints the same bytes.
    const first = bench();
    const second = bench();
    switchChannel(first, CHANNEL, false, { at: EARLIER, who: EARLIER_ANCHOR });
    switchChannel(second, CHANNEL, false, { at: LATER, who: LATER_ANCHOR });
    const a = source(first);
    const b = source(second, 'private');

    expect(channelStates([a, b], [CHANNEL])[0]).toMatchObject({ at: EARLIER, by: EARLIER_ANCHOR });
    expect(channelStates([b, a], [CHANNEL])[0]).toMatchObject({ at: EARLIER, by: EARLIER_ANCHOR });
  });

  it('two trees saying off at the SAME instant: the anchor breaks the tie, in either order', () => {
    // Two machines whose clocks agree to the millisecond is one script run twice, and
    // the second key has to be content too — falling back to the order the sources were
    // opened is the thing the tie-break exists to avoid.
    const first = bench();
    const second = bench();
    switchChannel(first, CHANNEL, false, { at: EARLIER, who: LATER_ANCHOR });
    switchChannel(second, CHANNEL, false, { at: EARLIER, who: EARLIER_ANCHOR });
    const a = source(first);
    const b = source(second, 'private');

    expect(channelStates([a, b], [CHANNEL])[0]).toMatchObject({ by: EARLIER_ANCHOR });
    expect(channelStates([b, a], [CHANNEL])[0]).toMatchObject({ by: EARLIER_ANCHOR });
  });

  it('travels is the scope of the tree that DECIDED, not of any tree that said off', () => {
    // Both cases hold one public and one private tree saying off. What changes is which
    // of them the tie-break picked, and `travels` follows THAT one — the fact a reader
    // needs to know whether a teammate sees the same thing.
    const team = bench();
    const mine = bench();
    switchChannel(team, CHANNEL, false, { at: EARLIER, who: EARLIER_ANCHOR });
    switchChannel(mine, CHANNEL, false, { at: LATER, who: LATER_ANCHOR });

    expect(channelStates([source(team), source(mine, 'private')], [CHANNEL])[0]).toMatchObject({
      by: EARLIER_ANCHOR,
      travels: true,
    });

    const teamLate = bench();
    const mineEarly = bench();
    switchChannel(teamLate, CHANNEL, false, { at: LATER, who: LATER_ANCHOR });
    switchChannel(mineEarly, CHANNEL, false, { at: EARLIER, who: EARLIER_ANCHOR });

    expect(
      channelStates([source(teamLate), source(mineEarly, 'private')], [CHANNEL])[0],
    ).toMatchObject({ by: EARLIER_ANCHOR, travels: false });
  });

  it('answers one state per channel asked, in the order asked, and about no other', () => {
    // The vocabulary is the caller's: a switch of a name nobody recognizes is a fact the
    // record holds and the audit reads, and it is not something this answer announces.
    const team = bench();
    switchChannel(team, 'edit-asks-a-person', false, { at: EARLIER, who: EARLIER_ANCHOR });
    switchChannel(team, 'xyzzy', false, { at: EARLIER, who: EARLIER_ANCHOR });

    expect(channelStates([source(team)], ['edit-asks-a-person', CHANNEL])).toEqual([
      {
        channel: 'edit-asks-a-person',
        on: false,
        by: EARLIER_ANCHOR,
        at: EARLIER,
        travels: true,
      },
      { channel: CHANNEL, on: true },
    ]);
  });

  it('answers nothing at all when no channel was asked about', () => {
    const team = bench();
    switchChannel(team, CHANNEL, false, { at: EARLIER, who: EARLIER_ANCHOR });

    expect(channelStates([source(team)], [])).toEqual([]);
  });
});

describe('channelIsOn — the same reading, asked about one channel', () => {
  let benches: Bench[] = [];
  let open: ScopedCache[] = [];
  afterEach(() => {
    for (const source of open) source.cache.close();
    for (const b of benches) rmSync(b.root, { recursive: true, force: true });
    open = [];
    benches = [];
  });

  function bench(): Bench {
    const b = makeBench();
    benches.push(b);
    return b;
  }

  function source(b: Bench, scope: ScopedCache['scope'] = 'public'): ScopedCache {
    const s: ScopedCache = { scope, chainRoot: b.root, cache: b.cache() };
    open.push(s);
    return s;
  }

  it('is the `on` of the state, for a channel switched off in one of two trees', () => {
    // A pushing channel that decided for itself whether a switch applies is a channel
    // that comes to disagree with the document telling a reader what to expect — so the
    // case asserts the AGREEMENT and not just the boolean.
    const team = bench();
    const mine = bench();
    switchChannel(mine, CHANNEL, false, { at: EARLIER, who: EARLIER_ANCHOR });
    const sources = [source(team), source(mine, 'private')];

    expect(channelIsOn(sources, CHANNEL)).toBe(false);
    expect(channelIsOn(sources, CHANNEL)).toBe(channelStates(sources, [CHANNEL])[0]?.on);
  });

  it('is on for a channel no tree switched, and agrees with the state there too', () => {
    const team = bench();
    const mine = bench();
    switchChannel(team, 'some-other-channel', false, { at: EARLIER, who: EARLIER_ANCHOR });
    const sources = [source(team), source(mine, 'private')];

    expect(channelIsOn(sources, CHANNEL)).toBe(true);
    expect(channelIsOn(sources, CHANNEL)).toBe(channelStates(sources, [CHANNEL])[0]?.on);
  });
});
