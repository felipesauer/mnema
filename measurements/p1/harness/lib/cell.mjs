// One cell: build the sandbox, seed the arm, run the agent, score, write one line, destroy.
//
// THE LINE THIS FILE DRAWS. A cell can fail in two completely different ways and
// they must never be confused:
//
//   the agent disobeyed the record   -> VIOLATES. A result.
//   the harness broke                -> status "harness_error". Not a result.
//
// A missing `claude`, a seed that half-applied, an authentication failure, a
// runtime that cannot load the discriminant — none of those are an agent
// choosing anything, and every one of them would land as VIOLATES if the code
// below scored on exit codes alone. The arm most likely to be measured this way
// is the one WITHOUT the record, whose violations are the expected outcome, so
// the error would confirm the hypothesis.

import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertCleanTree, createSandbox, git, plantRepo } from './sandbox.mjs'
import { assertSeed, seedArm } from './seed.mjs'
import { cellPushedTools, cellPushMatchers, mechanismBefore, mechanismBetween } from './mechanism.mjs'
import { surfaceProblem } from './channel.mjs'
import { cellEnv, claudeArgv, installAuth, writeCellConfig } from './isolation.mjs'
import { runVerify } from './verdict.mjs'
import { appendResult, missingFrom, resultLine } from './result.mjs'
import { readTicket } from './fixtures.mjs'
import { builtProduct } from './build.mjs'

export function claudeVersion(claudeBin) {
  const out = spawnSync(claudeBin, ['--version'], { encoding: 'utf8' })
  if (out.error || out.status !== 0) return null
  return out.stdout.trim()
}

export function mnemaVersion(mnemaBin) {
  const out = spawnSync(process.execPath, [mnemaBin, '--version'], { encoding: 'utf8' })
  if (out.error || out.status !== 0) return null
  return out.stdout.trim()
}

/**
 * Run one cell. Never throws: every failure becomes a line with a status, so a
 * run that hits trouble leaves a record of what happened instead of a gap.
 */
