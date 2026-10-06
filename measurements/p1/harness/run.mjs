#!/usr/bin/env node
// The harness of the P1 protocol — one cell for each arm.
//
//   node run.mjs --selftest              refuse or clear the run. No model is called.
//   node run.mjs --pilot --yes           1 fixture x every arm x 1 run.
//   node run.mjs --full --yes            every fixture of the round x every arm x n runs.
//   node run.mjs --cell a1-rounding mnema 1 --yes
//
// NOTHING that costs money runs without `--yes`, and nothing runs at all until
// `--selftest` is green: the preflight is not a convenience, it is the reason
// the numbers can be believed.
//
// AND NOTHING SPENDS OUTSIDE ONE ROUND. `--selftest` clears every round; a mode
// that calls a model runs `--round`'s tasks and no others. Without that, adding a
// round's tasks to the workbench would make `--full` spend them the next time
// anybody typed it — which is spending held-out tasks that were frozen for a
// measurement nobody had designed yet, and no result would say so afterwards.

import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { listFixtures } from './lib/fixtures.mjs'
import { ARMS, servesUnasked } from './lib/seed.mjs'
import { ISOLATION_CHECKLIST, AUTH_MODES } from './lib/isolation.mjs'
import { cliDriftProblem, cliPinProblem } from './lib/pin.mjs'
import { cloneBench, runSelftest } from './lib/selftest.mjs'
import { claudeVersion, mnemaVersion, runCell } from './lib/cell.mjs'
import { INFRASTRUCTURE_FAILURES, QUALIFICATIONS, UNCAPPED_FAILURES } from './lib/result.mjs'
import {
  PREREG,
  REPO_ROOT,
  ROUNDS,
  preregOf,
  armCodeOf,
  cliVersionOf,
  modelOf,
  outputFormatOf,
  planOf,
  readSplit,
  replicaOf,
  refuseUnrunnableRound,
  roundArms,
  scenarioOf,
  sieveOf,
} from './lib/split.mjs'
import { productPluginDir } from './lib/hook.mjs'
import { tasksRoot } from './lib/root.mjs'

/**
 * Where a round's tasks and its calibrator live.
 *
 * Round 1 is at the root of the tasks directory because it was the only round when
 * the bench was built, and its directory is not moved: the digests in its
 * pre-registration are of those bytes at that place, and a move for tidiness is an
 * edit to the record of the order. Round 2 sits beside it, and its `selftest.sh` is
 * a SYMLINK to the one above — one calibrator, not a copy that can drift away from
 * it.
 *
 * THE ROOT ARRIVES FROM OUTSIDE — see `tasksRoot`. It used to be `dirname` of this
 * file's own directory, which was true while this runner was a subdirectory of the
 * tasks and false the moment it was published away from them.
 */
export function benchOf(round) {
  const root = tasksRoot()
  const dir = round === 1 ? root : join(root, `round-${round}`)
  return { round, fixturesDir: join(dir, 'fixtures'), selftestScript: join(dir, 'selftest.sh') }
}

/**
 * Every round, for the preflight. A mode that spends uses one of them.
 *
 * A FUNCTION and not a constant, because `benchOf` refuses when nobody has said
 * where the tasks are. Resolved at module load, `--help` and every import of this
 * file would die of a missing environment variable instead of answering.
 */
export function benches() {
  return ROUNDS.map(benchOf)
}

const DEFAULTS = {
  round: 1,
  mnemaBin: process.env.MNEMA_BENCH_MNEMA || join(REPO_ROOT, 'packages/code/dist/cli.js'),
  claudeBin: process.env.MNEMA_BENCH_CLAUDE || 'claude',
  // The product's plugin directory, in the working tree. What the surface arm runs is
  // the file it ships, and the run prints this path so a result says which artefact it
  // measured.
  pluginDir: productPluginDir(),
  runs: 4,
  authMode: 'copy',
}

