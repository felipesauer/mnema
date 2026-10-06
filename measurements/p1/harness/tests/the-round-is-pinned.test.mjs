// The model and the CLI are the pre-registration's — and a round does not run on another.
//
// Nothing here spends: the "CLI" is a script that prints a version, and the cells that matter
// are counted, not run. What is asserted is that the refusal happens BEFORE the cell that would
// have cost something, and that rounds 1 to 4, which declare neither, are not touched.

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { carriesDecision, listFixtures } from '../lib/fixtures.mjs'
import { claudeVersion, runCell } from '../lib/cell.mjs'
import { MODEL, claudeArgv } from '../lib/isolation.mjs'
import { cliDriftProblem, cliPinProblem } from '../lib/pin.mjs'
import { ROUNDS, cliVersionOf, modelOf, preregOf, readSplit } from '../lib/split.mjs'
import { modelNote } from '../lib/result.mjs'
import { removeInside, sandboxRoot } from '../lib/sandbox.mjs'
import { firstCliOfCapture, runPlan } from '../run.mjs'
import { FIXTURES_DIR, HARNESS_DIR, MNEMA_BIN, vendorResult } from './helpers.mjs'

const axisA = listFixtures(FIXTURES_DIR).find((f) => carriesDecision(f.axis))
const scratch = []

after(() => {
  for (const dir of scratch) removeInside(sandboxRoot(), dir)
})

function scratchDir() {
  const dir = mkdtempSync(join(sandboxRoot(), 'mnema-bench-pin-'))
  scratch.push(dir)
  return dir
}

/** A `claude` that answers `--version` from a list, one answer per call, then repeats the last. */
function claudeThatReports(versions) {
  const dir = scratchDir()
  const counter = join(dir, 'calls')
  writeFileSync(counter, '0')
  const path = join(dir, 'claude')
  writeFileSync(
    path,
    `#!/bin/sh\nn=$(cat ${counter}); echo $((n+1)) > ${counter}\ncase "$n" in\n${versions
      .map((v, i) => `${i}) echo "${v}";;`)
      .join('\n')}\n*) echo "${versions.at(-1)}";;\nesac\n`,
  )
  chmodSync(path, 0o755)
  return path
}

const cells = (n) => Array.from({ length: n }, (_, i) => ({ fixture: { id: `t${i}` }, arm: 'base', run: 1 }))
const ok = { status: 'ok', verdict: 'CONFORMS' }

describe('the sentences', () => {
  test('a round that declares no CLI is never refused for one', () => {
    assert.equal(cliPinProblem({ round: 4, declared: null, actual: '9.9.9 (Claude Code)' }), null)
  })

  test('a declared CLI that is the machine’s is no problem; another one is, and it names both', () => {
    assert.equal(cliPinProblem({ round: 5, declared: '2.1.281 (Claude Code)', actual: '2.1.281 (Claude Code)' }), null)
    assert.match(
      cliPinProblem({ round: 5, declared: '2.1.281 (Claude Code)', actual: '2.1.300 (Claude Code)' }),
      /round 5 declares the CLI "2\.1\.281 \(Claude Code\)" and this machine's is "2\.1\.300 \(Claude Code\)": the round does not start/,
    )
  })

  test('a machine whose CLI does not answer is not a match for a declared one', () => {
    assert.match(cliPinProblem({ round: 5, declared: '2.1.281', actual: null }), /not answering `--version`/)
  })

  test('drift is any change from the first cell, and none is no problem', () => {
    assert.equal(cliDriftProblem({ first: 'a', now: 'a' }), null)
    assert.match(cliDriftProblem({ first: 'a', now: 'b' }), /was "a" at the first cell and is "b" now/)
    assert.match(cliDriftProblem({ first: 'a', now: null }), /is not answering now/)
  })
})

describe('the round does not start on another CLI', () => {
  test('a declared version that differs aborts BEFORE the first cell — not one is run', () => {
    let reached = 0
    assert.throws(
      () =>
        runPlan({
          plan: cells(3),
          round: 5,
          declaredCli: '2.1.281 (Claude Code)',
          firstCli: '2.1.300 (Claude Code)',
          readCli: () => '2.1.300 (Claude Code)',
          runOne: () => {
            reached += 1
            return ok
          },
          log: () => {},
        }),
      /the round does not start/,
    )
    assert.equal(reached, 0)
  })

  test('the same plan runs whole when the CLI is the declared one', () => {
    let reached = 0
    const done = runPlan({
      plan: cells(3),
      round: 5,
      declaredCli: '2.1.281 (Claude Code)',
      firstCli: '2.1.281 (Claude Code)',
      readCli: () => '2.1.281 (Claude Code)',
      runOne: () => {
        reached += 1
        return ok
      },
      log: () => {},
    })
    assert.deepEqual(done, { ran: 3, stopped: null })
    assert.equal(reached, 3)
  })
})

