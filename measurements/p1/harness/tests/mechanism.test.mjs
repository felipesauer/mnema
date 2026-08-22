// The column that qualifies the `host` arm — and the pilot that proved it did not.
//
// `memory_files_after` read 2 in `host` and 0 in the other three, and the seed
// writes exactly two files into the host's directory. Every one of those four
// numbers is the seeded state untouched, so the column was consistent with a
// memory nobody opened and with a memory the agent rewrote in place. A count
// cannot tell those apart; the first test below is that exact case, and it fails
// against the code the pilot ran.
//
// What each test guards, so a later edit knows what it is breaking:
//
//   1  a file MODIFIED with the roster unchanged   the pilot's blind spot
//   2  nothing written reads as nothing written    in every arm
//   3  a file CREATED still shows                  no regression on the count's one skill
//   4  the note rides in the line                  the column states what it cannot answer
//   5  a file merely OPENED is named               and this is the guard on the atime restore
//      in `memorySnapshot`: without it the harness's own digest spends the one
//      access-time update that `relatime` gives, and this test goes red.
//
// No model is called. The double writes and reads through the `--settings` file
// it is handed, which is how the real host finds the same directory.

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { listFixtures, readDecision } from '../lib/fixtures.mjs'
import { runCell } from '../lib/cell.mjs'
import { sandboxRoot } from '../lib/sandbox.mjs'
import { atimeProbe, mechanismBetween } from '../lib/mechanism.mjs'
import { ARMS, MEMORY_INDEX, servesRecord, servesUnasked, slugFor } from '../lib/seed.mjs'
import { FIXTURES_DIR, MNEMA_BIN, fakeAgent } from './helpers.mjs'
import { readdirSync } from 'node:fs'

const fixture = listFixtures(FIXTURES_DIR).find((f) => f.id === 'a1-rounding')
/** A file of the fixture's repo, for the double to push a per-edit hook about. */
const FIRST_FILE = readdirSync(fixture.repo).sort()[0]
const MEMORY_FILE = `${slugFor(readDecision(fixture).title)}.md`
const scratch = []

function workspace() {
  const dir = mkdtempSync(join(sandboxRoot(), 'mnema-bench-mechanism-'))
  scratch.push(dir)
  return dir
}

after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

/**
 * One cell against the double, with the reference implementation the fixture ships.
 *
 * The double fires the arm's own channels when the arm HAS any. It did not have to
 * until 2026-08-19: the arm that serves unasked is invalid rather than scorable if its
 * surface never reached the cell, so an agent that stayed quiet in that arm now
 * produces a `harness_error` and the `status` assertion below caught it. Firing them
 * here is the double standing in for the HOST, which is what it is for — a test of the
 * memory columns must not fail for a reason that is about a different mechanism.
 */
function cell({ arm = 'host', memory = null } = {}) {
  const dir = workspace()
  const surface = servesUnasked(arm)
  const { line } = runCell({
    fixture,
    arm,
    run: 1,
    round: 2,
    claudeBin: fakeAgent(dir, {
      refDir: join(fixture.dir, 'refs/good'),
      memory,
      hook: surface,
      push: surface ? { path: FIRST_FILE } : null,
    }),
    mnemaBin: MNEMA_BIN,
    authMode: 'api-key',
    outDir: null,
    resultsPath: join(dir, 'cells.jsonl'),
    versions: { cli: 'fake', mnema: 'fake' },
  })
  assert.equal(line.status, 'ok', line.error ?? '')
  return line
}

