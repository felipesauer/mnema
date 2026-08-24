// The line says WHICH BUILD the cell executed — `lib/build.mjs`.
//
// THE DEFECT THESE TESTS ARE THE MEMORY OF. The round of 2026-08-20 had to be moved into
// a dedicated git worktree in the middle of its preflight, because another process was
// writing the ordinary working tree and had rebuilt `packages/code/dist` — the artefact
// every cell executes — while the round was starting. It survived because a person
// noticed. Nothing in the data could have said so: every one of those 208 lines carries
// `mnema_version: "0.0.0"`, which is what a `package.json` says and not what ran, and it
// is `0.0.0` on both sides of any rebuild. A round split in half by somebody else's build
// would have measured TWO PRODUCTS, published one number, and looked exactly like a clean
// capture.
//
// WHAT IS ASSERTED HERE, and why each one. That two trees with different bytes get
// different digests — the claim itself. That the same bytes get the SAME digest, without
// which the column would be noise and every round would look split. That a file appearing
// moves the count as well as the digest, so a reader can tell "somebody rebuilt" from
// "somebody built a different set of packages". That what does NOT execute — the `.d.ts`
// and the source maps — does not move it, because the column is about the bytes a node
// process loads. That a binary outside the tree makes the column say it cannot answer
// rather than digest something else. And that the value REACHES THE LINE, which is A2:
// four defects of this series were an option plumbed to the end with nothing to feed it.

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { builtProduct } from '../lib/build.mjs'
import { runCell } from '../lib/cell.mjs'
import { listFixtures } from '../lib/fixtures.mjs'
import { RESULT_SCHEMA } from '../lib/result.mjs'
import { ROOT_MARKER } from '../lib/root.mjs'
import { sandboxRoot } from '../lib/sandbox.mjs'
import { FIXTURES_DIR, MNEMA_BIN, fakeAgent } from './helpers.mjs'

const fixture = listFixtures(FIXTURES_DIR).find((f) => f.id === 'a1-rounding')

const scratch = []
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

function workspace() {
  const dir = mkdtempSync(join(sandboxRoot(), 'mnema-bench-build-'))
  scratch.push(dir)
  return dir
}

/**
 * A workspace with a built product in it — the shape `builtProduct` walks.
 *
 * The marker is the real one, from `lib/root.mjs`: a fixture that spelled
 * `pnpm-workspace.yaml` here would keep passing after the product renamed it, and the
 * digest would then be of a tree nobody found.
 */
