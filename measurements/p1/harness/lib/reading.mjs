// The rule that reads a pair of arms — `>`, `≈`, or not compared — as code.
//
// Round 2's `reading.md` states it in prose, and round 3 inherits it. Until this file it was
// prose plus a one-off script that computed it over round 1's cells, and a rule that exists
// only as prose and a throwaway is a rule that is checked once. This is the function the
// prose describes, and `tests/reading.test.mjs` pins it to the case that validated the
// prose: round 1's committed cells read under it give SIX pairs `≈`, SIX not comparable and
// NO `>`.
//
// THE DEFINITIONS, from `round-2/reading.md`:
//
//   eligible(X, Y)       the headline tasks on which BOTH arms have a rate;
//   discriminating(X,Y)  the eligible tasks on which the two rates differ;
//   degenerate           the rest — equal rates, and tasks where one side has no rate.
//                        Both counts are published with every comparison.
//
// X is `>` Y only when all four hold: (1) at least `minEligible` headline tasks are eligible,
// else the pair is NOT COMPARED; (2) neither arm is `BROKEN` in a quarter or more of its cells
// on the eligible tasks — the boundary belongs to the refusal; (3) the aggregates over the
// SAME eligible tasks differ by more than the threshold; (4) at least three eligible tasks
// discriminate and X is the higher in more than half of them. Anything else is `≈`.
//
// ONE READING OF CONDITIONS 3 AND 4. They are `readGreater` in `../../threshold.mjs`, which
// the threshold simulation and the recount of every published round already call. This file
// calls it too and does not restate it: two readings of one rule is how a simulation ends up
// deriving a threshold for a ruler nobody uses. What this file adds is the part `readGreater`
// leaves to its caller by design — eligibility, the ceiling and the not-compared case.
//
// The rule does not know which arm is the product: rename the arms to A…E and every clause
// says the same thing.

import { readGreater } from '../../threshold.mjs'

/** A quarter of an arm's cells BROKEN or more, and the comparison is not read. */
export const BROKEN_CEILING = 0.25

/** Round 2's threshold, and round 3's. A later round derives its own and passes it. */
export const ROUND_TWO_THRESHOLD = 25

/**
 * Read one ordered pair.
 *
 * @param counted  the result of `tally` over a capture
 * @param headline the round's headline task ids
 * @returns `{ x, y, state, eligible, discriminating, degenerate, brokenX, brokenY, gap, higher }`
 *   where `state` is `'not-compared'`, `'vetoed'`, `'greater'` or `'tie'` — `'tie'` is the
 *   rule's `≈`. `'vetoed'` is a `≈` whose cause is the ceiling, and it is kept apart because
 *   the cause is a defect of the tasks or the agent and not a finding about the arms.
 */
export function readPair(
  counted,
  headline,
  x,
  y,
  { minEligible = 4, minDiscriminating = 3, threshold = ROUND_TWO_THRESHOLD } = {},
) {
  const eligible = headline.filter((t) => counted.rate(x, t) !== null && counted.rate(y, t) !== null)
  const result = {
    x,
    y,
    state: 'not-compared',
    eligible: eligible.length,
    // Everything that is not a discriminating eligible task: equal rates, and tasks where
    // one side has no rate.
    discriminating: 0,
    degenerate: headline.length,
    brokenX: null,
    brokenY: null,
    gap: null,
    higher: 0,
  }
  if (eligible.length < minEligible) return result

  const share = (arm) => {
    const broken = eligible.reduce((s, t) => s + counted.get(arm, t).broken, 0)
    const cells = eligible.reduce((s, t) => s + counted.get(arm, t).ok, 0)
    return cells === 0 ? 0 : broken / cells
  }
  result.brokenX = share(x)
  result.brokenY = share(y)

  const read = readGreater(
    eligible.map((t) => counted.rate(x, t)),
    eligible.map((t) => counted.rate(y, t)),
    threshold,
    { minDiscriminating },
  )
  result.gap = read.gap
  result.discriminating = read.discriminating
  result.higher = read.higher
  result.degenerate = headline.length - read.discriminating

  const vetoed = result.brokenX >= BROKEN_CEILING || result.brokenY >= BROKEN_CEILING
  result.state = vetoed ? 'vetoed' : read.greater ? 'greater' : 'tie'
  return result
}

/** Every ordered pair of `arms`, read. */
export function readRound(counted, headline, arms = counted.arms, options = {}) {
  const pairs = []
  for (const x of arms) {
    for (const y of arms) {
      if (x !== y) pairs.push(readPair(counted, headline, x, y, options))
    }
  }
  return pairs
}
