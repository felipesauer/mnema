// Where the workspace root is — FOUND, not counted.
//
// THE DEFECT THIS FILE REPLACES, and it is measured. Two modules derived the
// repository root by counting `..` from their own file: `lib/split.mjs` with
// `'../../../../..'` and `tests/helpers.mjs` with `'../../..'`. Both were correct
// while the bench lived at `.refactor/active/<bench>/`. The bench was then moved
// to `.refactor/archive/surface-2026-08/<bench>/`, one level deeper, and both
// landed on `.refactor/` instead. Nothing said so: `measurements/p1/split.json`
// simply did not exist, `packages/code/dist/cli.js` simply did not exist, and the
// suite went from green to **34 pass / 28 fail** — the state it was found in.
//
// A count of `..` is a claim about where this directory sits in a tree that
// somebody else is free to reorganise. A MARKER is a claim about the tree itself,
// and it survives the move. `pnpm-workspace.yaml` is the marker: it is at the
// root, it is committed, and it is the file that makes the root the root.
//
// One derivation, one site — the two callers above now import from here, and
// `tests/root.test.mjs` asserts the found root holds the three things the bench
// reaches for by absolute path.
//
// AND THE PARAGRAPH ABOVE PREDICTED THE MOVE THAT HAPPENED NEXT, one level in the
// other direction. This runner used to live INSIDE the workbench, so `run.mjs`
// reached its tasks with `dirname(HARNESS_DIR)` — a single `..` out of its own
// tree — and `tests/helpers.mjs` did the same. That count was correct for exactly
// as long as the runner was a subdirectory of the tasks, and it stopped being
// correct when the runner was published into `measurements/p1/harness/`, whose
// parent is the PRE-REGISTRATION and holds no task at all.
//
// THE ANSWER IS NOT A DEEPER COUNT. Where the tasks are is not a fact about this
// tree — it is a fact about whoever is running the protocol, and for anybody but
// us it is a directory in a repository this code has never seen. So it arrives
// from OUTSIDE, in `MNEMA_BENCH_TASKS`, and `tasksRoot` refuses by name when it is
// unset rather than guessing a path that would come back as broken fixtures, a
// broken split and a missing binary — which is the exact misreading the failure
// above produced.

import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The file whose presence defines the workspace root. */
export const ROOT_MARKER = 'pnpm-workspace.yaml'

/**
 * Walk up from `from` until the marker is there.
 *
 * Throws rather than returning a guess: a root that is silently wrong is the
 * failure above, where every absolute path built from it pointed at nothing and
 * the harness reported it as broken fixtures, a broken split and a missing
 * binary.
 */
export function findWorkspaceRoot(from = dirname(fileURLToPath(import.meta.url))) {
  let current = resolve(from)
  for (;;) {
    if (existsSync(join(current, ROOT_MARKER))) return current
    const up = dirname(current)
    if (up === current) {
      throw new Error(`no ${ROOT_MARKER} above ${from}: the workspace root cannot be found`)
    }
    current = up
  }
}

/** The workspace root, resolved once. */
export const REPO_ROOT = findWorkspaceRoot()

/**
 * Where this runner lives — one level up from `lib/`, and this `..` is a different
 * kind of claim from the one the header condemns.
 *
 * It stays inside the runner's own tree: `lib/` is part of the thing being resolved
 * from, and whoever moves the runner moves both halves together. The count that
 * broke was a count OUT of this tree into somebody else's.
 */
export const RUNNER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Where the tasks are said to be. Read from the environment, never from this tree. */
export const TASKS_VARIABLE = 'MNEMA_BENCH_TASKS'

/**
 * The directory that holds the rounds' task directories — REFUSED, not guessed.
 *
 * It is the one path this runner cannot derive. Round 1's tasks are at
 * `<tasksRoot>/fixtures`, round *n*'s at `<tasksRoot>/round-n/fixtures`, and where
 * that root is depends on whose protocol is being run: ours is a local workbench git
 * ignores, and anybody else's is a directory in a repository this code has never
 * seen. A default would be a guess about the second case dressed as a fact about the
 * first.
 *
 * It throws for the same reason `findWorkspaceRoot` does, and the message names the
 * variable: every path the preflight builds hangs off this one, so a wrong answer
 * here is reported downstream as a broken calibrator, a broken split and a missing
 * task — three diagnoses of a defect that is none of them.
 */
export function tasksRoot() {
  const said = process.env[TASKS_VARIABLE]
  if (!said) {
    throw new Error(
      `${TASKS_VARIABLE} is not set: it must name the directory that holds the rounds' tasks ` +
        '(round 1 in `fixtures/`, round n in `round-n/fixtures/`)',
    )
  }
  const root = resolve(said)
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`${TASKS_VARIABLE}=${said} is not a directory`)
  }
  return root
}