function plantBuild(files) {
  const root = workspace()
  writeFileSync(join(root, ROOT_MARKER), 'packages:\n  - packages/*\n')
  for (const [relative, content] of Object.entries(files)) {
    const full = join(root, 'packages', relative)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return { root, bin: join(root, 'packages/code/dist/cli.js') }
}

const ONE_BUILD = {
  'code/dist/cli.js': 'export const verb = "brief"\n',
  'code/dist/cli.d.ts': 'export declare const verb: string\n',
  'code/dist/cli.js.map': '{"version":3}\n',
  'core/dist/index.js': 'export const kinds = 19\n',
}

describe('11 · the line says which build the cell executed', () => {
  test('two builds with different bytes get different digests', () => {
    const same = plantBuild(ONE_BUILD)
    const other = plantBuild({ ...ONE_BUILD, 'core/dist/index.js': 'export const kinds = 20\n' })

    const a = builtProduct(same.bin)
    const b = builtProduct(other.bin)
    assert.equal(typeof a.digest, 'string', a.probe)
    assert.notEqual(a.digest, b.digest, 'one byte of one package changed and the digest did not')
    assert.equal(a.files, b.files, 'and the count did not move, because no file appeared')
    // THE OTHER HALF, and the guard is worth nothing without it: a digest that changed
    // for every call would also pass the line above, and every round would read as split.
    assert.equal(a.digest, builtProduct(plantBuild(ONE_BUILD).bin).digest, 'the same bytes, in another tree')
  })

  test('and a rebuild of a package the binary only IMPORTS moves it too', () => {
    // `dist/cli.js` is 15 KB and imports the rest of the workspace at runtime, so a
    // digest of the binary's own directory would stand still while what the cell executes
    // changed. This is the case that would be silent.
    const before = plantBuild(ONE_BUILD)
    const after_ = plantBuild({ ...ONE_BUILD, 'core/dist/index.js': 'export const kinds = 19 // rebuilt\n' })
    assert.equal(builtProduct(before.bin).files, builtProduct(after_.bin).files)
    assert.notEqual(builtProduct(before.bin).digest, builtProduct(after_.bin).digest)
  })

  test('a file APPEARING moves the count, not only the digest', () => {
    const one = plantBuild(ONE_BUILD)
    const two = plantBuild({ ...ONE_BUILD, 'code/dist/anchors.js': 'export const anchor = 1\n' })
    assert.equal(builtProduct(two.bin).files, builtProduct(one.bin).files + 1)
    assert.notEqual(builtProduct(two.bin).digest, builtProduct(one.bin).digest)
  })

  test('and what does not EXECUTE does not move it', () => {
    // The column is the bytes a node process loads. Types and source maps are neither, and
    // a digest that moved with them would report a split round every time `tsc` re-emitted
    // a map — a false alarm in a detector nobody would then trust.
    const one = plantBuild(ONE_BUILD)
    const typed = plantBuild({
      ...ONE_BUILD,
      'code/dist/cli.d.ts': 'export declare const verb: "brief"\n',
      'code/dist/cli.js.map': '{"version":3,"sources":["cli.ts"]}\n',
    })
    assert.equal(builtProduct(typed.bin).digest, builtProduct(one.bin).digest)
    assert.equal(builtProduct(typed.bin).files, builtProduct(one.bin).files)
  })

  test('the path is in the digest, so two files trading contents move it', () => {
    // Hashing the bytes alone would let a build that swapped two modules read as
    // unchanged. Each file is hashed WITH its path, which is what makes the digest a
    // statement about the tree and not about a bag of bytes.
    const one = plantBuild({ ...ONE_BUILD, 'code/dist/a.js': 'export const x = 1\n', 'code/dist/b.js': 'export const x = 2\n' })
    const swapped = plantBuild({ ...ONE_BUILD, 'code/dist/a.js': 'export const x = 2\n', 'code/dist/b.js': 'export const x = 1\n' })
    assert.equal(builtProduct(one.bin).files, builtProduct(swapped.bin).files)
    assert.notEqual(builtProduct(one.bin).digest, builtProduct(swapped.bin).digest)
  })

  test('a binary the digest does not cover makes the column say so, never guess', () => {
    // The guard the whole file would be worthless without: a bundle somewhere else, a bin
    // shim, a global install. Digesting the tree beside it would report a build the cell
    // never ran, which is a wrong answer dressed as a measurement.
    const planted = plantBuild(ONE_BUILD)
    const elsewhere = join(planted.root, 'packages/code/bin/mnema')
    mkdirSync(join(elsewhere, '..'), { recursive: true })
    writeFileSync(elsewhere, '#!/usr/bin/env node\n')

    const out = builtProduct(elsewhere)
    assert.equal(out.digest, null)
    assert.equal(out.files, null)
    assert.match(out.probe, /is not one of the \d+ executed file\(s\)/)
    assert.match(out.probe, /the column cannot answer/)
  })

  test('and a tree with no workspace above it is the other silence, with the reason', () => {
    const orphan = workspace()
    mkdirSync(join(orphan, 'packages/code/dist'), { recursive: true })
    writeFileSync(join(orphan, 'packages/code/dist/cli.js'), 'export const verb = 1\n')
    const out = builtProduct(join(orphan, 'packages/code/dist/cli.js'))
    assert.equal(out.digest, null)
    assert.match(out.probe, new RegExp(`no ${ROOT_MARKER} above`))
  })

  test('it never throws — a product it cannot digest still has to produce a line', () => {
    // The digest is a qualification and not a gate. A run that died because a directory
    // was missing would lose the cells behind it to say so.
    for (const bin of ['/there/is/no/such/path/cli.js', '', join(workspace(), 'nothing.js')]) {
      const out = builtProduct(bin)
      assert.equal(out.digest, null, bin)
      assert.equal(typeof out.probe, 'string', bin)
    }
  })

  test('the probe says what the digest covers and what it cannot see', () => {
    // A4: the sentence that rides in the line names the limit, because the digest is
    // sampled ONCE per cell and a rebuild landing inside one cell is invisible to it.
    const out = builtProduct(plantBuild(ONE_BUILD).bin)
    assert.match(out.probe, /packages\/\*\/dist/)
    assert.match(out.probe, /two cells with different digests executed different products/)
    assert.match(out.probe, /sampled once, before the cell seeds/)
  })

  test('the real product digests, and the number is the one the bench would publish', () => {
    // Not a fabricated tree: the artefact the cells actually run. It is the one case that
    // would catch a walk that only works on the shape this file plants.
    const out = builtProduct(MNEMA_BIN)
    assert.equal(typeof out.digest, 'string', out.probe)
    assert.equal(out.digest.length, 16)
    assert.ok(out.files > 100, `the workspace built ${out.files} executed files`)
    assert.equal(out.digest, builtProduct(MNEMA_BIN).digest, 'and it is stable between two reads')
  })

  test('the schema moved, so a line from before the column is readable as one', () => {
    // The 208 lines of the 2026-08-20 round were not re-run to gain this key. The absent
    // key is what says they are from before, and that only works if the number moves —
    // hence a LITERAL, which a comparison against the constant itself would not be.
    //
    // IT HAS MOVED AGAIN, to 8, and the boundary is a different one: schema 7 carried the
    // CLI's `subtype` and not its `is_error`, so no capture taken at 7 or earlier can be
    // audited for the vendor refusal that corrupted the sieve of 2026-08-24. The 492 cells
    // committed before it were checked for it by hand, out of `raw/`, and none carries it.
    assert.equal(RESULT_SCHEMA, 'mnema-bench/cell/8')
  })
})

describe('11b · and a mutable copy of the product changes the LINE, not only the digest', () => {
  // A2, and the elo this file exists to close: a digest nothing carries is an option
  // plumbed to the end with nothing to feed it. What is asserted is the pair the report
  // claims — two cells whose `dist` differ have different lines — and it is asserted on a
  // product the test can actually edit.
  //
  // THE COPY IS A SHIM AND NOT A BUILD. A copied `dist` would not resolve `@mnema/core`,
  // so the cell could not seed; this planted `cli.js` DELEGATES to the real one, which
  // makes it a working product whose bytes belong to the test. The digest covers it
  // because it is the file `packages/*/dist` holds.
  function delegatingBuild(extra = '') {
    const root = workspace()
    writeFileSync(join(root, ROOT_MARKER), 'packages:\n  - packages/*\n')
    const dist = join(root, 'packages/code/dist')
    mkdirSync(dist, { recursive: true })
    const bin = join(dist, 'cli.js')
    writeFileSync(
      bin,
      `const { spawnSync } = require('node:child_process')\n` +
        `const out = spawnSync(process.execPath, [${JSON.stringify(MNEMA_BIN)}, ...process.argv.slice(2)], { stdio: 'inherit' })\n` +
        `process.exit(out.status ?? 1)\n${extra}`,
    )
    return bin
  }

  /** One cell, run against `mnemaBin`, with the fake agent. Returns the line. */
  function lineFor(mnemaBin) {
    const dir = workspace()
    const claudeBin = fakeAgent(dir, { refDir: join(fixture.dir, 'refs/good') })
    const { line } = runCell({
      fixture,
      arm: 'mnema',
      run: 1,
      round: 2,
      claudeBin,
      mnemaBin,
      authMode: 'api-key',
      outDir: null,
      resultsPath: join(dir, 'cells.jsonl'),
      versions: { cli: 'fake', mnema: 'fake' },
    })
    return line
  }

  test('two products, two digests, two LINES — the claim, end to end', () => {
    const first = delegatingBuild()
    const second = delegatingBuild('// and this build is one comment longer\n')

    const a = builtProduct(first)
    const b = builtProduct(second)
    assert.equal(typeof a.digest, 'string', a.probe)
    assert.notEqual(a.digest, b.digest)
    assert.equal(a.files, 1, 'the planted product is one executed file')
    assert.equal(b.files, 1)

    // And the cells that RUN those two products carry the difference. This is the elo:
    // without it the digest would be a function nothing calls, which is four defects of
    // this series in one shape.
    const one = lineFor(first)
    const two = lineFor(second)
    assert.equal(one.status, 'ok', one.error)
    assert.equal(two.status, 'ok', two.error)
    assert.equal(one.mnema_build_sha256_16, a.digest, 'the line carries the digest of what it ran')
    assert.equal(two.mnema_build_sha256_16, b.digest)
    assert.notEqual(one.mnema_build_sha256_16, two.mnema_build_sha256_16)
    assert.equal(one.mnema_build_files, 1)
    assert.match(one.mnema_build_probe, /packages\/\*\/dist/)
    // The version could not have said it, which is the whole reason the column exists.
    assert.equal(one.mnema_version, two.mnema_version)
  })

  test('and a cell whose product cannot be digested still writes a line', () => {
    // The real product, reached by a path outside `packages/*/dist`. The cell runs — the
    // binary works — and the column says it cannot answer instead of naming a build.
    const shim = join(workspace(), 'mnema-cli.js')
    writeFileSync(
      shim,
      `const { spawnSync } = require('node:child_process')\n` +
        `const out = spawnSync(process.execPath, [${JSON.stringify(MNEMA_BIN)}, ...process.argv.slice(2)], { stdio: 'inherit' })\n` +
        `process.exit(out.status ?? 1)\n`,
    )
    const line = lineFor(shim)
    assert.equal(line.status, 'ok', line.error)
    assert.equal(line.mnema_build_sha256_16, null)
    assert.equal(line.mnema_build_files, null)
    assert.match(line.mnema_build_probe, /the workspace root cannot be found|cannot answer/)
  })

  test('and appending to the SAME product changes what a later cell would report', () => {
    // The scenario in one test: a build that is rewritten between two cells. The first
    // digest is taken, the artefact is rebuilt, the second digest is taken, and the two
    // lines of a round that straddled it would not agree.
    const bin = delegatingBuild()
    const before = builtProduct(bin)
    appendFileSync(bin, '// somebody else ran pnpm build\n')
    const after_ = builtProduct(bin)
    assert.notEqual(before.digest, after_.digest, 'the round would look clean')
    assert.equal(before.files, after_.files, 'and no file appeared, so only the bytes say it')
  })
})
