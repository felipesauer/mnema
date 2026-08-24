// The three verdicts — and the line between a result and a broken harness.
//
// The lesson is `RULER BROKEN`, from the fixtures' own calibration script: a
// runtime that fails to load the verifier exits 1, and exit 1 is VIOLATES. Here
// the same trap is wider, because a cell has more ways to break than a
// discriminant does — a missing CLI, a refused login, output that is not JSON.
//
// Every one of those would land as VIOLATES if the cell scored on exit codes,
// and VIOLATES is the outcome this experiment EXPECTS from the arm without the
// record. An infrastructure failure would confirm the hypothesis. That is why
// the assertions below are about `status` as much as about `verdict`.

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { listFixtures } from '../lib/fixtures.mjs'
import { runVerify } from '../lib/verdict.mjs'
import { runCell } from '../lib/cell.mjs'
import { sandboxRoot } from '../lib/sandbox.mjs'
import { FIXTURES_DIR, MNEMA_BIN, fakeAgent, vendorResult } from './helpers.mjs'

const fixtures = listFixtures(FIXTURES_DIR)
const fixture = fixtures.find((f) => f.id === 'a1-rounding')
const scratch = []

function workspace() {
  const dir = mkdtempSync(join(sandboxRoot(), 'mnema-bench-verdict-'))
  scratch.push(dir)
  return dir
}

after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

function cellWith(agentOptions, { arm = 'base' } = {}) {
  const dir = workspace()
  const claudeBin = typeof agentOptions === 'string' ? agentOptions : fakeAgent(dir, agentOptions)
  const resultsPath = join(dir, 'cells.jsonl')
  const { line } = runCell({
    fixture,
    arm,
    run: 1,
    claudeBin,
    mnemaBin: MNEMA_BIN,
    authMode: 'api-key',
    outDir: null,
    resultsPath,
    versions: { cli: 'fake', mnema: 'fake' },
  })
  return { line, resultsPath }
}