describe('and does not go on after the CLI changes under it', () => {
  test('a CLI that updates itself after two cells stops the round at the third, and says so', () => {
    // The real `claudeVersion`, against a script: the first answer is the run's own (the one
    // `main` takes before the loop), the next two are the checks before cell 1 and 2, and the
    // fourth, before cell 3, finds another.
    const bin = claudeThatReports(['2.1.1 (Claude Code)', '2.1.1 (Claude Code)', '2.1.1 (Claude Code)', '2.1.2 (Claude Code)'])
    const first = claudeVersion(bin)
    let reached = 0
    const done = runPlan({
      plan: cells(5),
      round: 5,
      declaredCli: null,
      firstCli: first,
      readCli: () => claudeVersion(bin),
      runOne: () => {
        reached += 1
        return ok
      },
      log: () => {},
    })
    assert.equal(done.ran, 2)
    assert.equal(reached, 2, 'the cell after the change was not spent')
    assert.match(done.stopped, /was "2\.1\.1 \(Claude Code\)" at the first cell and is "2\.1\.2 \(Claude Code\)" now/)
  })

  test('and it holds for a round that declares nothing too — a capture on two CLIs is two instruments', () => {
    const done = runPlan({
      plan: cells(2),
      round: 1,
      declaredCli: null,
      firstCli: 'a',
      readCli: () => 'b',
      runOne: () => assert.fail('a cell was spent on a CLI that is not the first one'),
      log: () => {},
    })
    assert.equal(done.ran, 0)
    assert.ok(done.stopped)
  })
})

describe('the loop that main runs is this one', () => {
  test('main hands runPlan the declared version, the first one and a reader of the machine’s', () => {
    // `firstCli` is `versions.cli` for a fresh run and the capture's own first line for a resumed one.
    // THE LINK, and it is structural because main cannot be driven without paying for a
    // preflight of minutes. The assertion is that the production path passes every argument
    // that makes the guard able to fire: a runPlan called without `declaredCli` would clear any
    // CLI and be green here in the cases above.
    const source = readFileSync(join(HARNESS_DIR, 'run.mjs'), 'utf8')
    const call = source.slice(source.indexOf('const done = runPlan({'))
    for (const needed of ['declaredCli: cliVersionOf(prereg)', 'firstCli,', 'readCli: () => claudeVersion(', 'model,', 'outputFormat,']) {
      assert.ok(call.slice(0, 1200).includes(needed), `main's call to runPlan does not pass ${needed}`)
    }
  })
})

describe('the model is the pre-registration’s', () => {
  const written = (extra) => {
    const path = join(scratchDir(), 'split.json')
    writeFileSync(path, JSON.stringify({ frozen_at: 'x', rule: 'x', pilot: 'p', development: ['p'], held_out: [], ...extra }))
    return { split: path }
  }

  test('a round that names none runs on the model rounds 1 to 4 ran on, and declares no CLI', () => {
    for (const round of ROUNDS.filter((r) => r <= 4)) {
      assert.equal(modelOf(preregOf(round)), MODEL, `round ${round}`)
      assert.equal(cliVersionOf(preregOf(round)), null, `round ${round}`)
    }
  })

  test('round 5 names both, and a replica on a second model', () => {
    assert.equal(modelOf(preregOf(5)), 'claude-haiku-4-5-20251001')
    assert.equal(cliVersionOf(preregOf(5)), '2.1.281 (Claude Code)')
    assert.equal(readSplit(preregOf(5).split).replica.model, 'claude-sonnet-5-5')
  })

  test('a round that names one runs on it; a model or CLI that is not a string is refused', () => {
    assert.equal(modelOf(written({ model: 'claude-sonnet-5-5' })), 'claude-sonnet-5-5')
    assert.equal(cliVersionOf(written({ cli_version: '2.1.281 (Claude Code)' })), '2.1.281 (Claude Code)')
    assert.throws(() => modelOf(written({ model: '' })), /"model" is not a model id/)
    assert.throws(() => cliVersionOf(written({ cli_version: 2 })), /"cli_version" is not a version string/)
  })

  test('the model reaches the command line, and the default is unchanged', () => {
    const base = { ticket: 't', settingsPath: '/s', mcpPath: '/m' }
    const argv = claudeArgv({ ...base, model: 'claude-sonnet-5-5' })
    assert.equal(argv[argv.indexOf('--model') + 1], 'claude-sonnet-5-5')
    const def = claudeArgv(base)
    assert.equal(def[def.indexOf('--model') + 1], MODEL)
  })

  test('and the model that ran is what the line says, with a note that does not claim the default model', () => {
    const dir = scratchDir()
    const seen = join(dir, 'argv.json')
    const claudeBin = join(dir, 'claude')
    writeFileSync(
      claudeBin,
      `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(seen)}, JSON.stringify(process.argv.slice(2)))\nprocess.stdout.write(${JSON.stringify(JSON.stringify(vendorResult()))})\n`,
    )
    chmodSync(claudeBin, 0o755)
    const { line } = runCell({
      fixture: axisA,
      arm: 'base',
      run: 1,
      round: 5,
      claudeBin,
      mnemaBin: MNEMA_BIN,
      authMode: 'api-key',
      outDir: null,
      resultsPath: join(dir, 'cells.jsonl'),
      versions: { cli: 'fake', mnema: 'fake' },
      model: 'claude-sonnet-5-5',
    })
    const argv = JSON.parse(readFileSync(seen, 'utf8'))
    assert.equal(argv[argv.indexOf('--model') + 1], 'claude-sonnet-5-5')
    assert.equal(line.model, 'claude-sonnet-5-5')
    assert.equal(line.model_note, modelNote('claude-sonnet-5-5'))
    assert.match(line.model_note, /not the model rounds 1 to 4 ran on/)
    assert.match(modelNote(MODEL), /a weaker model tends to benefit more/)
  })
})

