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
import { isAnchorId } from '@mnema/core';
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
 *
 * THE WIDTH WAS WRONG, AND IS NOW CHECKED RATHER THAN CLAIMED. These were first written
 * with THIRTY-TWO hex, under a premise this comment stated in those words. An anchor is
 * `mnid:` and SIXTY-FOUR, and `isAnchorId` — the predicate the surface itself resolves a
 * typed anchor with — answered `false` for both of them.
 *
 * Nothing here asserted any less for it, and that is the point: this fold never reads the
 * width of a `who`, it only orders two of them, so a fixture could carry a value no record
 * could ever hold and every case would stay green over a world that cannot exist. What
 * falsified the premise is `isAnchorId` run on the two values; what keeps it falsifiable is
 * the case below, which runs it again on every anchor this file writes.
 */
const EARLIER_ANCHOR = `mnid:${'1'.repeat(60)}aaaa`;
const LATER_ANCHOR = `mnid:${'9'.repeat(60)}ffff`;

/** Two instants a case can hand two trees, in a stated order. */
const EARLIER = '2026-02-01T00:00:00.000Z';
const LATER = '2026-03-01T00:00:00.000Z';

describe('the anchors these cases hand the fold are anchors the product could have minted', () => {
  it('is asked of the predicate the surface resolves a typed anchor with', () => {
    // The fold under test never reads the WIDTH of a `who` — it only orders two of them —
    // so a fixture carrying a value no record could hold leaves every case below green
    // over a world that cannot exist. These two were exactly that at thirty-two hex. The
    // check lives here and not in the prose above because a claim in a comment cannot go
    // red, and this one had already been false for a whole delivery.
    expect(isAnchorId(EARLIER_ANCHOR)).toBe(true);
    expect(isAnchorId(LATER_ANCHOR)).toBe(true);
    // And the direction the tie-break cases name is a property of these two VALUES and
    // not of the rule, so it is pinned here: an edit to either that reversed it would
    // otherwise turn `the anchor breaks the tie` into a case passing for the wrong reason.
    expect(EARLIER_ANCHOR < LATER_ANCHOR).toBe(true);
  });
});

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

    expect(channelStates([source(team), source(mine, 'private')], [CHANNEL])).toStrictEqual([
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

    expect(channelStates([source(team), source(mine, 'private')], [CHANNEL])).toStrictEqual([
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
    // empty one. `toStrictEqual` throughout this file, and not `toEqual`: the latter
    // reads a key present and undefined as a key absent, which is the exact distinction
    // three cases here are about.
    const team = bench();
    const mine = bench();
    switchChannel(team, CHANNEL, false, { at: EARLIER, who: EARLIER_ANCHOR });

    expect(channelStates([source(team), source(mine, 'private')], [CHANNEL])).toStrictEqual([
      { channel: CHANNEL, on: false, by: EARLIER_ANCHOR, at: EARLIER, travels: true },
    ]);
  });

  it('a tree whose last switch turned it ON says nothing about the other trees', () => {
    // One tree cannot switch a channel back on for another, so an ON row is not a vote:
    // the OFF in the second tree still decides, and the answer names IT.
    // THE ON ROW IS THE ONE THAT WOULD WIN. It is written at the EARLIER instant and by
    // the anchor that sorts first, so a rule counting it as a vote would answer with IT —
    // by a different anchor, at a different instant, from a tree of the other scope. The
    // earlier draft of this case had the ON row late and losing on both keys, which made
    // it green under the very mutation its name is about: an ON row counted as a vote
    // still lost the tie-break, and the bytes came out the same.
    const team = bench();
    const mine = bench();
    switchChannel(team, CHANNEL, true, { at: EARLIER, who: EARLIER_ANCHOR });
    switchChannel(mine, CHANNEL, false, { at: LATER, who: LATER_ANCHOR });

    expect(channelStates([source(team), source(mine, 'private')], [CHANNEL])).toStrictEqual([
      { channel: CHANNEL, on: false, by: LATER_ANCHOR, at: LATER, travels: false },
    ]);
  });

  it('a tree that switched it off and on again is a tree that says nothing', () => {
    // Within ONE tail the chain does order the facts, so the last switch is that tree's
    // position; the fold reads a position and never a history.
    const team = bench();
    const mine = bench();
    switchChannel(team, CHANNEL, false, { at: EARLIER, who: EARLIER_ANCHOR });
    switchChannel(team, CHANNEL, true, { at: LATER, who: EARLIER_ANCHOR });

    expect(channelStates([source(team), source(mine, 'private')], [CHANNEL])).toStrictEqual([
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

    expect(channelStates([source(team)], ['edit-asks-a-person', CHANNEL])).toStrictEqual([
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

    expect(channelStates([source(team)], [])).toStrictEqual([]);
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
