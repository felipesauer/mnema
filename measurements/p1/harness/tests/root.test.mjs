// The workspace root is FOUND, and the three things reached through it are there.
//
// This is the test that would have caught the failure it was written after. Two
// modules counted `..` from their own file to reach the repository root, and both
// counts were right while the bench lived at `.refactor/active/<bench>/`. The bench
// was moved one level deeper, into `.refactor/archive/surface-2026-08/<bench>/`, and
// both landed on `.refactor/`. Nothing announced it: the pre-registration file
// simply was not there, the product build simply was not there, and the suite came
// back 34 pass / 28 fail — read as a broken bench rather than as a broken path.
//
// So what is asserted is not "the root resolves". It is that the three absolute
// paths the bench BUILDS from it exist, which is the thing a wrong root breaks.
//
// AND THERE WAS A SECOND COUNT, in the other direction, which this file did not cover
// because the runner had not moved yet. `run.mjs` reached its TASKS with one `..` out
// of its own directory, correct while it was a subdirectory of them and wrong the day
// it was published into `measurements/p1/harness/`. That one is not fixed by a better
// count: where the tasks are is a fact about whoever runs the protocol, so it arrives
// in an environment variable and is REFUSED when nobody sets it.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  ROOT_MARKER,
  REPO_ROOT,
  RUNNER_DIR,
  TASKS_VARIABLE,
  findWorkspaceRoot,
  tasksRoot,
} from '../lib/root.mjs'
import { PREREG } from '../lib/split.mjs'
import { productPluginDir, hooksJsonPath } from '../lib/hook.mjs'
import { HARNESS_DIR, MNEMA_BIN } from './helpers.mjs'

describe('0 · the workspace root is found, not counted', () => {
  test('the root holds the marker that makes it the root', () => {
    assert.equal(existsSync(join(REPO_ROOT, ROOT_MARKER)), true)
    assert.equal(basename(REPO_ROOT), 'mnema')
    // The bench is INSIDE it. A root that is not an ancestor of the harness is a
    // root somebody else's tree handed us.
    assert.ok(HARNESS_DIR.startsWith(`${REPO_ROOT}/`), `${HARNESS_DIR} is not under ${REPO_ROOT}`)
  })

  test('and the three absolute paths built from it are all there', () => {
    // Each of these was missing for exactly as long as the count was wrong.
    assert.equal(existsSync(PREREG.split), true, `no pre-registration at ${PREREG.split}`)
    assert.equal(existsSync(PREREG.digests), true, `no frozen digests at ${PREREG.digests}`)
    assert.equal(existsSync(MNEMA_BIN), true, `no mnema build at ${MNEMA_BIN} — run pnpm build`)
    assert.equal(existsSync(hooksJsonPath(productPluginDir())), true, 'no plugin hooks.json')
  })

  test('the runner knows where IT is, which is a claim about its own tree', () => {
    // One level out of `lib/`, and it moves when the runner moves — unlike the count
    // that reached out of the runner and into the tasks.
    assert.equal(RUNNER_DIR, HARNESS_DIR)
  })

  test('and where the TASKS are is refused, not counted', () => {
    // The published runner cannot derive this. Ours are on a workbench git ignores;
    // anybody else's are in a repository this code has never seen.
    const said = process.env[TASKS_VARIABLE]
    try {
      delete process.env[TASKS_VARIABLE]
      assert.throws(() => tasksRoot(), new RegExp(`${TASKS_VARIABLE} is not set`))
      process.env[TASKS_VARIABLE] = join(REPO_ROOT, 'there-is-no-such-directory')
      assert.throws(() => tasksRoot(), /is not a directory/)
      process.env[TASKS_VARIABLE] = REPO_ROOT
      assert.equal(tasksRoot(), REPO_ROOT)
    } finally {
      if (said === undefined) delete process.env[TASKS_VARIABLE]
      else process.env[TASKS_VARIABLE] = said
    }
  })

  test('the search walks up, and says so instead of guessing when it cannot', () => {
    // Found from a deeper directory, the answer is the same one — which is the
    // property a count of `..` does not have.
    assert.equal(findWorkspaceRoot(join(HARNESS_DIR, 'lib')), REPO_ROOT)
    assert.equal(findWorkspaceRoot(HARNESS_DIR), REPO_ROOT)
    assert.throws(() => findWorkspaceRoot('/'), /cannot be found/)
  })
})
