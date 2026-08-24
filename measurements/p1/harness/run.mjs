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
import { existsSync, mkdirSync } from 'node:fs'
import { listFixtures } from './lib/fixtures.mjs'
import { ARMS, servesUnasked } from './lib/seed.mjs'
import { ISOLATION_CHECKLIST, MODEL, AUTH_MODES } from './lib/isolation.mjs'
import { cloneBench, runSelftest } from './lib/selftest.mjs'
import { claudeVersion, mnemaVersion, runCell } from './lib/cell.mjs'
import { QUALIFICATIONS } from './lib/result.mjs'
import {
  PREREG,
  REPO_ROOT,
  ROUNDS,
  preregOf,
  readSplit,
  refuseUnrunnableRound,
  roundArms,
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
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => argv[(i += 1)]
    switch (a) {
      case '--selftest': opts.mode = 'selftest'; break
      case '--pilot': opts.mode = 'pilot'; break
      case '--full': opts.mode = 'full'; break
      case '--sieve': opts.mode = 'sieve'; break
      case '--cell': opts.mode = 'cell'; opts.cell = [next(), next(), Number(next())]; break
      case '--runs': opts.runs = Number(next()); break
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
  --full                         every fixture x the ROUND's arms x --runs
                                 (this harness seeds ${ARMS.length}; a round declares
                                 which of them it runs, and round 3 declares four)
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
  const stamp = new Date().toISOString().slice(0, 10)
  const outDir = opts.outDir ?? join(PREREG.results, `${stamp}-${opts.mode}`)
  const resultsPath = join(outDir, 'cells.jsonl')

  console.log(`\n${plan.length} cells, model ${MODEL}`)
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

  let n = 0
  for (const { fixture, arm, run } of plan) {
    n += 1
    process.stdout.write(`[${n}/${plan.length}] ${fixture.id} ${arm} r${run} ... `)
    const { line } = runCell({
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
    })
    console.log(line.status === 'ok' ? line.verdict : `${line.status}: ${line.error}`)
  }
  console.log(`\nwrote ${plan.length} lines to ${resultsPath}`)
}

export { cloneBench }


if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
}
