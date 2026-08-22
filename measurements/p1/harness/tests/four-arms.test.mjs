// The other four arms are UNTOUCHED — and it is a claim about bytes.
//
// The fifth arm was added to a bench that had already spent 32 cells on the other
// four, and those cells are the reference the new one is read against. They cannot
// be re-run: a result is not redone. So if the seeding, the cell configuration, the
// command line or the environment of any of them moved while the fifth arm was
// being built, the comparison loses its referential and the check loses its point —
// silently, because nothing about a changed arm announces itself.
//
// `tests/four-arms.golden.json` was written by `tests/freeze-golden.mjs` from the
// code as it stood BEFORE `plugin` existed, and this file compares against it.
// Absolute paths are placeholders that name what they were, so the comparison is
// about the arm and not about this machine — except `<INHERITED-PATH>`, which is
// deliberately one whole value: the fifth arm's mechanism includes prepending a
// directory to PATH, and `<SANDBOX>/cell/bin:<INHERITED-PATH>` has to read
// differently from `<INHERITED-PATH>` or the guard would not see it.
//
// WHAT IT CANNOT CATCH, and it is stated rather than left implied: the same
// function produced the golden and checks it, so a defect inside `armManifest` is
// invisible here. What is claimed is narrower and is the thing that matters — a
// CHANGE made after the freeze.
//
// AND ONE MORE THING IT CANNOT SEE, found on 2026-08-19 rather than reasoned about: the
// fifth arm gained a third difference — an ADDRESS on the decision it seeds — and this
// comparison did not move. The address is a link inside `.mnema/`, which `repo` excludes
// by pathspec and which the record index does not list, so the manifest is blind to it.
// That is FINE for what this file claims, because the address exists in the fifth arm
// alone and the four here have no record at all in three cases and no address in the
// fourth — which `assertSeed` asserts directly, in both directions. It is written down
// because "the manifest froze the arms" would otherwise read as "the manifest sees
// everything about them".

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { listFixtures } from '../lib/fixtures.mjs'
import { ARMS, servesUnasked } from '../lib/seed.mjs'
import { FIXTURES_DIR } from './helpers.mjs'
import { FROZEN_ARMS, GOLDEN_FIXTURES, GOLDEN_PATH, manifests } from './freeze-golden.mjs'

const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'))

describe('9 · the four arms of the pre-registered round are byte-identical', () => {
  test('the golden covers every arm that already spent cells, and no arm with a surface', () => {
    // A golden that quietly stopped covering an arm would pass forever. The list is
    // asserted against ARMS rather than trusted, and the arms added after the freeze
    // must NOT be in it — a golden that included one of them would have to be
    // rewritten to agree with the change it exists to detect.
    //
    // IT SAID "not the NEW one", singular, and 2026-08-20 falsified that: `mnema-doc`
    // is a second arm added after this freeze, and written against `!== SURFACE_ARM`
    // this line would have demanded that the golden cover it — which would mean
    // re-running `freeze-golden.mjs` and rewriting the reference the four spent arms are
    // compared against. The discriminant is not "is it the newest arm" but "does it
    // carry a surface", which is what the frozen four have in common and what
    // `servesUnasked` reads.
    assert.deepEqual(golden.arms, FROZEN_ARMS)
    assert.deepEqual(
      ARMS.filter((a) => !servesUnasked(a)),
      FROZEN_ARMS,
      'every arm without a surface is frozen',
    )
    for (const arm of ARMS.filter(servesUnasked)) {
      assert.equal(golden.arms.includes(arm), false, `${arm} came after the freeze`)
    }
    assert.ok(ARMS.filter(servesUnasked).length >= 2, 'and there is more than one of them')
    assert.equal(Object.keys(golden.manifests).length, FROZEN_ARMS.length * GOLDEN_FIXTURES.length)
    // Both axes are in it: three of the four arms differ between them.
    const axes = new Set(Object.values(golden.manifests).map((m) => m.axis))
    assert.deepEqual([...axes].sort(), ['A', 'B'])
  })

  test('every frozen manifest still matches, key by key', () => {
    const now = manifests()
    assert.deepEqual(Object.keys(now).sort(), Object.keys(golden.manifests).sort())
    for (const [key, want] of Object.entries(golden.manifests)) {
      // Key by key rather than one deepEqual on the whole object: the report has to
      // be able to say WHICH of seeding, settings, mcp, argv or env moved.
      for (const field of Object.keys(want)) {
        assert.deepEqual(now[key][field], want[field], `${key}: ${field} moved since the freeze`)
      }
      assert.deepEqual(Object.keys(now[key]).sort(), Object.keys(want).sort(), `${key}: the manifest gained or lost a field`)
    }
  })

  test('and the golden is not vacuous — a real difference in it is caught', () => {
    // The guard that makes the two above worth reading. Without it, a golden read
    // from a file that no longer parses, or compared with a matcher that always
    // agrees, would be green about nothing.
    const now = manifests()
    const tampered = JSON.parse(JSON.stringify(golden.manifests))
    tampered['a1-rounding/base'].settings.autoMemoryDirectory = '<SANDBOX>/somewhere-else'
    assert.throws(
      () => assert.deepEqual(now['a1-rounding/base'].settings, tampered['a1-rounding/base'].settings),
      /somewhere-else|Expected values to be/,
    )
  })

  test('the golden’s fixtures are development tasks, so no held-out bytes are in it', () => {
    const fixtures = listFixtures(FIXTURES_DIR)
    for (const id of GOLDEN_FIXTURES) {
      assert.ok(fixtures.some((f) => f.id === id), `${id} is not on disk`)
    }
    // `a1-rounding` is the split's pilot and `b1-csv-quotes` is a negative control.
    // The split itself is checked by `tests/split.test.mjs`; what is asserted here is
    // that this file leans on neither of the two tasks the fifth arm will be run on.
    assert.equal(GOLDEN_FIXTURES.includes('a2-due-day'), false)
    assert.equal(GOLDEN_FIXTURES.includes('a4-collation'), false)
  })
})