describe('6 · the mechanism column detects writing, and says what it cannot see', () => {
  test('a memory file the agent MODIFIES is detected, though the count does not move', () => {
    const line = cell({ arm: 'host', memory: { write: { [MEMORY_FILE]: '---\nname: rewritten\n---\n' } } })

    // The blind spot itself: two files before, two files after.
    assert.equal(line.memory_files_after, 2, 'the roster is unchanged — this is what the pilot saw')
    assert.equal(line.memory_changed, true)
    assert.deepEqual(line.memory_writes, [`modified:${MEMORY_FILE}`])
  })

  test('nothing written is not reported as written, in every arm', () => {
    for (const arm of ARMS) {
      const line = cell({ arm })
      assert.equal(line.memory_changed, false, arm)
      assert.deepEqual(line.memory_writes, [], arm)
      assert.equal(line.memory_files_after, arm === 'host' ? 2 : 0, arm)
      // The record is the other mechanism, and it must not move either. Read from
      // `servesRecord` rather than a literal arm name: the fifth arm holds one too.
      assert.equal(line.records_after, servesRecord(arm) ? 1 : null, arm)
    }
  })

  test('a memory file the agent CREATES is still detected', () => {
    const born = { write: { 'a-memory-the-agent-kept.md': '---\nname: kept\n---\n\nsomething\n' } }

    const floor = cell({ arm: 'base', memory: born })
    assert.equal(floor.memory_files_after, 1, 'the floor arm starts with an empty directory')
    assert.equal(floor.memory_changed, true)
    assert.deepEqual(floor.memory_writes, ['added:a-memory-the-agent-kept.md'])

    const seeded = cell({ arm: 'host', memory: born })
    assert.equal(seeded.memory_files_after, 3)
    assert.deepEqual(seeded.memory_writes, ['added:a-memory-the-agent-kept.md'])
  })

  test('a file added and a file removed are named separately, not netted out', () => {
    // One in, one out: the roster is two files before and two files after, and a
    // column that watches the number reports nothing at all.
    const line = cell({
      arm: 'host',
      memory: { write: { 'replacement.md': '---\nname: replacement\n---\n' }, remove: [MEMORY_INDEX] },
    })
    assert.equal(line.memory_files_after, 2, 'one added, one removed — the count is back where it was')
    assert.equal(line.memory_changed, true)
    assert.deepEqual(line.memory_writes, ['added:replacement.md', `removed:${MEMORY_INDEX}`])
  })

  test('the note rides in the line, in every arm, and states the limit', () => {
    for (const arm of ARMS) {
      const line = cell({ arm })
      assert.match(line.mechanism_note, /detect WRITING/, arm)
      assert.match(line.mechanism_note, /a file modified in place counts/, arm)
      assert.match(line.mechanism_note, /never that the model used what it read/, arm)
      assert.match(line.mechanism_note, /num_turns and cache_read_input_tokens are INDIRECT/, arm)
      // The probe's verdict travels too, or a null read column would be unreadable.
      assert.equal(typeof line.memory_read_probe, 'string', arm)
      assert.ok(line.memory_read_probe.length > 0, arm)
    }
  })

  test('a memory the agent only OPENS is named — or the line says the filesystem cannot tell', () => {
    const line = cell({ arm: 'host', memory: { read: [MEMORY_INDEX] } })

    // Reading is never writing: whichever branch this machine is on, the write
    // half must stay quiet.
    assert.equal(line.memory_changed, false)
    assert.deepEqual(line.memory_writes, [])

    if (line.memory_read === null) {
      // The honest half. A filesystem that does not record access gets a null and
      // the reason — never a `false`, which would read as "nobody opened it".
      assert.match(line.memory_read_probe, /cannot answer and is null/)
      assert.deepEqual(line.memory_reads, [])
      return
    }

    assert.equal(line.memory_read, true, line.memory_read_probe)
    assert.deepEqual(line.memory_reads, [MEMORY_INDEX])
    // The other memory file was there and was not opened: the column is per file,
    // not per directory, or "the index loaded" and "the memory was read" would be
    // the same observation.
    assert.ok(!line.memory_reads.includes(MEMORY_FILE))
  })

  test('an agent that touches nothing leaves the read column empty', () => {
    // The instrument must not report ITSELF. The harness digests the directory
    // before the spawn, and that digest is a read.
    const line = cell({ arm: 'host' })
    assert.deepEqual(line.memory_reads, [])
    assert.notEqual(line.memory_read, true, 'the harness’s own digest must not count as a read')
  })
})

describe('6b · the probe answers the same thing twice', () => {
  test('a hundred runs in a row give one verdict, whatever this filesystem does', () => {
    // NOT "the verdict is true" — that would be a claim about the machine. What
    // has to hold is that the instrument is not deciding by coin flip, and the
    // first version of the probe was: it restored the timestamps it had just
    // read, both stamps landed in the same kernel tick, and it reported "atime
    // does not move here" on a filesystem where it does — 216 times out of 500.
    // A cell that drew that answer would carry `memory_read: null` for no reason
    // the data could show.
    const dir = mkdtempSync(join(sandboxRoot(), 'mnema-bench-probe-'))
    scratch.push(dir)

    const verdicts = new Set()
    const details = new Set()
    for (let i = 0; i < 100; i += 1) {
      const probe = atimeProbe(dir)
      verdicts.add(probe.usable)
      details.add(probe.detail)
    }
    assert.equal(verdicts.size, 1, `the probe gave both verdicts in 100 runs: ${[...details].join(' / ')}`)
    assert.equal(details.size, 1)
  })
})

describe('6c · a column that could not look says so, and never guesses', () => {
  const usable = { usable: true, detail: 'atime works here' }

  test('a before-snapshot that failed is null, not an empty directory', () => {
    // The dangerous reading: "before" as `[]` makes every seeded file an `added:`
    // — the column would not lose its answer, it would invent one.
    const dir = mkdtempSync(join(sandboxRoot(), 'mnema-bench-cannot-look-'))
    scratch.push(dir)
    writeFileSync(join(dir, 'MEMORY.md'), '- a memory that was there all along\n')

    const out = mechanismBetween({ memory: null, atime: usable }, { memory: dir }, 'base', MNEMA_BIN)
    assert.equal(out.changed, null, 'not false, and above all not true')
    assert.deepEqual(out.writes, [])
    assert.equal(out.read, null)
    assert.equal(out.memoryFiles, 1, 'the count still describes the directory')
    assert.match(out.readProbe, /could not be read before the cell/)
  })

  test('an after-snapshot that failed nulls the count too', () => {
    const gone = join(sandboxRoot(), 'mnema-bench-no-such-memory-directory')
    const out = mechanismBetween({ memory: [], atime: usable }, { memory: gone }, 'base', MNEMA_BIN)
    assert.equal(out.memoryFiles, null)
    assert.equal(out.changed, null)
    assert.equal(out.read, null)
    assert.match(out.readProbe, /could not be read after the cell/)
  })
})
