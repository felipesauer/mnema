// A round is a pre-registration and the tasks it froze, PAIRED — and the preflight
// has to clear every round while a run spends inside exactly one.
//
// WHY THIS FILE EXISTS. The bench acquired a second set of tasks, frozen before the
// product surface they will measure was built. Two things become possible the moment
// that happens, and neither leaves a trace in a result:
//
//   - `--full` walks the tasks on disk, so a second set in the same place would be
//     SPENT the next time anybody typed it — held-out tasks burned for a round
//     nobody had designed yet;
//   - a task can end up in two rounds' splits, and each round's own check is blind
//     to it: they hold their tasks in different directories, so both clear
//     separately while the newer round re-runs a task whose result is known.
//
// The first is closed by `--round` and by a refusal keyed to the ARMS a round
// declares; the second by a check that reads both pre-registrations at once. Both
// are asserted here, and both are shown able to go red.

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { listFixtures } from '../lib/fixtures.mjs'
import { ARMS } from '../lib/seed.mjs'
import { runSelftest } from '../lib/selftest.mjs'
import { sandboxRoot } from '../lib/sandbox.mjs'
import { benchOf, benches, cellPlan, pilotPlan } from '../run.mjs'
import {
  ROUNDS,
  armsOf,
  crossRoundProblems,
  preregOf,
  readSplit,
  PREREG,
  refuseUnrunnableRound,
  roundArms,
} from '../lib/split.mjs'
import { MNEMA_BIN, cloneFixtures } from './helpers.mjs'

const CLAUDE = process.env.MNEMA_BENCH_CLAUDE || 'claude'
const scratch = []

after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

function workspace(round) {
  const dir = mkdtempSync(join(sandboxRoot(), `mnema-bench-round${round}-`))
  scratch.push(dir)
  return { dir, ...cloneFixtures(dir, round) }
}

describe('10 · the rounds are separate sets of tasks, and stay separate', () => {
  test('every round has its own tasks, and no id is in two of them', () => {
    const byRound = new Map(
      ROUNDS.map((round) => [round, listFixtures(benchOf(round).fixturesDir).map((f) => f.id)]),
    )
    // Non-vacuity: every round non-empty, or "they share nothing" is a claim about an
    // empty set. It said `size === 2` and named the two by destructuring until
    // 2026-08-20, which is a shape that reads as a check and silently stops being one the
    // day a third round arrives: the pair would have kept comparing rounds 1 and 2 while
    // round 3 sat on disk unexamined. Every PAIR is compared now.
    assert.ok(byRound.size >= 2, 'a cross-round check over one round is a claim about nothing')
    assert.equal(byRound.size, ROUNDS.length)
    for (const [round, ids] of byRound) assert.ok(ids.length > 0, `round ${round} has no task`)

    const rounds = [...byRound.entries()]
    for (let i = 0; i < rounds.length; i += 1) {
      for (let j = i + 1; j < rounds.length; j += 1) {
        const [left, leftIds] = rounds[i]
        const [right, rightIds] = rounds[j]
        assert.deepEqual(
          leftIds.filter((id) => rightIds.includes(id)),
          [],
          `a task is on disk in round ${left} and in round ${right}`,
        )
      }
    }
    assert.deepEqual(crossRoundProblems(), [], 'the committed splits share a task')
  })

  test('and the list of rounds is the pre-registrations that EXIST, never fewer', () => {
    // THE CHECK THAT WAS MISSING, and it is what this delivery is half about. Round 3's
    // pre-registration was committed and frozen on 2026-08-20 while `ROUNDS` stopped at 2,
    // and `--selftest` passed GREEN over it: a round the preflight does not walk is a
    // round it cannot refuse, including refusing it for declaring an arm nobody built —
    // which is exactly what round 3 was declaring. So the list is asserted against the
    // DISK rather than against itself, and a round frozen and left out is red here.
    const onDisk = readdirSync(PREREG.dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^round-\d+$/.test(entry.name))
      .map((entry) => Number(entry.name.slice('round-'.length)))
      .sort((a, b) => a - b)
    // Round 1 has no directory of its own — it was the only round when it was written and
    // its files are not moved — so it is added by the one fact that identifies it.
    assert.equal(existsSync(preregOf(1).split), true, 'round 1 is at the root of the pre-registration')
    assert.deepEqual(ROUNDS, [1, ...onDisk])
    // Non-vacuity: the walk found directories at all.
    assert.ok(onDisk.length >= 2, `the walk found [${onDisk}], which is not a bench with three rounds`)
  })

  test('and a task in two splits is caught, by name', () => {
    // The teeth. With the real files the case above only ever says "nothing is
    // accused"; here the same function is handed a pair that overlaps.
    const first = preregOf(1)
    const problems = crossRoundProblems([first, { ...preregOf(2), split: first.split }])
    assert.ok(problems.length > 0, 'an overlapping pair of splits was not caught')
    assert.match(problems[0], /is in the split of round 1 and of round 2/)
  })

  test('every round is calibrated by the SAME script, not by a copy of it', () => {
    // A copy of the calibrator is a second reading of one rule, and the drift would
    // be a task that calibrates under one copy and not the other. Every later round's
    // script is a symlink to round 1's, and `dirname "$0"` is what makes it calibrate its
    // own tasks. It named round 2 by number until 2026-08-20, which would have left round
    // 3's calibrator — a file that was ALSO a symlink and could have been a copy —
    // unexamined.
    for (const round of ROUNDS.filter((r) => r !== 1)) {
      assert.equal(
        realpathSync(benchOf(round).selftestScript),
        realpathSync(benchOf(1).selftestScript),
        `round ${round} is calibrated by a copy, not by the script`,
      )
      assert.notEqual(benchOf(round).selftestScript, benchOf(1).selftestScript)
    }
  })

  test('the preflight is given every round, so none is the one thing untested', () => {
    assert.deepEqual(
      benches().map((bench) => bench.round),
      ROUNDS,
    )
  })
})