describe('a resumed stage is one capture', () => {
  const capture = (lines) => {
    const dir = scratchDir()
    const path = join(dir, 'cells.jsonl')
    writeFileSync(path, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n')
    return path
  }

  test('the CLI the first cell ran on is the capture’s first line, and no capture means none', () => {
    assert.equal(firstCliOfCapture(join(scratchDir(), 'no-such-capture.jsonl')), null)
    assert.equal(firstCliOfCapture(capture([{ cli_version: '2.1.1 (Claude Code)' }, { cli_version: '2.1.2 (Claude Code)' }])), '2.1.1 (Claude Code)')
    assert.equal(firstCliOfCapture(capture([{ status: 'ok' }])), null, 'a line from before the key says nothing')
    assert.throws(() => firstCliOfCapture(capture(['not json'])), /a capture cannot be resumed from/)
  })

  test('a stage resumed on another CLI stops before the first cell it would spend', () => {
    const path = capture([{ cli_version: '2.1.1 (Claude Code)', status: 'ok' }])
    const done = runPlan({
      plan: cells(3),
      round: 4,
      declaredCli: null,
      firstCli: firstCliOfCapture(path),
      readCli: () => '2.1.2 (Claude Code)',
      runOne: () => assert.fail('a cell was spent on a CLI the capture was not taken on'),
      log: () => {},
    })
    assert.equal(done.ran, 0)
    assert.match(done.stopped, /was "2\.1\.1 \(Claude Code\)" at the first cell and is "2\.1\.2 \(Claude Code\)" now/)
  })

  test('and main reads it from the capture only when it resumes', () => {
    const source = readFileSync(join(HARNESS_DIR, 'run.mjs'), 'utf8')
    assert.ok(source.includes('const firstCli = opts.resume ? (firstCliOfCapture(resultsPath) ?? versions.cli) : versions.cli'))
  })
})

describe('the format the round declares reaches the CLI', () => {
  test('a cell run in stream-json hands the CLI the stream flags, and a json cell does not', () => {
    const argvOf = (outputFormat) => {
      const dir = scratchDir()
      const seen = join(dir, 'argv.json')
      const claudeBin = join(dir, 'claude')
      const result = outputFormat === 'stream-json' ? JSON.stringify({ type: 'result', ...vendorResult() }) : JSON.stringify(vendorResult())
      writeFileSync(claudeBin, `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(seen)}, JSON.stringify(process.argv.slice(2)))\nprocess.stdout.write(${JSON.stringify(result)})\n`)
      chmodSync(claudeBin, 0o755)
      runCell({ fixture: axisA, arm: 'base', run: 1, round: 5, claudeBin, mnemaBin: MNEMA_BIN, authMode: 'api-key', outDir: null, resultsPath: join(dir, 'cells.jsonl'), versions: { cli: 'fake', mnema: 'fake' }, outputFormat })
      return JSON.parse(readFileSync(seen, 'utf8'))
    }
    const stream = argvOf('stream-json')
    assert.equal(stream[stream.indexOf('--output-format') + 1], 'stream-json')
    assert.ok(stream.includes('--verbose') && stream.includes('--include-hook-events'))
    const json = argvOf('json')
    assert.equal(json[json.indexOf('--output-format') + 1], 'json')
    assert.equal(json.includes('--verbose'), false)
  })
})
