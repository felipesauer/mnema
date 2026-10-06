// The only recursive removal a measurement harness does outside `p1/`.
//
// `rmSync(path, { recursive: true })` follows whatever is on the way to `path`: when a
// directory above it is a symlink, what gets removed is whatever the link points at. So the
// target is resolved first, its PARENT through `realpathSync` and its own name kept as
// written (removing a link removes the link, not what it points at), and it is removed only
// when it lands strictly inside `root`, and `root` itself is inside the temporary area (the
// OS temp directory, or `MNEMA_BENCH_TMP` when set). Anything else throws and removes
// nothing. A path that is not there is not an error.
//
// As a command, for the shell harnesses:  node remove-inside.mjs <root> <path>

import { lstatSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

function within(parent, child) {
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function areas() {
  return [process.env.MNEMA_BENCH_TMP, tmpdir()].filter(Boolean).map((dir) => realpathSync(dir))
}

export function removeInside(root, path) {
  const base = realpathSync(root)
  if (!areas().some((area) => area === base || within(area, base))) {
    throw new Error(`refusing to remove under ${root}: it is not inside a temporary directory`)
  }
  let parent
  try {
    parent = realpathSync(dirname(path))
  } catch (err) {
    if (err.code === 'ENOENT') return
    throw err
  }
  const target = join(parent, basename(path))
  if (target === base || !within(base, target)) {
    throw new Error(`refusing to remove ${path}: it resolves to ${target}, outside ${base}`)
  }
  try {
    lstatSync(target)
  } catch (err) {
    if (err.code === 'ENOENT') return
    throw err
  }
  rmSync(target, { recursive: true, force: true })
}

/** Removes a directory a harness made for itself, when it sits inside the temporary area. */
export function removeTemporary(dir) {
  let parent
  try {
    parent = realpathSync(dirname(dir))
  } catch (err) {
    if (err.code === 'ENOENT') return
    throw err
  }
  const area = areas().find((a) => a === parent || within(a, parent))
  if (!area) throw new Error(`refusing to remove ${dir}: it is not inside a temporary directory`)
  removeInside(area, dir)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const [root, path] = process.argv.slice(2)
  if (!root || !path) {
    console.error('usage: remove-inside.mjs <root> <path>')
    process.exit(2)
  }
  try {
    removeInside(root, path)
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}
