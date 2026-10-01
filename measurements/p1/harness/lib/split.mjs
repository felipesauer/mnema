// The pre-registration, read from the repository — and the ONE place that says
// which task is a development task.
//
// It lives under `measurements/p1/`, committed, because a split is worth exactly
// what the ORDER is worth: a division written after a result is not a division,
// it is a choice of which number to keep. The harness reads that file rather than
// holding a copy of the same list, because two readings of one rule is the shape
// that drifts in silence — and the drift here would be a pilot quietly spending a
// held-out task, which is the one mistake this protocol cannot undo.
//
// WHAT THIS MODULE CHECKS THAT THE COMMITTED TESTS CANNOT. The tasks live in a
// workbench git ignores, so the case that ships with the product can only check
// the pre-registration against itself. Comparing it to the tasks ON DISK — every
// task covered, every hash still the one that was frozen — is only possible here,
// where the disk is.

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ARMS } from './seed.mjs'
import { MODEL, OUTPUT_FORMATS, OUTPUT_FORMAT_DEFAULT } from './isolation.mjs'
import { REPO_ROOT } from './root.mjs'

export { REPO_ROOT }

const PREREG_DIR = join(REPO_ROOT, 'measurements', 'p1')

export const PREREG = {
  dir: PREREG_DIR,
  split: join(PREREG_DIR, 'split.json'),
  digests: join(PREREG_DIR, 'fixtures.sha256'),
  results: join(PREREG_DIR, 'results'),
}

/**
 * The rounds this protocol has pre-registered, newest last.
 *
 * A ROUND is a pre-registration and the tasks it froze, paired. Round 1's tasks
 * were spent in August 2026 — the held-out four are burned, and the two
 * development ones were iterated against — so a second measurement of the same
 * promise needs its OWN tasks, frozen before the mechanism it will measure
 * exists. That is why this is a list and not a constant: the promise in
 * `protocol.md` does not change, the tasks and the reading do.
 *
 * Each round's pre-registration lives beside the others' and is never edited
 * afterwards; each round's tasks live in their own directory of the workbench,
 * calibrated by the SAME script — every later round's `selftest.sh` is a symlink to it,
 * so there is one calibrator and not copies of one that can drift. Named by round here
 * until 2026-08-24, which is a sentence that has to be edited every time the list grows
 * and was already one round behind the code below it.
 *
 * THIS LIST IS A GATE AND NOT AN INVENTORY, which is what round 3 cost to learn. Round
 * 3's pre-registration was committed and frozen on 2026-08-20 while this list stopped at
 * 2, and the preflight passed GREEN over a round it could not see — including the
 * refusal that exists to stop a round whose arms nobody built, which is exactly what
 * round 3 was. A round that is on disk and not in this list is not "not yet enabled": it
 * is a round nothing checks. `tests/rounds.test.mjs` therefore asserts this list against
 * the pre-registrations that EXIST rather than against itself.
 */
export const ROUNDS = [1, 2, 3, 4]

/**
 * Where round `n`'s pre-registration lives, and the two files that fix it.
 *
 * Round 1 is at the root of `measurements/p1/` because it was the only round when
 * it was written, and those files are NOT moved: a pre-registration is worth what
 * the order is worth, and relocating one after its result exists rewrites the
 * record of that order.
 */
export function preregOf(round) {
  if (!ROUNDS.includes(round)) throw new Error(`no such round: ${round}`)
  const dir = round === 1 ? PREREG_DIR : join(PREREG_DIR, `round-${round}`)
  return {
    round,
    dir,
    split: join(dir, 'split.json'),
    digests: join(dir, 'fixtures.sha256'),
  }
}

/**
 * Everything wrong ACROSS the rounds, as a list of sentences.
 *
 * One task, one round. A task that appears in two rounds' splits is a task a
 * second measurement would spend twice, and neither round's own check can see it:
 * each one holds its tasks in its own directory, so both sides pass separately
 * while the new round quietly re-runs a task whose result is already known. It is
 * the one contamination that a per-round check is blind to by construction.
 */