export function runCell({
  fixture,
  arm,
  run,
  // Which round's tasks this cell belongs to. It reaches the line because one caveat
  // there depends on it: the surface arm run over round 1's spent tasks is a mechanism
  // check, and the same arm run over the tasks round 2 froze before the surface existed
  // is not. Nothing else in a line can tell those apart.
  round,
  claudeBin,
  mnemaBin,
  authMode,
  pluginDir,
  outDir,
  resultsPath,
  keepSandbox = false,
  maxBudgetUsd = null,
  timeoutMs = 20 * 60_000,
  versions = {},
}) {
  const startedAt = new Date().toISOString()
  const label = `${fixture.id}-${arm}-r${run}`
  // FIRST, and before the sandbox: the seed already executes the product, so a digest
  // taken later would be of the build that ran the seed and not of the one the cell
  // started on. It is the earliest point at which the cell has touched nothing.
  const build = builtProduct(mnemaBin)
  const sandbox = createSandbox(label)
  let seedOk = false
  let seedDetail = null

  const finish = (fields) => {
    const line = resultLine({
      fixture: fixture.id,
      axis: fixture.axis,
      arm,
      run,
      round,
      startedAt,
      endedAt: new Date().toISOString(),
      cliVersion: versions.cli ?? null,
      mnemaVersion: versions.mnema ?? null,
      build,
      seedOk,
      seedDetail,
      ...fields,
    })
    if (resultsPath) appendResult(resultsPath, line)
    if (!keepSandbox) sandbox.destroy()
    return { line, sandboxRoot: keepSandbox ? sandbox.root : null }
  }

  // --- build and seed -------------------------------------------------------
  try {
    plantRepo(sandbox, fixture)
    seedArm({ arm, fixture, sandbox, mnemaBin })
    assertSeed({ arm, fixture, sandbox, mnemaBin })
    assertCleanTree(sandbox)
    seedOk = true
  } catch (err) {
    seedDetail = err.message
    return finish({ status: 'harness_error', error: `seeding: ${err.message}` })
  }

  // In a try, and it did not use to need one: `writeCellConfig` only wrote JSON
  // until the fifth arm made it READ something — the product's own hook
  // declaration — and a read can fail. This function's contract is that it never
  // throws, so a plugin that cannot be read has to become a line with a status
  // like every other failure. Without this, one unreadable file would abort the
  // whole run instead of recording what happened.
  let settingsPath
  let mcpPath
  try {
    ;({ settingsPath, mcpPath } = writeCellConfig({ sandbox, arm, mnemaBin, pluginDir }))
  } catch (err) {
    return finish({ status: 'harness_error', error: `cell configuration: ${err.message}` })
  }
  const ticket = readTicket(fixture)
  try {
    installAuth(sandbox, authMode)
  } catch (err) {
    return finish({ status: 'harness_error', error: `auth: ${err.message}` })
  }

  // --- run the agent --------------------------------------------------------
  //
  // LAST thing before the spawn, and it has to stay last: the snapshot is what
  // the agent's mechanism columns are measured against, so anything the harness
  // touches after this line would be attributed to the agent.
  const before = mechanismBefore(sandbox)

  const agent = spawnSync(
    claudeBin,
    claudeArgv({ ticket, settingsPath, mcpPath, maxBudgetUsd }),
    {
      cwd: sandbox.repo,
      encoding: 'utf8',
      env: cellEnv(sandbox, { authMode, arm }),
      timeout: timeoutMs,
      maxBuffer: 128 * 1024 * 1024,
      input: '',
    },
  )

  if (outDir) {
    mkdirSync(join(outDir, 'raw'), { recursive: true })
    writeFileSync(join(outDir, 'raw', `${label}.stdout.json`), agent.stdout ?? '')
    writeFileSync(join(outDir, 'raw', `${label}.stderr.txt`), agent.stderr ?? '')
  }

  if (agent.error) {
    return finish({ status: 'harness_error', error: `the agent CLI could not run: ${agent.error.message}` })
  }
  if (agent.signal) {
    return finish({ status: 'harness_error', error: `the agent CLI was killed by ${agent.signal}` })
  }

  let result = null
  try {
    result = JSON.parse(agent.stdout ?? '')
  } catch {
    const head = (agent.stdout || agent.stderr || '').split('\n')[0] ?? ''
    return finish({
      status: 'harness_error',
      error: `the agent CLI wrote no result JSON (exit ${agent.status}): ${head.slice(0, 300)}`,
    })
  }

  const subtype = result?.subtype ?? null
  const truncated = subtype === 'error_max_turns'
  if (subtype !== 'success' && !truncated) {
    return finish({
      status: 'harness_error',
      error: `the agent CLI reported ${subtype ?? 'no subtype'}: ${String(result?.result ?? '').slice(0, 300)}`,
      result,
      missingResultFields: missingFrom(result),
    })
  }

  // --- what the agent produced ---------------------------------------------
  const diff = diffStat(sandbox)
  const mechanism = mechanismBetween(before, sandbox, arm, mnemaBin)
  if (outDir) {
    mkdirSync(join(outDir, 'diffs'), { recursive: true })
    const patch = git(sandbox, ['diff', 'HEAD', ...CODE_ONLY])
    writeFileSync(join(outDir, 'diffs', `${label}.diff`), patch.stdout ?? '')
  }

  // --- was the arm actually delivered? --------------------------------------
  //
  // BEFORE THE SCORE, and that order is the whole point. A cell of the surface arm
  // whose surface never reached it produces exactly what a cell of the `mnema` arm
  // produces, and eight of those read as "the surface did not help" — the wrong
  // finding, with the wrong fix behind it. It is not the agent choosing anything, so
  // it must not become a verdict: it becomes `harness_error`, which the round's own
  // reading rule already handles (re-run once, both attempts kept, a pair still
  // without a result excluded and named). Scoring first and labelling afterwards
  // would leave a verdict in the line for somebody to use.
  //
  // AND IT ASKS WHICH AXIS NOW, which it did not until the round of 2026-08-20 paid for
  // the omission. `surfaceProblem` throws on an axis that is neither A nor B rather than
  // reading an unknown one as a negative control, and this call is NOT wrapped: a bad axis
  // never reaches here, because `assertSeed` above reads the same predicate and refuses
  // the cell before the agent is spawned and before anything is spent. A try here would be
  // code no mutation can turn red — see `8e` in `tests/the-fifth-arm.test.mjs`, which is
  // where that order is asserted instead of assumed.
  const undelivered = surfaceProblem({
    arm,
    axis: fixture.axis,
    mechanism,
    diff,
    pushed: cellPushedTools(sandbox),
    matchers: cellPushMatchers(sandbox),
  })
  if (undelivered) {
    return finish({
      status: 'harness_error',
      error: `the arm was not delivered to this cell: ${undelivered}`,
      exit: null,
      result,
      missingResultFields: missingFrom(result),
      diff,
      mechanism,
      truncated,
    })
  }

  // --- score ----------------------------------------------------------------
  const scored = runVerify(fixture, sandbox.repo)
  if (scored.rulerBroken) {
    return finish({
      status: 'ruler_broken',
      error: `the discriminant refused to score: ${scored.detail}`,
      rulerDetail: scored.detail,
      exit: scored.exit,
      result,
      missingResultFields: missingFrom(result),
      diff,
      mechanism,
      truncated,
    })
  }

  return finish({
    status: 'ok',
    verdict: scored.verdict,
    exit: scored.exit,
    // A BROKEN cell keeps the discriminant's own reason. Round 1's `a5-no-retry`
    // came back four-of-four BROKEN in one arm and the lines said only BROKEN, so
    // telling the task's defect from the agents' failure took a diff read by hand.
    // The sentence was always printed; it was only ever thrown away.
    brokenDetail: scored.verdict === 'BROKEN' ? firstLine(scored.stdout) : null,
    result,
    missingResultFields: missingFrom(result),
    diff,
    mechanism,
    truncated,
  })
}

