// The scorer — the fixture's own `verify.<ext>`, read the way `selftest.sh` reads it.
//
// THE RULER CHECKS ITSELF, and the reason is worth repeating here because this
// is where a run would go wrong silently: a runtime that fails to load the
// verifier also exits 1, and exit 1 means VIOLATES. An instrument that cannot
// say it broke would report a broken PHP install as an agent that disobeyed the
// record — the single most flattering error this experiment could make, since
// the arm without the record is the one whose violations we expect.
//
// So the verdict is the FIRST WORD of stdout, the exit code must agree with it,
// and anything else is RULER BROKEN: not a score, a refusal to score.

import { spawnSync } from 'node:child_process'

export const VERDICTS = { CONFORMS: 0, VIOLATES: 1, BROKEN: 2 }

/**
 * The FOUR words of a task that holds a history (`decisions/`): the decision in force was
 * followed, the one it REPLACED was followed, neither, or the code does not run. Following the
 * replaced decision is a finding of its own — it is what an agent that read the whole history
 * and missed the replacement does — so it has its own word and its own exit, instead of being
 * folded into VIOLATES where nothing could tell it apart again.
 */
export const VERDICTS_FOUR = { CONFORMS_CURRENT: 0, VIOLATES: 1, BROKEN: 2, FOLLOWS_OBSOLETE: 3 }

/** The vocabulary a fixture's discriminant speaks — by its shape, never by guess. */
export function verdictsOf(fixture) {
  return fixture.verdicts === 'four' ? VERDICTS_FOUR : VERDICTS
}

export const RULER_BROKEN = 'RULER_BROKEN'

/**
 * Score a directory with a fixture's discriminant.
 *
 * Returns `{ verdict, exit, stdout }` where `verdict` is one of the three, or
 * `null` with `rulerBroken` set and a reason.
 */
export function runVerify(fixture, dir, { timeoutMs = 60_000 } = {}) {
  const run = spawnSync(fixture.runner, [fixture.verify, dir], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  })

  if (run.error) {
    return broken(`${fixture.runner} could not run: ${run.error.message}`, run)
  }
  if (run.signal) {
    return broken(`the discriminant was killed by ${run.signal}`, run)
  }

  const stdout = run.stdout ?? ''
  const word = stdout.trimStart().split(/\s/, 1)[0]
  // The fixture's OWN vocabulary: a three-word task that printed a four-word verdict, or the
  // reverse, is a discriminant that does not speak the language its shape promises.
  const vocabulary = verdictsOf(fixture)
  if (!Object.hasOwn(vocabulary, word)) {
    const firstLine = (stdout || run.stderr || '').split('\n')[0]
    return broken(`printed no verdict: ${firstLine}`, run)
  }
  if (vocabulary[word] !== run.status) {
    return broken(`said ${word} but exited ${run.status}`, run)
  }

  return { verdict: word, exit: run.status, stdout, rulerBroken: false, detail: null }
}

function broken(detail, run) {
  return {
    verdict: null,
    exit: run?.status ?? null,
    stdout: run?.stdout ?? '',
    stderr: run?.stderr ?? '',
    rulerBroken: true,
    detail,
  }
}

/**
 * The task's hidden behaviour tests — `quality.<ext>`, run on what the agent left — as two numbers.
 *
 * Conformance is not quality: an agent can follow the decision and break what the ticket did not
 * mention. The script prints `QUALITY <passed>/<total>` as its first line and exits 0; anything
 * else is reported as unreadable and the two numbers are `null`, never zero — a quality script
 * that did not run says nothing about the code. A task without one (the first shape) has `null`.
 */
export function runQuality(fixture, dir, { timeoutMs = 60_000 } = {}) {
  if (!fixture.quality) return { passed: null, total: null, detail: null }
  const run = spawnSync(fixture.runner, [fixture.quality, dir], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  })
  if (run.error) return { passed: null, total: null, detail: `${fixture.runner} could not run: ${run.error.message}` }
  if (run.signal) return { passed: null, total: null, detail: `the quality script was killed by ${run.signal}` }
  const first = (run.stdout ?? '').split('\n')[0].trim()
  const match = /^QUALITY (\d+)\/(\d+)$/.exec(first)
  if (!match || run.status !== 0) {
    return { passed: null, total: null, detail: `the quality script printed "${first.slice(0, 160)}" and exited ${run.status}` }
  }
  const passed = Number(match[1])
  const total = Number(match[2])
  if (total === 0 || passed > total) return { passed: null, total: null, detail: `the quality script printed an impossible count: ${first}` }
  return { passed, total, detail: null }
}