export function crossRoundProblems(rounds = ROUNDS.map((round) => preregOf(round))) {
  const problems = []
  const seen = new Map()
  for (const prereg of rounds) {
    const split = readSplit(prereg.split)
    for (const id of [...split.development, ...split.held_out]) {
      const before = seen.get(id)
      if (before !== undefined) {
        problems.push(`${id} is in the split of round ${before} and of round ${prereg.round}`)
      } else {
        seen.set(id, prereg.round)
      }
    }
  }
  return problems
}

/**
 * How each task is fixed: a deterministic archive of its directory, hashed.
 *
 * Entry order fixed, timestamps and ownership zeroed, Python bytecode excluded —
 * so the digest is a property of the task's CONTENT and of its id, and neither of
 * the machine nor of the minute it was copied. The same flags are written into
 * `fixtures.sha256` itself: a hash nobody can reproduce proves nothing.
 */
const ARCHIVE_FLAGS = [
  '--sort=name',
  '--format=gnu',
  '--mtime=UTC 1970-01-01',
  '--owner=0',
  '--group=0',
  '--numeric-owner',
  '--exclude=__pycache__',
  '--exclude=*.pyc',
]

export function digestOf(fixturesDir, id) {
  const archive = spawnSync('tar', [...ARCHIVE_FLAGS, '-cf', '-', id], {
    cwd: fixturesDir,
    maxBuffer: 256 * 1024 * 1024,
  })
  if (archive.error) throw new Error(`tar could not run: ${archive.error.message}`)
  if (archive.status !== 0) {
    throw new Error(`tar failed on ${id}: ${String(archive.stderr).trim()}`)
  }
  return createHash('sha256').update(archive.stdout).digest('hex')
}

/** The split, with its shape checked rather than assumed. */
export function readSplit(path = PREREG.split) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`${path}: ${err.message}`)
  }
  for (const [key, kind] of [
    ['pilot', 'string'],
    ['frozen_at', 'string'],
    ['rule', 'string'],
    ['development', 'array'],
    ['held_out', 'array'],
  ]) {
    const value = parsed[key]
    const ok = kind === 'array' ? Array.isArray(value) : typeof value === kind
    if (!ok) throw new Error(`${path}: "${key}" is missing or is not a ${kind}`)
  }
  return parsed
}

/**
 * The arms a round DECLARES, or `null` when its split names none.
 *
 * Round 1's split does not carry the field — it was written when there was one
 * round and one set of arms — and it is not edited to acquire it: its arms are the
 * ones its results were taken with, and the results are what say so. Round 2
 * declares five, and one of them does not exist in this harness yet. That is the
 * whole reason the field is here: the run refuses a round whose arms it cannot
 * seed, instead of quietly running four of the five and publishing a table with a
 * column missing.
 */
export function armsOf(prereg) {
  const declared = readSplit(prereg.split).arms
  if (declared === undefined) return null
  if (!Array.isArray(declared) || declared.some((arm) => typeof arm !== 'string')) {
    throw new Error(`${prereg.split}: "arms" is not a list of names`)
  }
  return declared
}

/**
 * Refuse a round whose arms this harness cannot seed.
 *
 * A round's pre-registration DECLARES its arms. Running a round whose arms have no
 * `seedArm` behind them would seed some of them, write a `cells.jsonl` with no line for
 * the arm the round exists to measure, and spend tasks that were frozen once. So a
 * mismatch stops the run here, by name, instead of being discovered in the table
 * afterwards.
 *
 * It compares against `ARMS`, which is the harness's own list, so this refusal lifts by
 * itself the day the declared arm exists — there is no second place to remember to
 * update. IT HAS LIFTED TWICE: from 2026-08-18 to 2026-08-19 it refused round 2, whose
 * `split.json` names `mnema+` while this harness seeded an arm called `plugin`; and on
 * 2026-08-20 it refused round 3, whose `split.json` names `mnema-doc` while this harness
 * seeded five arms and none of them was that.
 *
 * THE COMPARISON USED TO BE ELEMENT BY ELEMENT AND IN ORDER, and round 3 falsified the
 * premise under that: it declares FOUR arms — `base`, `host`, `mnema-doc`, `mnema+` —
 * and withdraws `prosa` and `mnema`, which the harness can still seed and which round 2
 * still runs. Element-by-element equality would have refused round 3 forever, no matter
 * what was built, and the only way out would have been a list edited by hand to let it
 * through — which is a switch, and a switch is the thing this function exists not to be.
 * So the question is CONTAINMENT: every arm a round declares must be one this harness
 * seeds. That still refuses both cases it has ever refused — an arm nobody built, and an
 * arm built under another spelling — and it is the sentence round 3's own frozen
 * `arms.md` already used: "the harness compares that field against the arms it can
 * actually seed".
 *
 * WHAT CONTAINMENT NO LONGER CATCHES is a round that declares FEWER arms than the
 * harness seeds, and that is now legal rather than overlooked. What stops those extra
 * arms from being run is a different mechanism and it is named here because it has to
 * exist: {@link roundArms}, which is what the run plans from.
 */