describe('10b · a round whose arms this harness cannot seed does not run', () => {
  test('no pre-registered round is refused any more — every arm any of them declares seeds', () => {
    // THIS TEST WAS THE OPPOSITE TWICE, and both inversions were a delivery. On
    // 2026-08-19 it asserted that round 2 is refused, because its `split.json` names
    // `mnema+` and this harness seeded an arm called `plugin`. On 2026-08-20 round 3 was
    // refused for the same reason under another name: it declares `mnema-doc` and nothing
    // seeded one. Both refusals lifted by themselves, because the comparison is against
    // the harness's own list and there was never a second switch to remember.
    //
    // AND IT NAMED ROUND 2 ALONE, which is the shape that stops being a check. Every
    // round is walked now, for the same reason `ROUNDS` is asserted against the disk.
    for (const round of ROUNDS) {
      refuseUnrunnableRound(round)
      const declared = armsOf(preregOf(round))
      if (declared === null) continue
      assert.deepEqual(
        declared.filter((arm) => !ARMS.includes(arm)),
        [],
        `round ${round} declares an arm this harness cannot seed`,
      )
    }
    // Non-vacuity: at least one round DOES declare arms, or the loop above cleared
    // nothing and would clear nothing forever.
    assert.ok(ROUNDS.some((round) => armsOf(preregOf(round)) !== null))
  })

  test('a round may declare FEWER arms than the harness seeds, and round 3 does', () => {
    // THE PREMISE THAT FELL, written out because it was load-bearing and true for two
    // days. The refusal compared the two lists ELEMENT BY ELEMENT AND IN ORDER, and the
    // test that stood here asserted `deepEqual(ARMS, armsOf(preregOf(2)))` — which was a
    // fact about round 2 read as a rule about rounds. Round 3 withdraws `prosa` and
    // `mnema` in writing, on the record, in `arms.md`: under equality it would have been
    // refused forever no matter what was built, and the only way out would have been a
    // list edited by hand to let it through, which is a switch. The question is
    // CONTAINMENT, and that is what round 3's own frozen `arms.md` already said the
    // harness does.
    const three = armsOf(preregOf(3))
    assert.deepEqual(three, ['base', 'host', 'mnema-doc', 'mnema+'])
    assert.equal(three.length < ARMS.length, true, 'round 3 declares fewer arms than the harness seeds')
    assert.notDeepEqual(three, ARMS, 'and this is the case element-by-element equality refused')
    refuseUnrunnableRound(3)

    // AND WHAT STOPS THE WITHDRAWN ARMS FROM BEING RUN is a different mechanism, because
    // containment alone does not: the plan is built from the ROUND's arms.
    const withdrawn = ARMS.filter((arm) => !three.includes(arm))
    assert.deepEqual(withdrawn, ['prosa', 'mnema'], 'the two arms round 3 withdrew')
    assert.deepEqual(roundArms(3), three)
    const planned = new Set(cellPlan([{ id: 'x' }], 1, roundArms(3)).map((c) => c.arm))
    assert.deepEqual([...planned].sort(), [...three].sort())
    for (const arm of withdrawn) {
      assert.equal(planned.has(arm), false, `${arm} was withdrawn and must not be planned`)
    }
    // Round 1 declares none, so it falls back to the harness's list — which is what its
    // published results were taken with.
    assert.equal(armsOf(preregOf(1)), null)
    assert.deepEqual(roundArms(1), ARMS)
  })

  test('round 1 is not refused — its split declares no arms, and its results are what say so', () => {
    assert.equal(armsOf(preregOf(1)), null)
    refuseUnrunnableRound(1)
  })

  test('and it is NOT vacuous — a harness one arm short still refuses, by name', () => {
    // The half that keeps the test above from being "nothing throws any more". The
    // refusal has to fire for any arm a round declares and this harness cannot seed: one
    // arm missing, and one arm renamed. Both name the two lists AND the arms that cannot
    // be seeded, which is what makes a refusal readable at three in the morning.
    for (const round of ROUNDS.filter((r) => armsOf(preregOf(r)) !== null)) {
      const declared = armsOf(preregOf(round))
      const short = ARMS.filter((arm) => arm !== declared.at(-1))
      assert.throws(
        () => refuseUnrunnableRound(round, short),
        (err) => {
          assert.match(err.message, new RegExp(`^round ${round} declares the arms \\[`))
          assert.match(err.message, new RegExp(`no cell of round ${round} runs from here`))
          assert.ok(err.message.includes(declared.at(-1)), 'the arm that cannot be seeded is named')
          return true
        },
      )
      // A rename, which is the mistake that produced the refusal in the first place: the
      // arm was called `plugin` while round 2 declared `mnema+`, and nothing was called
      // `mnema-doc` while round 3 declared it.
      assert.throws(
        () => refuseUnrunnableRound(round, [...short, 'a-name-nobody-declared']),
        /declares the arms/,
      )
    }
  })

  test('and a round that declares an arm nobody built is refused even when the count matches', () => {
    // The case containment has to catch and equality caught for free: same number of
    // arms, one of them spelled differently. Without this, "every declared arm is
    // seedable" could be read as "the harness has enough arms".
    const three = armsOf(preregOf(3))
    const renamed = ARMS.map((arm) => (arm === 'mnema-doc' ? 'mnema-document' : arm))
    assert.equal(renamed.length, ARMS.length, 'the same number of arms, one spelled differently')
    assert.throws(() => refuseUnrunnableRound(3, renamed), /\[mnema-doc\] cannot be seeded/)
    assert.ok(three.includes('mnema-doc'))
  })

  test('the pilot of a round is that round’s own pilot, read from that round’s split', () => {
    const fixtures = listFixtures(benchOf(2).fixturesDir)
    const split = readSplit(preregOf(2).split)
    const plan = pilotPlan(fixtures, split, roundArms(2))

    assert.deepEqual([...new Set(plan.map((c) => c.fixture.id))], [split.pilot])
    // The teeth: round 1's pilot is not a task of round 2, so reading the wrong
    // round's split throws instead of silently spending whatever sorts first.
    assert.throws(
      () => pilotPlan(fixtures, readSplit(preregOf(1).split), roundArms(2)),
      /the split names .* as the pilot, and it is not in this run/,
    )
  })

  test('and a pilot of round 3 spends only the arms round 3 declares', () => {
    // The pilot is the cheapest thing that can spend, so it is the one most likely to be
    // typed without thinking. Planned from `ARMS` it would spend the two arms round 3
    // withdrew, on that round's pilot task, before anybody read a table.
    const fixtures = listFixtures(benchOf(3).fixturesDir)
    const split = readSplit(preregOf(3).split)
    const plan = pilotPlan(fixtures, split, roundArms(3))
    assert.deepEqual([...new Set(plan.map((c) => c.fixture.id))], [split.pilot])
    assert.deepEqual([...new Set(plan.map((c) => c.arm))].sort(), [...armsOf(preregOf(3))].sort())
    assert.equal(plan.length, 4, 'four arms, one task, one run')
  })
})

