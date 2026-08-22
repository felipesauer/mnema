// The preflight has to be able to say NO — seven ways, one test each.
//
// A `--selftest` that cannot fail is the vacuous guard this bench has been
// burned by twice: an instrument that reports zero because it never ran is
// indistinguishable from an instrument that ran and found nothing. So each of
// the failures below is INJECTED into a writable copy of the bench, and
// the test requires both the refusal and the name of the check that refused.
//
// THE FIRST OF THEM IS THE ONE A STRANGER MEETS. This runner is published and the
// tasks it runs are held out, so a clone of the repository holds the instrument and
// no material at all — and the refusal that says so has to name the tasks rather than
// arrive as a broken calibrator, which is what the checks after it would call it.
//
// The last two are the fifth arm's, one per channel, and they are the ones that
// separate two opposite conclusions about the product. The document handler's correct
// behaviour when it has nothing to hand over is SILENCE, so a hook that cannot run
// produces the same cell as an empty record. The per-edit hook's failure is worse: a
// hook naming a server the host does not know is never called AND THE HOST SAYS NOTHING
// — measured, four wrong spellings, `measurements/mcp-tool-channel/`. A preflight that
// cleared either would let cells come back reading "the surface did not help" when the
// surface never ran.

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runSelftest } from '../lib/selftest.mjs'
import { sandboxRoot } from '../lib/sandbox.mjs'
import {
  MNEMA_BIN,
  cloneFixtures,
  mnemaThatWillNotServe,
  pluginThatWillNotInject,
  pluginWhoseHookNamesAnotherServer,
} from './helpers.mjs'
import { ARMS, SURFACE_ARM, servesRecord } from '../lib/seed.mjs'
import { TASKS_VARIABLE } from '../lib/root.mjs'
import { benchOf } from '../run.mjs'

/**
 * The two check names this delivery moved, written once.
 *
 * They named `mnema+` while it was the only arm carrying a surface. Round 3 runs two such
 * arms and the checks walk both, so a name that still said `mnema+` would describe half
 * of what the check does — and, worse, would let this file stay green over a preflight
 * that had quietly gone back to clearing one arm.
 */
const ARRIVES = "the surface arms' context arrives"
const REACHES = "the surface arms' rules reach the writing, or correctly do not"

const CLAUDE = process.env.MNEMA_BENCH_CLAUDE || 'claude'
const scratch = []

function workspace() {
  const dir = mkdtempSync(join(sandboxRoot(), 'mnema-bench-selftest-'))
  scratch.push(dir)
  return { dir, ...cloneFixtures(dir) }
}

after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

function failed(result) {
  return result.checks.filter((c) => !c.ok).map((c) => c.name)
}