export function refuseUnrunnableRound(round, arms = ARMS) {
  const declared = armsOf(preregOf(round))
  if (declared === null) return
  const missing = declared.filter((arm) => !arms.includes(arm))
  if (missing.length === 0) return
  throw new Error(
    `round ${round} declares the arms [${declared.join(', ')}] and this harness seeds ` +
      `[${arms.join(', ')}], so [${missing.join(', ')}] cannot be seeded: ` +
      `no cell of round ${round} runs from here`,
  )
}

/**
 * The arms a run of THIS round plans — the ones its pre-registration declares.
 *
 * THE SITE ROUND 3 MADE LIVE, and it had been a latent defect since the field existed.
 * The plan was built from `ARMS`, the harness's whole list, because until round 3 every
 * round that declared arms declared all of them and the two lists were the same object
 * seen twice. Round 3 declares four of six: planned from `ARMS`, `--full --round 3`
 * would spend two extra arms over eight held-out tasks — arms the round WITHDREW in
 * writing, on tasks that can only be spent once — and the resulting `cells.jsonl` would
 * carry columns no pre-registration asked for, which is the same defect
 * `refuseUnrunnableRound` exists to prevent, in the other direction.
 *
 * Round 1 declares no arms — its split was written when there was one round and one set
 * of arms — so it falls back to the harness's list, which is what its results were taken
 * with.
 */
export function roundArms(round, arms = ARMS) {
  return armsOf(preregOf(round)) ?? arms
}

/**
 * The output format a round's cells run with — `json` unless its pre-registration says otherwise.
 *
 * A ROUND DECLARES IT, rather than the harness changing it for everybody, because the four arms
 * that already spent cells keep their command line byte for byte (`tests/four-arms.golden.json`
 * freezes it) and a later round asks the CLI for the whole event stream. Declared in the split, it
 * is fixed before the first cell like the arms are, and a round cannot quietly switch halfway.
 * A value the harness does not know is a refusal by name: a typo would otherwise fall back to the
 * default and capture a round without the interactions it was pre-registered to capture.
 */
export function outputFormatOf(prereg) {
  const declared = readSplit(prereg.split).output_format
  if (declared === undefined) return OUTPUT_FORMAT_DEFAULT
  if (!OUTPUT_FORMATS.includes(declared)) {
    throw new Error(`${prereg.split}: "output_format" is ${JSON.stringify(declared)}, expected one of ${OUTPUT_FORMATS.join(', ')}`)
  }
  return declared
}

/**
 * The model a round's cells run on — the harness's default unless its pre-registration names one.
 *
 * THE MODEL IS A PROPERTY OF THE PRE-REGISTRATION, not of the command line. Which model the next
 * round runs on is a decision still open (the cheap one the earlier rounds used, or the one the
 * product is used with in practice), and the harness is prepared for both answers: it runs
 * whichever the split declares, writes it into every line, and runs no other. A `--model` flag
 * would let the same frozen round be spent on two models by two people and published as one.
 * Rounds 1 to 4 declare none and keep the model they ran on.
 */