function parseArgv(argv) {
  const opts = {
    mode: null,
    cell: null,
    runs: DEFAULTS.runs,
    fixture: null,
    arm: null,
    yes: false,
    keep: false,
    outDir: null,
    authMode: DEFAULTS.authMode,
    maxBudgetUsd: null,
    round: DEFAULTS.round,
    resume: false,
    runsGiven: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => argv[(i += 1)]
    switch (a) {
      case '--selftest': opts.mode = 'selftest'; break
      case '--pilot': opts.mode = 'pilot'; break
      case '--full': opts.mode = 'full'; break
      case '--replica': opts.mode = 'replica'; break
      case '--sieve': opts.mode = 'sieve'; break
      case '--resume': opts.resume = true; break
      case '--cell': opts.mode = 'cell'; opts.cell = [next(), next(), Number(next())]; break
      case '--runs': opts.runs = Number(next()); opts.runsGiven = true; break
      case '--round': opts.round = Number(next()); break
      case '--fixture': opts.fixture = next(); break
      case '--arm': opts.arm = next(); break
      case '--out': opts.outDir = resolve(next()); break
      case '--auth': opts.authMode = next(); break
      case '--max-budget-usd': opts.maxBudgetUsd = Number(next()); break
      case '--yes': opts.yes = true; break
      case '--keep': opts.keep = true; break
      case '-h':
      case '--help': opts.mode = 'help'; break
      default:
        throw new Error(`unknown option: ${a}`)
    }
  }
  if (!AUTH_MODES.includes(opts.authMode)) {
    throw new Error(`--auth must be one of ${AUTH_MODES.join(', ')}`)
  }
  if (!ROUNDS.includes(opts.round)) {
    throw new Error(`--round must be one of ${ROUNDS.join(', ')}`)
  }
  return opts
}

function usage() {
  console.log(`the P1 harness — one cell for each arm

  --selftest                     run every preflight check and stop. No model is called.
  --pilot                        the split's pilot task x the ROUND's arms x 1 run
  --sieve                        the ROUND's declared candidates x its sieve arm x its
                                 sieve runs, all three read from the frozen split
  --full                         every fixture x the ROUND's arms x --runs, or, when the
                                 ROUND's split declares a plan, that plan over its held-out
                                 tasks (this harness seeds ${ARMS.length}; a round declares
                                 which of them it runs, and round 3 declares four)
  --replica                      the ROUND's declared replica: its model, its families, its
                                 arms and its runs, all read from the frozen split
  --cell <fixture> <arm> <run>   one cell
  --runs <n>                     repetitions per (fixture, arm)   [${DEFAULTS.runs}]
  --round <${ROUNDS.join('|')}>                  which round's tasks a spending mode runs
                                 [${DEFAULTS.round}]. --selftest always clears every round
  --fixture <id>                 restrict to one fixture
  --arm <${ARMS.join('|')}>
  --auth <${AUTH_MODES.join('|')}>  how a cell authenticates          [${DEFAULTS.authMode}]
  --max-budget-usd <n>           per-cell ceiling passed to the CLI
  --out <dir>                    where results and raw output land
                                 [measurements/p1/results/<date>-<mode>]
  --resume                       skip the (fixture, arm, run) cells the capture at --out
                                 already holds with status ok. For a stage that spends
                                 across more than one sitting
  --keep                         do not destroy the sandboxes
  --yes                          required by anything that calls a model
`)
}

/**
 * The order cells run in — over the arms the ROUND declares, never over all of them.
 *
 * THE ARMS ARE A PARAMETER, and they had to become one for round 3. Until then every
 * round that declared arms declared the harness's whole list, so reading `ARMS` here and
 * reading the round's own field were the same thing and nothing said which one this was.
 * Round 3 declares four of six and withdraws two in writing: planned from `ARMS`, a
 * `--full` of it would spend the two withdrawn arms over eight held-out tasks. The
 * caller reads them from the pre-registration through `roundArms`.
 *
 * Arms are rotated per (run, fixture) so no arm is systematically first. A
 * machine that gets slower or busier over a long run would otherwise put that
 * drift on whichever arm always went last, and the cost and duration columns
 * would carry it.
 */
export function cellPlan(fixtures, runs, arms = ARMS) {
  if (arms.length === 0) throw new Error('a plan over no arms is not a plan')
  const plan = []
  for (let run = 1; run <= runs; run += 1) {
    fixtures.forEach((fixture, fi) => {
      const offset = (run - 1 + fi) % arms.length
      for (let k = 0; k < arms.length; k += 1) {
        plan.push({ fixture, arm: arms[(offset + k) % arms.length], run })
      }
    })
  }
  return plan
}