describe('4 · the preflight refuses', () => {
  test('when the tasks are not where it was told they are', async () => {
    // The one refusal that needs no injection: a directory with no tasks in it is
    // what a clone of this repository IS. Nothing else here can stand in for it —
    // the other five break something inside a bench that exists.
    const dir = mkdtempSync(join(sandboxRoot(), 'mnema-bench-no-tasks-'))
    scratch.push(dir)

    const result = await runSelftest({
      rounds: [{ round: 1, fixturesDir: join(dir, 'fixtures'), selftestScript: join(dir, 'selftest.sh') }],
      mnemaBin: MNEMA_BIN,
      claudeBin: CLAUDE,
      authMode: 'api-key',
    })

    assert.equal(result.ok, false)
    // FIRST and ALONE: it stops the preflight, so the twelve checks that build paths
    // out of that answer never run and never mislabel it as their own failure.
    assert.deepEqual(failed(result), ['tasks found'])
    assert.deepEqual(result.checks.map((c) => c.name), ['tasks found'])
    assert.match(result.checks.at(-1).detail, /round 1: nothing at .*\/fixtures$/)
  })

  test('and the refusal names the variable when nobody said where the tasks are', () => {
    // The layer under it: `benchOf` cannot build a path at all, so the message has to
    // name what is missing. A default here would be a guess about somebody else's
    // repository dressed as a fact about ours.
    const said = process.env[TASKS_VARIABLE]
    delete process.env[TASKS_VARIABLE]
    try {
      assert.throws(() => benchOf(1), new RegExp(`${TASKS_VARIABLE} is not set`))
    } finally {
      if (said !== undefined) process.env[TASKS_VARIABLE] = said
    }
  })

  test('when a fixture no longer calibrates', async () => {
    const bench = workspace()
    // The discriminant stops discriminating: the violating reference is replaced
    // by the conforming one, so `bad` now says CONFORMS.
    cpSync(
      join(bench.fixturesDir, 'a1-rounding/refs/good/invoice.php'),
      join(bench.fixturesDir, 'a1-rounding/refs/bad/invoice.php'),
    )

    const result = await runSelftest({
      rounds: [bench],
      mnemaBin: MNEMA_BIN,
      claudeBin: CLAUDE,
      authMode: 'api-key',
    })

    assert.equal(result.ok, false)
    assert.deepEqual(failed(result), ['fixtures calibrated'])
    const detail = result.checks.at(-1).detail
    assert.match(detail, /a1-rounding\s+bad said CONFORMS\/0, expected VIOLATES\/1/)
  })

  test('when a seed does not produce the state its arm claims', async () => {
    const bench = workspace()
    // The floor arm is handed the answer: a DECISIONS.md that ships with the
    // fixture repository itself, so every arm has it and `base` is no floor.
    writeFileSync(join(bench.fixturesDir, 'a1-rounding/repo/DECISIONS.md'), '# a decision nobody seeded\n')

    const result = await runSelftest({
      rounds: [bench],
      mnemaBin: MNEMA_BIN,
      claudeBin: CLAUDE,
      authMode: 'api-key',
    })

    assert.equal(result.ok, false)
    assert.deepEqual(failed(result), ['seeding'])
    assert.match(result.checks.at(-1).detail, /a1-rounding\/base: DECISIONS\.md is present/)
  })

  test('when the mnema arm does not answer over MCP', async () => {
    const bench = workspace()
    const mute = mnemaThatWillNotServe(bench.dir)

    const result = await runSelftest({
      rounds: [bench],
      mnemaBin: mute,
      claudeBin: CLAUDE,
      authMode: 'api-key',
    })

    assert.equal(result.ok, false)
    assert.deepEqual(failed(result), ['mnema answers over MCP'])
    // The record was written and the CLI can read it — only the agent's channel
    // is dead. That is round A's failure, and it must stop the run.
    const detail = result.checks.at(-1).detail
    assert.match(detail, /a1-rounding\/mnema: the server (exited|did not answer)/)
    // And the arm added later rides the same transport, so the check has to have
    // asked on its behalf too: a preflight that cleared only `mnema` would leave the
    // new arm as the one thing it did not test.
    // EVERY arm that holds a record, found by the predicate and not by a name: two of
    // them rode this transport untested until 2026-08-19, and a third joined on
    // 2026-08-20. A list written here would go stale silently, which is the whole failure
    // mode this case exists for.
    for (const arm of ARMS.filter(servesRecord)) {
      assert.match(
        detail,
        new RegExp(`a1-rounding/${arm.replace('+', '\\+')}: the server (exited|did not answer)`),
        `the check did not ask on behalf of ${arm}`,
      )
    }
    assert.ok(ARMS.filter(servesRecord).length >= 3, 'and there are three of them now')
  })

  test('when the surface arm’s context does not arrive', async () => {
    const bench = workspace()
    // Everything else about the bench is intact: the record is written, the CLI
    // reads it, the server serves it. The only thing missing is the handler the
    // declaration names — and a mute handler is the product behaving correctly, so
    // this must be caught as a broken hook and not cleared as an empty record.
    const plugin = pluginThatWillNotInject(bench.dir)

    const result = await runSelftest({
      rounds: [bench],
      mnemaBin: MNEMA_BIN,
      claudeBin: CLAUDE,
      pluginDir: plugin,
      authMode: 'api-key',
    })

    assert.equal(result.ok, false)
    assert.deepEqual(failed(result), [ARRIVES])
    const detail = result.checks.at(-1).detail
    assert.match(detail, /the declared handler is not there/)
    assert.match(detail, /there-is-no-handler\.mjs/)
    // And it is not cleared, or explained away, as the handler being quiet.
    assert.match(detail, /no document reached the session/)
  })

  test('when the surface arm’s per-edit hook names a server nothing declares', async () => {
    // The silent one. Everything else is intact — record written, CLI reading, server
    // serving, document arriving — and the hook names `plugin:something:else`, which on
    // a real host would mean the tool is never called, nothing is injected, no error is
    // raised and the session continues. The refusal happens at the DECLARATION, which is
    // why the check that reports it is the seeding one: `writeCellConfig` will not write
    // a cell configuration it cannot vouch for.
    const bench = workspace()
    const plugin = pluginWhoseHookNamesAnotherServer(bench.dir)

    const result = await runSelftest({
      rounds: [bench],
      mnemaBin: MNEMA_BIN,
      claudeBin: CLAUDE,
      pluginDir: plugin,
      authMode: 'api-key',
    })

    assert.equal(result.ok, false)
    const detail = result.checks.at(-1).detail
    assert.match(detail, /names the server "plugin:something:else"/)
    assert.match(detail, /not "plugin:mnema:mnema"/)
  })

  test('and clears an unbroken bench — all thirteen checks, by name', async () => {
    const bench = workspace()
    const result = await runSelftest({
      rounds: [bench],
      mnemaBin: MNEMA_BIN,
      claudeBin: CLAUDE,
      authMode: 'api-key',
    })
    // Auth is the one check that depends on the machine, not on the bench.
    assert.deepEqual(
      failed(result).filter((n) => !n.startsWith('auth')),
      [],
      JSON.stringify(result.checks.filter((c) => !c.ok), null, 2),
    )
    // Named, not counted: a preflight that silently stops running a check is the
    // vacuous instrument this file exists against, and `checks.length` alone
    // would still be thirteen if two of them swapped places with each other.
    //
    // TWO OF THESE NAMES MOVED ON 2026-08-20 and the rename is the technique rather than
    // tidying: the two surface checks used to name ONE arm, they walk two arms now, and a
    // name kept would have left this list green over a preflight that still cleared only
    // `mnema+`. The twelfth is new — the gate that would have refused round 3 — and it is
    // SECOND on purpose: it reads three committed files, so a round declaring an arm
    // nobody built is refused before the bench does two minutes of seeding.
    assert.deepEqual(result.checks.map((c) => c.name), [
      'tasks found',
      'toolchain',
      'every pre-registered round is runnable',
      'fixtures calibrated',
      'fixtures readable',
      'knowledge parity',
      'seeding',
      'sandbox isolation',
      'mnema answers over MCP',
      ARRIVES,
      REACHES,
      'split frozen',
      'auth (api-key)',
    ])
  })
})