export function modelOf(prereg) {
  const declared = readSplit(prereg.split).model
  if (declared === undefined) return MODEL
  if (typeof declared !== 'string' || declared.trim() === '') {
    throw new Error(`${prereg.split}: "model" is not a model id`)
  }
  return declared
}

/**
 * The CLI version a round declares, or `null` when it declares none (rounds 1 to 4).
 * See `lib/pin.mjs` for what is done with it.
 */
export function cliVersionOf(prereg) {
  const declared = readSplit(prereg.split).cli_version
  if (declared === undefined) return null
  if (typeof declared !== 'string' || declared.trim() === '') {
    throw new Error(`${prereg.split}: "cli_version" is not a version string`)
  }
  return declared
}

/** The scenario families a round's tasks can belong to (`measurements/p1/` protocol of the next round). */
export const SCENARIOS = ['S1', 'S2', 'S3a', 'S3b', 'S4', 'S5']

/**
 * The scenario a task belongs to in this round, or `null` when the round declares none.
 *
 * Rounds 1 to 4 had one kind of task and say nothing; a later round groups its tasks into
 * families whose readings differ, and the family has to travel in the LINE: reconstructing it
 * afterwards from the task's id is a second table that drifts. Declared in the split, beside
 * the task lists, as `scenarios: { "<task id>": "<family>" }`.
 */
export function scenarioOf(prereg, taskId) {
  const declared = readSplit(prereg.split).scenarios
  if (declared === undefined) return null
  return declared[taskId] ?? null
}

/**
 * The code an arm goes by in this round's lines, or `null` when the round declares none.
 *
 * `arm_codes: { "<arm>": "<letter>" }`. The analysis reads the code and the arm's name is the
 * thing a reader should not need to know to read it; whether a round also keeps the map out of the
 * repository until the analysis has run is that round's pre-registration to say, not this
 * function's to enforce.
 */
export function armCodeOf(prereg, arm) {
  const declared = readSplit(prereg.split).arm_codes
  if (declared === undefined) return null
  return declared[arm] ?? null
}

/**
 * Everything wrong with the labels a split declares, as sentences. Empty when it declares none.
 *
 * A label that is declared and wrong would be written into lines that cannot be re-run: a code
 * on two arms makes the blind reading ambiguous, a code missing from one arm makes a table with
 * a column nobody can name, and a scenario on a task the round does not hold labels nothing.
 */
export function labelProblems(split) {
  const problems = []
  if (split.arm_codes !== undefined) {
    const codes = split.arm_codes
    const armsDeclared = Array.isArray(split.arms) ? split.arms : null
    if (typeof codes !== 'object' || codes === null || Array.isArray(codes)) {
      problems.push('"arm_codes" is not an object from arm to code')
    } else {
      const values = Object.values(codes)
      if (values.some((code) => typeof code !== 'string' || code === '')) {
        problems.push('"arm_codes" holds a code that is not a non-empty string')
      }
      if (new Set(values).size !== values.length) {
        problems.push('"arm_codes" gives one code to two arms')
      }
      if (armsDeclared) {
        const missing = armsDeclared.filter((arm) => !(arm in codes))
        const extra = Object.keys(codes).filter((arm) => !armsDeclared.includes(arm))
        if (missing.length) problems.push(`"arm_codes" has no code for [${missing.join(', ')}]`)
        if (extra.length) problems.push(`"arm_codes" names [${extra.join(', ')}], which the round does not run`)
      }
    }
  }
  if (split.scenarios !== undefined) {
    const held = new Set([...(split.development ?? []), ...(split.held_out ?? [])])
    for (const [task, family] of Object.entries(split.scenarios ?? {})) {
      if (!held.has(task)) problems.push(`"scenarios" labels ${task}, which the split does not hold`)
      if (!SCENARIOS.includes(family)) problems.push(`"scenarios" gives ${task} the family ${JSON.stringify(family)}, expected one of ${SCENARIOS.join(', ')}`)
    }
  }
  return problems
}