/**
 * The pilot's cells — one task, every arm, one run.
 *
 * The task is the one the SPLIT names, never whichever one sorts first. Those two
 * are the same task today, which is exactly the shape that rots: a pilot picked by
 * alphabetical accident starts spending a held-out task the day somebody adds an
 * `a0-…`, and nothing in the run would say so. A pilot over a held-out task is the
 * one mistake this protocol cannot undo, so it is read from the file that was
 * frozen rather than derived here.
 */
export function pilotPlan(fixtures, split = readSplit(), arms = ARMS) {
  const chosen = fixtures.find((f) => f.id === split.pilot)
  if (!chosen) throw new Error(`the split names ${split.pilot} as the pilot, and it is not in this run`)
  return cellPlan([chosen], 1, arms)
}

/**
 * The sieve's cells — the round's declared candidates, its sieve arm, its sieve runs.
 *
 * ALL THREE COME OUT OF THE FROZEN SPLIT and none of them is a parameter, for the reason
 * `pilotPlan` reads the pilot from there instead of taking whichever task sorts first: a
 * sieve is only worth anything if what it ran over was fixed before it ran, and a set
 * typed at the prompt is a set nobody can check afterwards. `--full --arm <x> --runs <n>`
 * would have done the same work over the round's WHOLE task list — the development tasks
 * and the negative controls included — which is four tasks nothing declared, spent on a
 * stage whose own file says which sixteen it is about.
 *
 * It refuses a round with no sieve by name, and it refuses a sieve whose arm the round
 * does not run: an arm outside `arms` would be seeded here and have no column in the
 * comparison it is selecting tasks for.
 */
export function sievePlan(fixtures, sieve, arms) {
  if (sieve === null) {
    throw new Error('this round declares no sieve, and a sieve this file invents is not one')
  }
  if (!arms.includes(sieve.arm)) {
    throw new Error(
      `the sieve names ${sieve.arm} and this round runs the arms [${arms.join(', ')}]: ` +
        'a sieve on an arm the comparison does not carry selects tasks for nobody',
    )
  }
  const chosen = sieve.candidates.map((id) => {
    const fixture = fixtures.find((f) => f.id === id)
    if (!fixture) throw new Error(`the sieve names ${id} as a candidate, and it is not in this run`)
    return fixture
  })
  return cellPlan(chosen, sieve.runs, [sieve.arm])
}

/**
 * The cells a round's DECLARED plan names — each entry's families, arms and runs, over the round's
 * held-out tasks — in the order of the entries.
 *
 * THE PLAN IS READ FROM THE SPLIT, never typed, for the reason the pilot and the sieve are: a round
 * that measures its families with different numbers of runs, and one arm on two families only,
 * cannot be said by one `--runs`, and a plan typed at the prompt is a plan nobody can check. A
 * development task is never planned here; it is the pilot's.
 */
export function declaredPlan(fixtures, entries, { heldOut, scenarioOf }) {
  const plan = []
  for (const entry of entries) {
    const chosen = fixtures.filter((f) => heldOut.includes(f.id) && entry.scenarios.includes(scenarioOf(f.id)))
    if (chosen.length === 0) throw new Error(`a declared entry over [${entry.scenarios}] reaches no held-out task`)
    plan.push(...cellPlan(chosen, entry.runs, entry.arms))
  }
  return plan
}

/**
 * The cells of `plan` a capture does not already hold, so a stage can spend across sittings.
 *
 * WHY THIS EXISTS, and it is not convenience. Round 4's sieve is 128 cells on one arm, and the
 * account's session limit stopped the first attempt 55 cells in — every cell after that came
 * back as the vendor refusing to run. Without a resume the choice is to re-spend the 22 cells
 * that were real or to drive the remainder one `--cell` at a time, each paying the whole
 * preflight again. Both are worse than reading the capture.
 *
 * IT SKIPS ONLY WHAT RESOLVED. A line whose status is not `ok` is not a result — a vendor
 * refusal, a half-applied seed, a discriminant that would not load — and the round's own
 * reading rule says such a cell is re-run and both attempts are kept. So it is planned again,
 * and the failed line stays where it is: this function never edits a capture, it only reads
 * one.
 *
 * AND IT APPENDS INTO THE SAME FILE, which is the rule the results directory already keeps: a
 * capture that is silently replaced destroys the only evidence that the difference existed. A
 * run that is stopped and resumed is one capture; a run that is repeated is a second directory.
 */
