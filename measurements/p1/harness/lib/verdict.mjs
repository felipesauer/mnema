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
  if (!(word in VERDICTS)) {
    const firstLine = (stdout || run.stderr || '').split('\n')[0]
    return broken(`printed no verdict: ${firstLine}`, run)
  }
  if (VERDICTS[word] !== run.status) {
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