describe('5 · the runner tells the three verdicts apart', () => {
  test('a conforming implementation scores CONFORMS', () => {
    const { line } = cellWith({ refDir: join(fixture.dir, 'refs/good') })
    assert.equal(line.status, 'ok')
    assert.equal(line.verdict, 'CONFORMS')
    assert.equal(line.exit, 0)
  })

  test('the plausible-but-violating one scores VIOLATES', () => {
    const { line } = cellWith({ refDir: join(fixture.dir, 'refs/bad') })
    assert.equal(line.status, 'ok')
    assert.equal(line.verdict, 'VIOLATES')
    assert.equal(line.exit, 1)
  })

  test('code that does not run scores BROKEN, never VIOLATES', () => {
    const { line } = cellWith({ refDir: null })
    assert.equal(line.status, 'ok')
    assert.equal(line.verdict, 'BROKEN')
    assert.equal(line.exit, 2)
  })

  test('and the BROKEN cell keeps the discriminant’s own reason, in the line', () => {
    // WHY THIS COLUMN EXISTS. Round 1 read one arm of `a5-no-retry` as four BROKEN
    // cells — no scorable cell at all, so no rate — and the lines could not say
    // whether the agents wrote unworkable code or the task's own happy path could
    // not be reached. The answer was the task, and finding it took reading a diff by
    // hand. The discriminant had said it all along, in the sentence it prints.
    const { line } = cellWith({ refDir: null })
    assert.equal(line.verdict, 'BROKEN')
    assert.equal(typeof line.broken_detail, 'string')
    assert.match(line.broken_detail, /^BROKEN /)
    // ONE LINE, not the whole transcript: the reason belongs in the row, and a row
    // that carries an unbounded blob stops being readable as a row.
    assert.ok(!line.broken_detail.includes('\n'), line.broken_detail)

    // NOT VACUOUS, and this is the half a column like this fails in silently: a
    // field that is always a string says nothing. A cell whose code RAN carries
    // null, so the value distinguishes "nothing to report" from "the reason was
    // thrown away".
    const conformed = cellWith({ refDir: join(fixture.dir, 'refs/good') }).line
    assert.equal(conformed.verdict, 'CONFORMS')
    assert.equal(conformed.broken_detail, null)
    const violated = cellWith({ refDir: join(fixture.dir, 'refs/bad') }).line
    assert.equal(violated.verdict, 'VIOLATES')
    assert.equal(violated.broken_detail, null)
    // And the key is written in every line: a missing key and a null key say
    // different things about which round a line came from.
    for (const line of [conformed, violated]) assert.ok('broken_detail' in line)
  })

  test('the vendor numbers are carried through, never derived', () => {
    const result = vendorResult({ total_cost_usd: 0.0777, num_turns: 9 })
    const { line } = cellWith({ refDir: join(fixture.dir, 'refs/good'), result })
    assert.equal(line.cost_usd, 0.0777)
    assert.equal(line.num_turns, 9)
    assert.equal(line.input_tokens, result.usage.input_tokens)
    assert.equal(line.output_tokens, result.usage.output_tokens)
    assert.equal(line.cost_source, 'the vendor result message of the CLI; never estimated')
    assert.deepEqual(line.missing_result_fields, [])
  })

  test('a field the vendor did not send is null and named, never filled in', () => {
    const result = vendorResult()
    delete result.total_cost_usd
    const { line } = cellWith({ refDir: join(fixture.dir, 'refs/good'), result })
    assert.equal(line.cost_usd, null)
    assert.deepEqual(line.missing_result_fields, ['total_cost_usd'])
  })

  test('a file the agent CREATES is counted, and the record is not', () => {
    // Both halves are silent failures of a plain `git diff HEAD`: an untracked
    // file is invisible, and `.mnema/` would be counted as lines the agent wrote
    // in the one arm that has it.
    const refDir = join(workspace(), 'ref-with-a-new-file')
    cpSync(join(fixture.dir, 'refs/good'), refDir, { recursive: true })
    writeFileSync(join(refDir, 'helper.php'), '<?php\n// a module the agent added\n')

    const plain = cellWith({ refDir }).line
    assert.equal(plain.files_changed, 2, 'the edited file and the new one')
    assert.ok(plain.added_lines >= 2)

    const withRecord = cellWith({ refDir }, { arm: 'mnema' }).line
    assert.equal(withRecord.files_changed, 2, 'the record is not the agent’s code')
  })

  test('the line describes both mechanisms — how many files, how many records', () => {
    // This test used to be called "the line says whether the two mechanisms
    // MOVED", and the pilot showed that these three numbers cannot say that: 2 in
    // `host` and 0 in the other three is the seeded state untouched. They are a
    // description of the directory and of the record, and the moving is
    // `tests/mechanism.test.mjs`.
    const base = cellWith({ refDir: join(fixture.dir, 'refs/good') }).line
    assert.equal(base.memory_files_after, 0)
    assert.equal(base.records_after, null)

    const withRecord = cellWith({ refDir: join(fixture.dir, 'refs/good') }, { arm: 'mnema' }).line
    assert.equal(withRecord.records_after, 1, 'the seeded decision is still the only record')

    const withMemory = cellWith({ refDir: join(fixture.dir, 'refs/good') }, { arm: 'host' }).line
    assert.equal(withMemory.memory_files_after, 2, 'the memory file and its index')
  })

  test('the line carries the model, the versions and the qualification', () => {
    const { line, resultsPath } = cellWith({ refDir: join(fixture.dir, 'refs/good') })
    for (const key of [
      'fixture', 'axis', 'arm', 'run', 'model', 'cli_version', 'verdict', 'exit',
      'cost_usd', 'input_tokens', 'output_tokens', 'duration_ms', 'seed_ok',
    ]) {
      assert.ok(key in line, `the result line is missing ${key}`)
    }
    assert.equal(line.model, 'claude-haiku-4-5-20251001')
    assert.match(line.model_note, /ceiling, not the value in real use/)
    const written = readFileSync(resultsPath, 'utf8').trim().split('\n')
    assert.equal(written.length, 1, 'one line per cell')
    assert.deepEqual(JSON.parse(written[0]), line)
  })
})