export function cellsNotYetRun(plan, resultsPath) {
  if (!existsSync(resultsPath)) return plan
  // THE RE-RUN RULE, pre-registered for round 5 and the rule for every resume since: a cell goes
  // back into the plan ONLY for a failure of the infrastructure that the capture classifies
  // (`failure`, `lib/result.mjs`). A cell that reached a verdict — whichever, `BROKEN` included —
  // is a result and never runs again; a failure that is not the infrastructure's (a seed, a
  // discriminant) counts as an error and never runs again either. A quota refusal is waiting and
  // goes back every time; any other infrastructure failure goes back ONCE, and after a second it
  // counts as an error toward the round's ceiling. Every attempt stays in the capture.
  const done = new Set()
  const capped = new Map()
  for (const line of readFileSync(resultsPath, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      throw new Error(`${resultsPath} holds a line that is not JSON: a capture cannot be resumed from`)
    }
    const key = `${row.fixture}\u0000${row.arm}\u0000${row.run}`
    const infrastructure = row.status !== 'ok' && INFRASTRUCTURE_FAILURES.includes(row.failure)
    if (row.status === 'ok') done.add(key)
    else if (!infrastructure) done.add(key)
    else if (!UNCAPPED_FAILURES.includes(row.failure)) {
      capped.set(key, (capped.get(key) ?? 0) + 1)
      if (capped.get(key) >= 2) done.add(key)
    }
  }
  return plan.filter((c) => !done.has(`${c.fixture.id}\u0000${c.arm}\u0000${c.run}`))
}

/**
 * Where a stage's capture lives. Named by the operator (`--out`, and a pre-registration names it
 * for each phase), or dated by today when a stage starts fresh.
 *
 * A RESUME NAMES ITS CAPTURE OR DOES NOT RUN. Defaulted, a resume on the day after a stop would open
 * a new dated directory and plan the WHOLE stage again — every cell already spent spent twice, and
 * the first capture left as a second, partial copy of the same stage.
 */
export function captureDir({ outDir = null, mode, resume = false, today = new Date() }) {
  if (resume && !outDir) {
    throw new Error('--resume needs --out <the capture to resume>: without it a new capture would be opened and the stage spent again')
  }
  return outDir ?? join(PREREG.results, `${today.toISOString().slice(0, 10)}-${mode}`)
}

/**
 * The CLI version the first line of a capture was taken on, or `null` when there is no capture or
 * its first line carries none (a line from before the key, which no round that can be resumed has).
 */
export function firstCliOfCapture(resultsPath) {
  if (!existsSync(resultsPath)) return null
  const first = readFileSync(resultsPath, 'utf8')
    .split('\n')
    .find((line) => line.trim() !== '')
  if (first === undefined) return null
  try {
    return JSON.parse(first).cli_version ?? null
  } catch {
    throw new Error(`${resultsPath} holds a line that is not JSON: a capture cannot be resumed from`)
  }
}

