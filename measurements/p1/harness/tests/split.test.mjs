// The bench has to be the one the pre-registration froze — and the preflight has
// to be able to say so.
//
// The committed case beside the product checks the pre-registration against
// itself: every task on exactly one side, the pilot on the development side, the
// negative control held back. It cannot do the other half, because the tasks live
// in a workbench git ignores. THIS is the other half: the split against the tasks
// on disk, and each task against the digest that was frozen for it.

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { listFixtures } from '../lib/fixtures.mjs'
import { ARMS } from '../lib/seed.mjs'
import { runSelftest } from '../lib/selftest.mjs'
import { sandboxRoot } from '../lib/sandbox.mjs'
import { pilotPlan } from '../run.mjs'
import { digestOf, readDigests, readSplit, splitProblems } from '../lib/split.mjs'
import { FIXTURES_DIR, MNEMA_BIN, cloneFixtures } from './helpers.mjs'

const CLAUDE = process.env.MNEMA_BENCH_CLAUDE || 'claude'
const scratch = []

function workspace() {
  const dir = mkdtempSync(join(sandboxRoot(), 'mnema-bench-split-'))
  scratch.push(dir)
  return { dir, ...cloneFixtures(dir) }
}

after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

describe('6 · the split, against the tasks on disk', () => {
  test('a faithful copy of the bench clears it — the digest is content, not place', () => {
    // The whole scheme rests on this. `cloneFixtures` copies the tasks to a temp
    // directory, which moves every mtime; if the digest moved with them it would
    // be measuring the copy rather than the task, and every check below would be
    // noise. It also means the preflight can run over a copy, which is what the
    // other cases here do.
    const bench = workspace()
    assert.deepEqual(splitProblems({ fixtures: listFixtures(bench.fixturesDir) }), [])
  })

  test('a task edited after the freeze is caught, and named', () => {
    const bench = workspace()
    // An edit that breaks NOTHING else: the file sits beside the task's repository,
    // so the discriminant still discriminates, the arms still seed and the record
    // still answers. Only the bytes moved — which is precisely the class no other
    // check in the preflight can see.
    writeFileSync(join(bench.fixturesDir, 'a1-rounding', 'NOTES.md'), '# a note added later\n')

    const problems = splitProblems({ fixtures: listFixtures(bench.fixturesDir) })

    assert.equal(problems.length, 1, problems.join('\n'))
    assert.match(problems[0], /^a1-rounding was edited after the freeze/)
  })

  test('a task on disk and on neither side of the split is caught', () => {
    const bench = workspace()
    const split = readSplit()
    const problems = splitProblems({
      fixtures: listFixtures(bench.fixturesDir),
      split: { ...split, held_out: split.held_out.filter((id) => id !== 'b2-moving-average') },
    })
    assert.deepEqual(problems, ['b2-moving-average is on disk and on neither side of the split'])
  })

  test('a split that names a task nobody has is caught', () => {
    const bench = workspace()
    const split = readSplit()
    const problems = splitProblems({
      fixtures: listFixtures(bench.fixturesDir),
      split: { ...split, held_out: [...split.held_out, 'a9-invented'] },
    })
    // One sentence, not two: the digest half walks the tasks that EXIST, so a name
    // nobody has is a fault of the split and is reported once, as that.
    assert.deepEqual(problems, ['a9-invented is in the split and not on disk'])
  })

  test('a pilot that would spend a held-out task is caught', () => {
    const bench = workspace()
    const split = readSplit()
    const problems = splitProblems({
      fixtures: listFixtures(bench.fixturesDir),
      split: { ...split, pilot: 'a2-due-day' },
    })
    assert.deepEqual(problems, [
      'the pilot a2-due-day is not a development task, so a pilot would spend a held-out one',
    ])
  })

  test('the negative control cannot be developed against', () => {
    const bench = workspace()
    const split = readSplit()
    const problems = splitProblems({
      fixtures: listFixtures(bench.fixturesDir),
      split: {
        ...split,
        development: [...split.development, 'b1-csv-quotes'],
        held_out: split.held_out.filter((id) => id !== 'b1-csv-quotes'),
      },
    })
    assert.deepEqual(problems, [
      'b1-csv-quotes is the negative control and cannot be a development task',
    ])
  })

  test('a digest that no longer matches is caught even when the file parses', () => {
    const bench = workspace()
    const frozen = readDigests()
    frozen.set('a3-idempotency', 'f'.repeat(64))
    const problems = splitProblems({ fixtures: listFixtures(bench.fixturesDir), frozen })
    assert.equal(problems.length, 1, problems.join('\n'))
    assert.match(problems[0], /^a3-idempotency was edited after the freeze/)
  })

  test('the committed digests are the ones the tasks on disk have', () => {
    // The one case that reads the REAL bench rather than a copy of it: what is
    // committed under `measurements/` is a claim about these bytes, and if it ever
    // stops being true the freeze is fiction.
    const frozen = readDigests()
    for (const fixture of listFixtures(FIXTURES_DIR)) {
      assert.equal(digestOf(FIXTURES_DIR, fixture.id), frozen.get(fixture.id), fixture.id)
    }
  })
})

describe('6b · the pilot runs the task the split names', () => {
  test('and not whichever one sorts first', () => {
    const fixtures = listFixtures(FIXTURES_DIR)
    const split = readSplit()

    const plan = pilotPlan(fixtures, split)

    assert.equal(plan.length, ARMS.length)
    assert.deepEqual([...new Set(plan.map((c) => c.fixture.id))], [split.pilot])
    assert.deepEqual([...plan.map((c) => c.arm)].sort(), [...ARMS].sort())
    // The teeth: with the real split those two answers coincide, so the case above
    // has never shown it can tell them apart. Here they do not.
    const other = pilotPlan(fixtures, { ...split, pilot: 'a3-idempotency' })
    assert.deepEqual([...new Set(other.map((c) => c.fixture.id))], ['a3-idempotency'])
    assert.notEqual('a3-idempotency', fixtures[0].id)
  })

  test('and refuses a pilot that is not among the tasks it was given', () => {
    const fixtures = listFixtures(FIXTURES_DIR)
    assert.throws(
      () => pilotPlan(fixtures, { ...readSplit(), pilot: 'a9-invented' }),
      /the split names a9-invented as the pilot/,
    )
  })
})

describe('6c · and the preflight refuses on it', () => {
  test('when a task no longer has the bytes that were frozen', async () => {
    const bench = workspace()
    writeFileSync(join(bench.fixturesDir, 'a1-rounding', 'NOTES.md'), '# a note added later\n')

    const result = await runSelftest({
      rounds: [bench],
      mnemaBin: MNEMA_BIN,
      claudeBin: CLAUDE,
      authMode: 'api-key',
    })

    assert.equal(result.ok, false)
    assert.deepEqual(
      result.checks.filter((c) => !c.ok).map((c) => c.name),
      ['split frozen'],
    )
    assert.match(result.checks.at(-1).detail, /a1-rounding was edited after the freeze/)
  })
})