/** The first line of `text`, trimmed, or null when there is none. */
function firstLine(text) {
  const line = String(text ?? '').split('\n')[0]?.trim()
  return line ? line : null
}

// `mechanismAfter` used to live here, and it counted the files the host's memory
// directory held. The pilot falsified what its doc claimed — see the header of
// `lib/mechanism.mjs`, which carries the premise, the four numbers that killed it
// and what the pair of functions answers now.

/**
 * What the agent wrote, as the three numbers `ponytail` scores on.
 *
 * TWO THINGS `git diff HEAD` GETS WRONG HERE, both silently.
 *
 * A file the agent CREATES is untracked, and untracked files are not in a diff
 * against HEAD — an agent that solved the ticket in a new module would measure
 * as having written nothing. `git add -N` records the intent to add, which puts
 * the file in the diff without staging its contents.
 *
 * And the record is not the agent's code. In the mnema arm the tool writes to
 * `.mnema/` while it serves, so counting it would inflate that arm's lines
 * against three arms that have no such directory. It is excluded by pathspec,
 * and `records_after` reports it separately.
 */
const CODE_ONLY = ['--', '.', ':(exclude).mnema']

function diffStat(sandbox) {
  git(sandbox, ['add', '-N', ...CODE_ONLY])
  const out = git(sandbox, ['diff', '--numstat', 'HEAD', ...CODE_ONLY])
  if (out.status !== 0) return null
  let added = 0
  let removed = 0
  let filesChanged = 0
  for (const row of out.stdout.split('\n')) {
    if (!row.trim()) continue
    const [a, r] = row.split('\t')
    filesChanged += 1
    // A binary file is reported as "-\t-": counted as a file, not as lines.
    if (a !== '-') added += Number(a)
    if (r !== '-') removed += Number(r)
  }
  return { filesChanged, added, removed }
}

/**
 * Build a seeded sandbox and hand it back WITHOUT running a model.
 *
 * This is what `--selftest` and the tests use: everything a cell does up to the
 * moment it would cost money.
 */
export function seededSandbox({ fixture, arm, mnemaBin, label = 'seed' }) {
  const sandbox = createSandbox(`${fixture.id}-${arm}-${label}`)
  plantRepo(sandbox, fixture)
  seedArm({ arm, fixture, sandbox, mnemaBin })
  return sandbox
}

/** Copy a reference implementation over the sandbox repo, as if an agent had written it. */
export function applyReference(sandbox, refDir) {
  cpSync(refDir, sandbox.repo, { recursive: true, filter: (src) => !src.includes('__pycache__') })
}
