// A clone the tests break must be a COPY. Round 1's tasks were once deleted through a
// `fixtures` link that `cloneFixtures` copied as a link and a test then removed from.

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { removeInside, sandboxRoot } from '../lib/sandbox.mjs'
import { TASKS_VARIABLE } from '../lib/root.mjs'

const scratch = []
function temp(label) {
  const dir = mkdtempSync(join(sandboxRoot(), `mnema-bench-${label}-`))
  scratch.push(dir)
  return dir
}

after(() => {
  for (const dir of scratch) removeInside(sandboxRoot(), dir)
})

/** A tasks root whose `fixtures` is a LINK to a real directory elsewhere. */
function linkedTasks() {
  const real = temp('real')
  const tasks = temp('linked')
  mkdirSync(join(real, 'task-a'))
  writeFileSync(join(real, 'task-a', 'ticket.txt'), 'frozen\n')
  mkdirSync(join(real, 'task-b'))
  writeFileSync(join(real, 'task-b', 'ticket.txt'), 'frozen\n')
  symlinkSync(real, join(tasks, 'fixtures'))
  writeFileSync(join(tasks, 'selftest.sh'), '#!/bin/sh\n')
  return { real, tasks }
}

describe('cloneFixtures', () => {
  test('copies the content of a linked fixtures directory, so deleting in the copy leaves the original', async () => {
    const { real, tasks } = linkedTasks()
    process.env[TASKS_VARIABLE] = tasks
    const { cloneFixtures } = await import('./helpers.mjs')
    const dest = temp('clone')

    const bench = cloneFixtures(dest)

    assert.equal(lstatSync(bench.fixturesDir).isSymbolicLink(), false, 'the copy is not a link')
    removeInside(dest, join(bench.fixturesDir, 'task-a'))
    assert.equal(existsSync(join(bench.fixturesDir, 'task-a')), false, 'gone from the copy')
    assert.equal(existsSync(join(real, 'task-a', 'ticket.txt')), true, 'the original is intact')
    assert.equal(existsSync(join(real, 'task-b', 'ticket.txt')), true)
  })
})

describe('removeInside', () => {
  test('refuses a path that reaches outside the root through a link, and removes nothing', () => {
    const outside = temp('outside')
    writeFileSync(join(outside, 'keep.txt'), 'kept\n')
    const root = temp('root')
    symlinkSync(outside, join(root, 'door'))
    assert.throws(() => removeInside(root, join(root, 'door', 'keep.txt')), /outside/)
    assert.equal(existsSync(join(outside, 'keep.txt')), true)
  })

  test('refuses a root that is not inside a temporary directory', () => {
    assert.throws(() => removeInside('/', join('/', 'nothing-here')), /not inside a temporary directory/)
  })

  test('refuses the root itself, and removes a link without following it', () => {
    const outside = temp('outside')
    writeFileSync(join(outside, 'keep.txt'), 'kept\n')
    const root = temp('root')
    assert.throws(() => removeInside(root, root), /outside/)
    symlinkSync(outside, join(root, 'door'))
    removeInside(root, join(root, 'door'))
    assert.equal(existsSync(join(root, 'door')), false)
    assert.equal(existsSync(join(outside, 'keep.txt')), true)
  })
})