describe('5b · a broken harness is never an agent that disobeyed', () => {
  test('a missing CLI is a harness error, not a violation', () => {
    const { line } = cellWith(join(workspace(), 'there-is-no-claude-here'))
    assert.equal(line.status, 'harness_error')
    assert.equal(line.verdict, null)
    assert.match(line.error, /could not run/)
  })

  test('output that is not the result JSON is a harness error', () => {
    const { line } = cellWith({ stdout: 'Invalid API key · Please run /login', exitCode: 1 })
    assert.equal(line.status, 'harness_error')
    assert.equal(line.verdict, null)
    assert.match(line.error, /no result JSON/)
  })

  // THIS USED TO BE ONE CASE DRIVEN BY TWO SIGNALS AT ONCE, and only one of them was ever
  // read. It was named for `is_error` and passed on `subtype`, so the `is_error` half of
  // its own name was never a guard — and a vendor refusal that carries `subtype: success`
  // walked straight through it. It is two cases now, one per signal, which is the only
  // shape in which either can be shown to hold on its own.
  test('a result whose SUBTYPE is an error is a harness error', () => {
    const { line } = cellWith({
      refDir: join(fixture.dir, 'refs/bad'),
      result: vendorResult({ subtype: 'error_during_execution', is_error: false }),
    })
    assert.equal(line.status, 'harness_error')
    assert.equal(line.verdict, null, 'a failed session must not be scored as a violation')
    assert.match(line.error, /reported error_during_execution/)
  })

  test('and a result the CLI calls an error while calling it a success is one too', () => {
    // MEASURED, 2026-08-24: the session limit of an account produces exactly this shape,
    // and 34 cells of a 128-cell sieve came back in it. The agent never ran, so the
    // starting repository was untouched, so the discriminant said BROKEN — and the line
    // said `ok` with a verdict. A vendor refusing to run is not an agent that disobeyed.
    const { line } = cellWith({
      refDir: join(fixture.dir, 'refs/bad'),
      result: vendorResult({
        subtype: 'success',
        is_error: true,
        api_error_status: 429,
        terminal_reason: 'api_error',
        num_turns: 1,
        total_cost_usd: 0,
        result: "You've hit your session limit · resets 5:50pm (UTC)",
      }),
    })
    assert.equal(line.status, 'harness_error')
    assert.equal(line.verdict, null, 'a cell the vendor refused must not be scored')
    assert.match(line.error, /HTTP 429/)
    assert.match(line.error, /terminal_reason api_error/)
    assert.match(line.error, /session limit/)
  })

  test('but a TRUNCATED session is an error the CLI means differently, and it is still scored', () => {
    // `error_max_turns` arrives with `is_error: true` and the session DID work. The gate
    // above must not swallow it, or a cell that ran out of turns would stop producing a
    // verdict it has always produced — which is the regression the exclusion exists for.
    const { line } = cellWith({
      refDir: join(fixture.dir, 'refs/good'),
      result: vendorResult({ subtype: 'error_max_turns', is_error: true }),
    })
    assert.equal(line.status, 'ok')
    assert.equal(line.truncated, true)
    assert.equal(line.verdict, 'CONFORMS', 'a truncated session that produced work is scored')
  })

  test('a seed that cannot be applied is a harness error, and the cell never runs', () => {
    const dir = workspace()
    const claudeBin = fakeAgent(dir, { refDir: join(fixture.dir, 'refs/bad') })
    const { line } = runCell({
      fixture,
      arm: 'mnema',
      run: 1,
      claudeBin,
      mnemaBin: join(dir, 'no-mnema-here.js'),
      authMode: 'api-key',
      outDir: null,
      resultsPath: join(dir, 'cells.jsonl'),
      versions: {},
    })
    assert.equal(line.status, 'harness_error')
    assert.equal(line.seed_ok, false)
    assert.equal(line.verdict, null)
    assert.match(line.error, /^seeding:/)
  })

  test('a discriminant that prints no verdict is RULER BROKEN, not VIOLATES', () => {
    const broken = {
      ...fixture,
      // A runner that cannot load the verifier: exits non-zero with no verdict,
      // which reads as VIOLATES to anything that trusts the exit code.
      verify: join(workspace(), 'there-is-no-verifier.php'),
    }
    const scored = runVerify(broken, fixture.repo)
    assert.equal(scored.verdict, null)
    assert.equal(scored.rulerBroken, true)
    assert.match(scored.detail, /printed no verdict/)
  })

  test('a discriminant whose word and exit code disagree is RULER BROKEN', () => {
    const liar = join(workspace(), 'verify.js')
    writeFileSync(liar, 'process.stdout.write("CONFORMS all good\\n"); process.exit(1)\n')
    const scored = runVerify({ ...fixture, runner: 'node', verify: liar }, fixture.repo)
    assert.equal(scored.verdict, null)
    assert.equal(scored.rulerBroken, true)
    assert.match(scored.detail, /said CONFORMS but exited 1/)
  })
})
