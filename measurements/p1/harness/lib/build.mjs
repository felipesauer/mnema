// WHICH BUILD OF THE PRODUCT A CELL EXECUTED — a digest of the artefact, not a version
// string.
//
// THE DEFECT THIS FILE ANSWERS IS MEASURED AND IT NEARLY COST A ROUND. The round of
// 2026-08-20 had to be moved into a dedicated git worktree mid-preflight because another
// process was writing the ordinary working tree and had rebuilt `packages/code/dist` —
// the artefact every cell executes — while the preflight ran. The round survived because
// a human noticed. Nothing in a result line could have said so: `mnema_version` is
// `0.0.0` on both sides of a rebuild, because it is read from a `package.json` that a
// rebuild does not touch. So a round split in half by somebody else's build would have
// measured TWO PRODUCTS and published one number, and the capture would have looked
// exactly like a clean one.
//
// WHAT A VERSION CANNOT SAY AND A DIGEST CAN. The version is a claim somebody writes; the
// digest is the bytes that ran. Two cells whose lines carry different digests executed
// different products, and that is readable by whoever opens the data later, without the
// report beside it and without anybody having remembered to notice.
//
// WHAT IT COVERS, EXACTLY, because a digest whose scope is vague is a number nobody can
// act on: every `.js` file under `packages/*/dist/` of the workspace the cell's own
// `mnema` comes from. `.js` and not `.d.ts` or `.js.map`, because those are not loaded by
// the process that runs; every package and not only the one holding the binary, because
// `dist/cli.js` is 15 KB and imports the rest of the workspace at runtime, so a rebuild
// of `core` alone changes what the cell executes while `code/dist` stands still.
//
// AND WHAT IT CANNOT SAY, which rides here rather than only in the report: it is sampled
// ONCE per cell, before the cell seeds anything, so it says which product the cell STARTED
// on. A rebuild landing between the seed and the agent's last turn is inside one cell and
// this column cannot see it. What it is built to catch is the case that actually happened
// — a rebuild between cells, which splits a run into two halves with two digests.
//
// THE ROOT IS FOUND AND NEVER COUNTED, for the reason `lib/root.mjs` exists: two modules
// once derived it by counting `..` from their own file, the bench was moved one level
// deeper, and the suite went to 34 pass / 28 fail with every absolute path pointing at
// nothing. The marker is walked up from the binary itself, so `MNEMA_BENCH_MNEMA` pointing
// at another checkout digests THAT checkout rather than this one.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { findWorkspaceRoot } from './root.mjs'

/** Where the workspace keeps its packages. One segment, and the digest walks it. */
export const PACKAGES_DIR = 'packages'

/** The directory each package publishes its built artefact into. */
export const DIST_DIR = 'dist'

/** The extension of the files a running node process actually loads. */
export const EXECUTED_EXTENSION = '.js'

/**
 * The build of the product a cell would execute through `mnemaBin`, as a digest.
 *
 * NEVER THROWS, and returns the three-silences shape this bench uses everywhere else: a
 * digest with the sentence that says what it covered, or `null` with the sentence that
 * says why the column cannot answer. A cell whose product cannot be digested still has to
 * produce a line — the digest is a qualification and not a gate, and a run that died
 * because a directory was missing would have lost the cells behind it to say so.
 *
 * `files` travels beside the digest on purpose. A digest alone changes for two different
 * reasons — bytes edited, or a file appearing and disappearing — and a reader comparing
 * two halves of a split round wants to tell "somebody rebuilt" from "somebody built a
 * different set of packages".
 */
export function builtProduct(mnemaBin) {
  const bin = resolve(mnemaBin)
  let root
  try {
    root = findWorkspaceRoot(dirname(bin))
  } catch (err) {
    return { digest: null, files: null, probe: err.message }
  }

  const packages = join(root, PACKAGES_DIR)
  let names
  try {
    names = readdirSync(packages, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch (err) {
    return { digest: null, files: null, probe: `${packages} could not be read: ${err.message}` }
  }

  const entries = []
  let sawTheBinary = false
  for (const name of names) {
    for (const [relative, full] of executedFiles(join(packages, name, DIST_DIR))) {
      if (full === bin) sawTheBinary = true
      entries.push(`${name}/${relative} ${sha256(readFileSync(full))}`)
    }
  }

  // THE GUARD THAT KEEPS THE SCOPE HONEST, and it is the one this file would be worthless
  // without. A binary outside every `packages/*/dist` — a bundle somewhere else, a bin
  // shim, a global install — would be digested as the tree beside it and the column would
  // report a build the cell never ran. That is a wrong answer, and this bench prefers a
  // column that says it cannot answer.
  if (!sawTheBinary) {
    return {
      digest: null,
      files: null,
      probe:
        `${bin} is not one of the ${entries.length} executed file(s) under ${packages}/*/${DIST_DIR}: ` +
        'the binary this cell runs is not in the tree this digest covers, so the column cannot answer',
    }
  }

  entries.sort()
  return {
    digest: sha256(entries.join('\n')).slice(0, 16),
    files: entries.length,
    probe:
      `sha256 of ${entries.length} ${EXECUTED_EXTENSION} file(s) under ${PACKAGES_DIR}/*/${DIST_DIR} of ` +
      `${root}, each hashed with its path. It says WHICH BYTES the cell started on — two cells with ` +
      'different digests executed different products — and it is sampled once, before the cell seeds, ' +
      'so a rebuild landing inside one cell is not something it can see',
  }
}

/** Every executed file under `dir`, as `[relative, absolute]`. Missing directory means none. */
function executedFiles(dir) {
  const out = []
  const walk = (current, prefix) => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full, relative)
      else if (relative.endsWith(EXECUTED_EXTENSION)) out.push([relative, full])
    }
  }
  walk(dir, '')
  return out
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