describe('10d · and it clears round 3’s tasks too — the round with the arm nobody had built', () => {
  test('over a copy of that round alone, with both surface arms in it', async () => {
    // ROUND 3'S TASKS HAVE NEVER BEEN CLEARED IN ISOLATION, and until 2026-08-20 they had
    // never been cleared at all: `ROUNDS` stopped at 2, so the preflight walked past ten
    // frozen tasks and an arm nobody had built and said every check passed. This is the
    // case that would have been red that day.
    const bench = workspace(3)
    const result = await runSelftest({
      rounds: [bench],
      mnemaBin: MNEMA_BIN,
      claudeBin: CLAUDE,
      authMode: 'api-key',
    })

    assert.deepEqual(
      result.checks.filter((c) => !c.ok && !c.name.startsWith('auth')).map((c) => c.name),
      [],
      JSON.stringify(result.checks.filter((c) => !c.ok), null, 2),
    )
    assert.match(result.checks.find((c) => c.name === 'split frozen').detail, /^round 3: 10 tasks/)
    assert.equal(result.checks.find((c) => c.name === 'fixtures readable').detail, 'round 3: 10')
    // The two checks this delivery widened, and the reason the count is spelled out: they
    // walked ONE arm before, so a detail naming ten cells would be a preflight that
    // cleared `mnema+` and left `mnema-doc` untested.
    const arrives = result.checks.find((c) => c.name === "the surface arms' context arrives")
    assert.match(arrives.detail, /^20 cells across \[mnema-doc,mnema\+\]/)
    assert.match(arrives.detail, /10 pair\(s\) hand over the SAME document/)
    const reaches = result.checks.find(
      (c) => c.name === "the surface arms' rules reach the writing, or correctly do not",
    )
    assert.match(reaches.detail, /^20 cells across \[mnema-doc,mnema\+\]/)
    // And the gate that was missing: it runs over the COMMITTED pre-registrations, so it
    // names all three rounds even when the preflight was handed one round's tasks.
    const runnable = result.checks.find((c) => c.name === 'every pre-registered round is runnable')
    assert.equal(runnable.ok, true, runnable.detail)
    assert.match(runnable.detail, /round 3: 4/)
    // And it is ahead of everything that does work: a refusal that costs nothing is only
    // worth nothing if it happens before the work. Asserted as WHAT PRECEDES IT and not as
    // an index — the index moved the day `tasks found` went in front of it, and the claim
    // was never about the number. Everything named here reads files and spawns nothing.
    const order = result.checks.map((c) => c.name)
    assert.deepEqual(order.slice(0, order.indexOf('every pre-registered round is runnable')), [
      'tasks found',
      'toolchain',
    ])
  })
})

describe('10c · and the preflight clears round 2’s tasks, every check of it', () => {
  test('over a copy of that round alone, with the split check naming it', async () => {
    const bench = workspace(2)
    const result = await runSelftest({
      rounds: [bench],
      mnemaBin: MNEMA_BIN,
      claudeBin: CLAUDE,
      authMode: 'api-key',
    })

    // Auth is the one check that depends on the machine and not on the bench.
    assert.deepEqual(
      result.checks.filter((c) => !c.ok && !c.name.startsWith('auth')).map((c) => c.name),
      [],
      JSON.stringify(result.checks.filter((c) => !c.ok), null, 2),
    )
    const frozen = result.checks.find((c) => c.name === 'split frozen')
    assert.match(frozen.detail, /^round 2: 10 tasks/)
    // The parity, seeding, MCP and hook checks all counted round 2's ten tasks, and
    // saying so is what keeps this case from passing over a preflight that skipped them.
    assert.equal(result.checks.find((c) => c.name === 'fixtures readable').detail, 'round 2: 10')
    assert.match(
      result.checks.find((c) => c.name === 'seeding').detail,
      new RegExp(`^${10 * ARMS.length} cells seed as declared`),
      'ten tasks times every arm the harness seeds',
    )
  })
})