async function main() {
  const opts = parseArgv(process.argv.slice(2))
  if (!opts.mode || opts.mode === 'help') {
    usage()
    process.exit(opts.mode ? 0 : 1)
  }

  if (!existsSync(DEFAULTS.mnemaBin)) {
    console.error(`no mnema build at ${DEFAULTS.mnemaBin} — run \`pnpm build\` first`)
    process.exit(1)
  }

  const selftest = await runSelftest({
    rounds: benches(),
    mnemaBin: DEFAULTS.mnemaBin,
    claudeBin: DEFAULTS.claudeBin,
    pluginDir: DEFAULTS.pluginDir,
    authMode: opts.authMode,
    onCheck: (c) => {
      const mark = c.ok ? 'ok  ' : 'FAIL'
      console.log(`${mark}  ${c.name}${c.detail ? `\n      ${c.detail.replace(/\n/g, '\n      ')}` : ''}`)
    },
  })

  console.log('')
  if (!selftest.ok) {
    console.log('the run does not start')
    process.exit(1)
  }
  console.log('every check passed')

  if (opts.mode === 'selftest') {
    console.log('\nwhat a cell holds fixed:')
    for (const [flag, why] of ISOLATION_CHECKLIST) console.log(`  ${flag.padEnd(34)} ${why}`)
    console.log(`\nqualifications carried in every result line:`)
    for (const [k, v] of Object.entries(QUALIFICATIONS)) console.log(`  ${k}: ${v}`)
    process.exit(0)
  }

  // --- from here on, a model would be called ---------------------------------
  //
  // The round is what decides which tasks exist for this run, and the arms are
  // what decides whether it may happen at all: `refuseUnrunnableRound` throws when
  // the round's own pre-registration declares arms this harness cannot seed.
  const bench = benchOf(opts.round)
  const split = readSplit(preregOf(opts.round).split)
  refuseUnrunnableRound(opts.round)
  // The arms of THIS round, and every plan below is built from them. A round that
  // withdrew an arm in writing must not have it planned — `roundArms` is where that is
  // read, and `--arm` and `--cell` are checked against it rather than against the
  // harness's whole list, so asking for a withdrawn arm is a refusal by name instead of
  // an empty plan or a cell nobody asked for.
  const arms = roundArms(opts.round)

  let fixtures = listFixtures(bench.fixturesDir)
  if (opts.fixture) fixtures = fixtures.filter((f) => f.id === opts.fixture)
  if (fixtures.length === 0) throw new Error(`no fixture matches --fixture ${opts.fixture}`)

  let plan
  if (opts.mode === 'cell') {
    const [id, arm, run] = opts.cell
    const fixture = fixtures.find((f) => f.id === id)
    if (!fixture) throw new Error(`no such fixture: ${id} (round ${opts.round})`)
    if (!arms.includes(arm)) {
      throw new Error(`round ${opts.round} runs the arms [${arms.join(', ')}] and not ${arm}`)
    }
    plan = [{ fixture, arm, run }]
  } else if (opts.mode === 'pilot') {
    plan = pilotPlan(fixtures, split, arms)
  } else if (opts.mode === 'sieve') {
    plan = sievePlan(fixtures, sieveOf(preregOf(opts.round)), arms)
  } else if (opts.mode === 'replica') {
    const replica = replicaOf(preregOf(opts.round))
    if (replica === null) throw new Error(`round ${opts.round} declares no replica, and a replica this file invents is not one`)
    plan = declaredPlan(fixtures, replica.plan, { heldOut: split.held_out, scenarioOf: (id) => scenarioOf(preregOf(opts.round), id) })
  } else if (planOf(preregOf(opts.round)) !== null) {
    if (opts.runsGiven) throw new Error(`round ${opts.round} declares its plan, runs included: --runs would replace a frozen number`)
    plan = declaredPlan(fixtures, planOf(preregOf(opts.round)), {
      heldOut: split.held_out,
      scenarioOf: (id) => scenarioOf(preregOf(opts.round), id),
    })
  } else {
    plan = cellPlan(fixtures, opts.runs, arms)
  }
  if (opts.arm) {
    if (!arms.includes(opts.arm)) {
      throw new Error(`round ${opts.round} runs the arms [${arms.join(', ')}] and not ${opts.arm}`)
    }
    plan = plan.filter((c) => c.arm === opts.arm)
  }

  // Results land in the COMMITTED tree by default. They used to land inside the
  // workbench, which git ignores — a protocol that asks for a result per cell
  // committed, writing where nothing can be committed from.
  const outDir = captureDir({ outDir: opts.outDir, mode: opts.mode, resume: opts.resume })
  const resultsPath = join(outDir, 'cells.jsonl')
  if (!opts.resume && existsSync(resultsPath)) {
    throw new Error(`${resultsPath} already holds a capture: resume it with --resume, or name another --out`)
  }

  if (opts.resume) {
    const wanted = plan.length
    plan = cellsNotYetRun(plan, resultsPath)
    console.log(`\nresuming: ${wanted - plan.length} of ${wanted} cells already resolved in the capture`)
    if (plan.length === 0) {
      console.log('nothing left to run')
      process.exit(0)
    }
  }

  const prereg = preregOf(opts.round)
  const outputFormat = outputFormatOf(prereg)
  // The replica's cells run on the replica's model, and on no other; every other cell on the round's.
  const model = opts.mode === 'replica' ? replicaOf(prereg).model : modelOf(prereg)
  console.log(`\n${plan.length} cells, model ${model}, output ${outputFormat}`)
  console.log(`results: ${resultsPath}`)
  if (plan.some((c) => servesUnasked(c.arm))) {
    console.log(`surface under measurement: ${DEFAULTS.pluginDir}`)
  }
  if (!opts.yes) {
    console.log('\nthis spends real budget. Re-run with --yes to start.')
    process.exit(2)
  }

  mkdirSync(outDir, { recursive: true })
  const versions = {
    cli: claudeVersion(DEFAULTS.claudeBin),
    mnema: mnemaVersion(DEFAULTS.mnemaBin),
  }

  // A RESUMED STAGE IS ONE CAPTURE, so "the CLI the first cell ran on" is the one the capture's own
  // first line says, not the one this sitting happens to start with: the session limit that stops a
  // stage is also the gap in which the CLI updates itself.
  const firstCli = opts.resume ? (firstCliOfCapture(resultsPath) ?? versions.cli) : versions.cli
  const done = runPlan({
    plan,
    round: opts.round,
    declaredCli: cliVersionOf(prereg),
    firstCli,
    readCli: () => claudeVersion(DEFAULTS.claudeBin),
    runOne: ({ fixture, arm, run }) =>
      runCell({
        fixture,
        arm,
        run,
        round: opts.round,
        claudeBin: DEFAULTS.claudeBin,
        mnemaBin: DEFAULTS.mnemaBin,
        pluginDir: DEFAULTS.pluginDir,
        authMode: opts.authMode,
        outDir,
        resultsPath,
        keepSandbox: opts.keep,
        maxBudgetUsd: opts.maxBudgetUsd,
        versions,
        outputFormat,
        model,
        scenario: scenarioOf(prereg, fixture.id),
        armCode: armCodeOf(prereg, arm),
      }).line,
  })
  console.log(`\nwrote ${done.ran} lines to ${resultsPath}`)
  if (done.stopped) {
    console.error(`\nthe round stopped after ${done.ran} of ${plan.length} cells: ${done.stopped}`)
    process.exit(1)
  }
}

