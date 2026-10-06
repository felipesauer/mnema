// The removal guard the measurement harnesses share, and the sweep that keeps them on it.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { removeInside, removeTemporary } from './remove-inside.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const MEASUREMENTS = join(HERE, '..')
const GUARD = join(HERE, 'remove-inside.mjs')

const made = []
function temp(label) {
  const dir = mkdtempSync(join(tmpdir(), `mnema-remove-inside-${label}-`))
  made.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of made) removeTemporary(dir)
})

// A decoy that is outside the accepted area in every layout, unlike the repository tree, which sits
// inside it when the checkout lives under the temporary directory. The area is pinned to `base/area`
// (the guard reads TMPDIR and MNEMA_BENCH_TMP at call time) and the decoy sits beside it, in
// `base/decoy`. Nothing here ever points a removal at the repository.
const decoyEnv = {}
function pinArea() {
  const base = temp('base')
  const area = join(base, 'area')
  const decoy = join(base, 'decoy')
  mkdirSync(area)
  mkdirSync(join(decoy, 'lib'), { recursive: true })
  const guard = join(decoy, 'lib', 'guard.mjs')
  writeFileSync(guard, 'kept')
  for (const key of ['TMPDIR', 'MNEMA_BENCH_TMP']) decoyEnv[key] = process.env[key]
  process.env.TMPDIR = area
  delete process.env.MNEMA_BENCH_TMP
  return { area, decoy, guard }
}
function unpinArea() {
  for (const [key, value] of Object.entries(decoyEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

describe('removeInside', () => {
  it('removes a tree inside a temporary root', () => {
    const root = temp('root')
    mkdirSync(join(root, 'a', 'b'), { recursive: true })
    writeFileSync(join(root, 'a', 'b', 'f.txt'), 'x')
    removeInside(root, join(root, 'a'))
    expect(existsSync(join(root, 'a'))).toBe(false)
    expect(existsSync(root)).toBe(true)
  })

  it('does nothing for a path that is not there', () => {
    const root = temp('root')
    removeInside(root, join(root, 'nothing'))
    removeInside(root, join(root, 'nothing', 'deeper'))
  })

  it('refuses a path that reaches outside the root through a link, and removes nothing', () => {
    const outside = temp('outside')
    writeFileSync(join(outside, 'keep.txt'), 'kept')
    const root = temp('root')
    symlinkSync(outside, join(root, 'door'))
    expect(() => removeInside(root, join(root, 'door', 'keep.txt'))).toThrow(/outside/)
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true)
  })

  it('removes a link without following it', () => {
    const outside = temp('outside')
    writeFileSync(join(outside, 'keep.txt'), 'kept')
    const root = temp('root')
    symlinkSync(outside, join(root, 'door'))
    removeInside(root, join(root, 'door'))
    expect(existsSync(join(root, 'door'))).toBe(false)
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true)
  })

  it('refuses the root itself, and a path beside it', () => {
    const root = temp('root')
    const beside = temp('beside')
    expect(() => removeInside(root, root)).toThrow(/outside/)
    expect(() => removeInside(root, beside)).toThrow(/outside/)
    expect(existsSync(beside)).toBe(true)
  })

  it('refuses a root that is not inside a temporary directory', () => {
    expect(() => removeInside('/', join('/', 'nothing-here'))).toThrow(/not inside a temporary directory/)
    const { decoy, guard } = pinArea()
    try {
      expect(() => removeInside(decoy, join(decoy, 'lib', 'guard.mjs'))).toThrow(/not inside a temporary directory/)
      expect(existsSync(guard)).toBe(true)
    } finally {
      unpinArea()
    }
  })
})

describe('removeTemporary', () => {
  it('removes a directory directly in the temporary area', () => {
    const dir = temp('own')
    writeFileSync(join(dir, 'f.txt'), 'x')
    removeTemporary(dir)
    expect(existsSync(dir)).toBe(false)
  })

  it('refuses a directory outside it, and one reached through a link', () => {
    const { area, decoy, guard } = pinArea()
    try {
      expect(() => removeTemporary(join(decoy, 'lib'))).toThrow(/not inside a temporary directory/)
      expect(existsSync(guard)).toBe(true)
      symlinkSync(decoy, join(area, 'door'))
      expect(() => removeTemporary(join(area, 'door', 'lib'))).toThrow(/not inside a temporary directory/)
      expect(existsSync(guard)).toBe(true)
    } finally {
      unpinArea()
    }
  })
})

describe('as a command', () => {
  it('removes inside and exits non-zero outside, for the shell harnesses', () => {
    const root = temp('root')
    mkdirSync(join(root, 'run'))
    execFileSync('node', [GUARD, root, join(root, 'run')])
    expect(existsSync(join(root, 'run'))).toBe(false)
    const beside = temp('beside')
    writeFileSync(join(beside, 'keep.txt'), 'kept')
    const refused = () => execFileSync('node', [GUARD, root, beside], { stdio: 'pipe' })
    expect(refused).toThrow(/outside/)
    expect(existsSync(join(beside, 'keep.txt'))).toBe(true)
  })
})

describe('the harnesses', () => {
  const REMOVES = /\brmSync\s*\(|\bfs\.rm\b|\brm\s*\(|\brmdir|\brimraf|(^|[\s;&|(])rm\s+-/
  const SOURCE = /\.(mjs|ts|js|sh)$/

  function files(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        const rel = relative(MEASUREMENTS, path)
        if (rel === 'p1' || rel === 'lib' || entry.name === 'results' || entry.name === 'node_modules') return []
        return files(path)
      }
      return SOURCE.test(entry.name) ? [path] : []
    })
  }

  it('remove only through the shared guard (p1 has its own and is not read here)', () => {
    const raw = []
    for (const file of files(MEASUREMENTS)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (REMOVES.test(line)) raw.push(`${relative(MEASUREMENTS, file)}:${i + 1}: ${line.trim()}`)
        })
    }
    expect(raw).toEqual([])
  })
})
