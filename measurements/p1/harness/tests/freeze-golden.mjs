#!/usr/bin/env node
// Freeze the four arms as bytes — `node tests/freeze-golden.mjs`.
//
// Run ONCE, before the fifth arm existed, and never again casually: the point of
// the file it writes is that it predates the change it guards. Re-running it after
// an edit to `seed.mjs` or `isolation.mjs` would rewrite the reference to agree
// with whatever the code now does, which is the golden equivalent of scoring on
// the exit code.
//
// It takes one axis-A task and one axis-B task, both DEVELOPMENT tasks of the
// split: what is frozen is the arm's behaviour, and a held-out task would put its
// own bytes in a file for no gain.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { listFixtures } from '../lib/fixtures.mjs'
import { ARMS } from '../lib/seed.mjs'
import { FIXTURES_DIR, HARNESS_DIR, armManifest } from './helpers.mjs'

export const GOLDEN_PATH = join(HARNESS_DIR, 'tests/four-arms.golden.json')
export const GOLDEN_FIXTURES = ['a1-rounding', 'b1-csv-quotes']
/**
 * The arms the pre-registered round already spent 32 cells on — and, equivalently, every
 * arm this harness seeds that carries NO surface.
 *
 * The two readings agreed when this was written and they still agree; `four-arms.test.mjs`
 * asserts the second one against `ARMS`, because the first is a fact about August 2026
 * and the second is a rule a new arm has to satisfy or move.
 */
export const FROZEN_ARMS = ['base', 'prosa', 'host', 'mnema']

export function manifests(arms = FROZEN_ARMS) {
  const fixtures = listFixtures(FIXTURES_DIR).filter((f) => GOLDEN_FIXTURES.includes(f.id))
  if (fixtures.length !== GOLDEN_FIXTURES.length) {
    throw new Error(`the golden needs ${GOLDEN_FIXTURES} and found ${fixtures.map((f) => f.id)}`)
  }
  const out = {}
  for (const fixture of fixtures) {
    for (const arm of arms) out[`${fixture.id}/${arm}`] = armManifest({ fixture, arm })
  }
  return out
}

if (process.argv[1]?.endsWith('freeze-golden.mjs')) {
  for (const arm of FROZEN_ARMS) {
    if (!ARMS.includes(arm)) throw new Error(`the golden names ${arm}, which is not an arm`)
  }
  const frozen = { frozen_for: 'the four arms of the pre-registered round', arms: FROZEN_ARMS, manifests: manifests() }
  writeFileSync(GOLDEN_PATH, `${JSON.stringify(frozen, null, 2)}\n`)
  console.log(`wrote ${Object.keys(frozen.manifests).length} manifests to ${GOLDEN_PATH}`)
}