/**
 * The SIEVE a round declares, or `null` when its split names none.
 *
 * A sieve is a stage that runs before a round's comparison and decides which of its
 * candidate tasks the headline is computed over. Round 4 is the first round to have one,
 * and the reason it is READ FROM THE SPLIT rather than typed on the command line is the
 * reason `pilotPlan` reads the pilot from there: a set typed at the prompt is a set
 * nobody can check afterwards, and the whole value of a sieve is that what it ran over
 * was fixed before it ran.
 *
 * Every field is checked rather than assumed. A sieve that names an arm as a number, or
 * a run count as a string, would otherwise reach `cellPlan` and produce a plan nobody
 * declared — over tasks that can be spent once.
 */
export function sieveOf(prereg) {
  const split = readSplit(prereg.split)
  const declared = split.sieve
  if (declared === undefined) return null
  for (const [key, kind] of [
    ['arm', 'string'],
    ['runs', 'number'],
  ]) {
    if (typeof declared[key] !== kind) {
      throw new Error(`${prereg.split}: the sieve's "${key}" is missing or is not a ${kind}`)
    }
  }
  if (!Number.isInteger(declared.runs) || declared.runs < 1) {
    throw new Error(`${prereg.split}: the sieve's "runs" is not a whole number of runs`)
  }
  const candidates = split.candidates
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error(`${prereg.split}: a sieve is declared and "candidates" names no task`)
  }
  if (candidates.some((id) => typeof id !== 'string')) {
    throw new Error(`${prereg.split}: "candidates" is not a list of ids`)
  }
  const stray = candidates.filter((id) => !split.held_out.includes(id))
  if (stray.length > 0) {
    throw new Error(
      `${prereg.split}: [${stray.join(', ')}] are candidates and are not held out, so the ` +
        'sieve would spend a task the split does not hold back',
    )
  }
  return { ...declared, candidates }
}

/** The frozen digests, as a Map from task id to hash. Comment lines are skipped. */
export function readDigests(path = PREREG.digests) {
  const frozen = new Map()
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '' || line.startsWith('#')) continue
    const match = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line)
    if (!match) throw new Error(`${path}: not a digest and an id: ${line}`)
    frozen.set(match[2], match[1])
  }
  return frozen
}

/**
 * Everything wrong between the pre-registration and the tasks on disk, as a list
 * of sentences. Empty means the bench is the one that was frozen.
 *
 * The two halves are separate on purpose. A task that is on disk and not in the
 * split would run without anybody having decided which side it is on; a task
 * whose bytes moved is a task that was edited after the freeze, and every number
 * already taken against it says something about a different task.
 */
export function splitProblems({ fixtures, split = readSplit(), frozen = readDigests() }) {
  const problems = []
  const onDisk = fixtures.map((f) => f.id).sort()
  const declared = [...split.development, ...split.held_out].sort()

  for (const id of onDisk) {
    if (!declared.includes(id)) problems.push(`${id} is on disk and on neither side of the split`)
  }
  for (const id of declared) {
    if (!onDisk.includes(id)) problems.push(`${id} is in the split and not on disk`)
  }
  for (const id of split.development) {
    if (split.held_out.includes(id)) problems.push(`${id} is on both sides of the split`)
  }
  if (!split.development.includes(split.pilot)) {
    problems.push(`the pilot ${split.pilot} is not a development task, so a pilot would spend a held-out one`)
  }
  for (const id of split.development) {
    if (id.startsWith('b')) problems.push(`${id} is the negative control and cannot be a development task`)
  }

  for (const fixture of fixtures) {
    const want = frozen.get(fixture.id)
    if (!want) {
      problems.push(`${fixture.id} has no frozen digest`)
      continue
    }
    let got
    try {
      got = digestOf(dirname(fixture.dir), fixture.id)
    } catch (err) {
      problems.push(`${fixture.id}: ${err.message}`)
      continue
    }
    if (got !== want) {
      problems.push(`${fixture.id} was edited after the freeze: ${got.slice(0, 16)}… is not ${want.slice(0, 16)}…`)
    }
  }
  for (const id of frozen.keys()) {
    if (!onDisk.includes(id)) problems.push(`${id} has a frozen digest and is not on disk`)
  }
  return problems
}