/**
 * Run the planned cells, one at a time, and refuse to continue on a CLI that is not the round's.
 *
 * THE LOOP WAS INLINE IN `main` AND IT IS HERE BECAUSE A GUARD THAT LIVES IN A FUNCTION CALLED
 * ONLY AFTER A TEN-MINUTE PREFLIGHT CANNOT BE EXERCISED BY A TEST. The two refusals are
 * `lib/pin.mjs`'s: the round declares a CLI and the machine's is another (nothing runs), and the
 * CLI is not the one the first cell ran on (the round stops at that cell, keeps what it has, and
 * says so). `runOne` is the only thing that spends; it is injected so that a test can count how
 * many times it was reached.
 *
 * Returns `{ ran, stopped }`; `stopped` is a sentence when the round ended early. It throws for the
 * declared-version refusal, because that one is decided before any cell exists.
 */
export function runPlan({ plan, round, declaredCli, firstCli, readCli, runOne, log = console.log }) {
  const pinned = cliPinProblem({ round, declared: declaredCli, actual: firstCli })
  if (pinned) throw new Error(pinned)
  let ran = 0
  for (const cell of plan) {
    const drift = cliDriftProblem({ first: firstCli, now: readCli() })
    if (drift) return { ran, stopped: drift }
    ran += 1
    log(`[${ran}/${plan.length}] ${cell.fixture.id} ${cell.arm} r${cell.run} ...`)
    const line = runOne(cell)
    log(`    ${line.status === 'ok' ? line.verdict : `${line.status}: ${line.error}`}`)
  }
  return { ran, stopped: null }
}

export { cloneBench }


if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
}
