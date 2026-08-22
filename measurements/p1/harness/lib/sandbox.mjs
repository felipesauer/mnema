// One sandbox per cell — created here, destroyed here, never the working tree.
//
// A6 of the bench: whoever measures makes its own temporary directory and
// removes it. Two things ride on that here and neither is optional. The `a3`
// fixture already broke once by inheriting `"type": "module"` from the product's
// own `package.json`, so a cell that ran inside this repository would be
// measuring a context the product contaminates. And the mnema arm FOUNDS AN
// IDENTITY: `mnema init` writes keys under `XDG_DATA_HOME` and a tree under
// `.mnema/`. A cell that shared either with the next one would not be an
// independent observation.

import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

/** Where sandboxes are made. Overridable so a constrained machine can point it elsewhere. */
export function sandboxRoot() {
  return process.env.MNEMA_BENCH_TMP || tmpdir()
}

/**
 * A fresh cell sandbox.
 *
 * The layout is fixed because the isolation list reads off it: `home` is HOME,
 * `xdg` is XDG_DATA_HOME (mnema's identity), `memory` is the host's
 * `autoMemoryDirectory`, `repo` is the working copy, `cell` holds the per-cell
 * configuration and the raw output.
 */
export function createSandbox(label = 'cell') {
  const root = mkdtempSync(join(sandboxRoot(), `mnema-bench-${label}-`))
  const paths = {
    root,
    home: join(root, 'home'),
    xdg: join(root, 'xdg'),
    cache: join(root, 'cache'),
    config: join(root, 'config'),
    tmp: join(root, 'tmp'),
    memory: join(root, 'memory'),
    repo: join(root, 'repo'),
    cell: join(root, 'cell'),
  }
  for (const key of ['home', 'xdg', 'cache', 'config', 'tmp', 'memory', 'repo', 'cell']) {
    mkdirSync(paths[key], { recursive: true })
  }
  return {
    ...paths,
    destroy() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/**
 * The environment every child of a cell runs in — built by ALLOWLIST, not by
 * deletion.
 *
 * The session that launches the harness carries `CLAUDE_CODE_*`, `ANTHROPIC_*`
 * and `MNEMA_*` variables of its own, and any of them reaching a cell is the
 * §2 defect of the protocol in its purest form: a setting that differs between
 * arms without anyone declaring it. An allowlist cannot be outgrown by a
 * variable nobody has heard of yet; a denylist can.
 *
 * `TZ` is pinned because one fixture's discriminant IS a timezone.
 */
export function sandboxEnv(sandbox, extra = {}) {
  return {
    PATH: process.env.PATH ?? '',
    SHELL: '/bin/bash',
    USER: 'bench',
    LOGNAME: 'bench',
    LANG: 'C.UTF-8',
    TZ: 'UTC',
    HOME: sandbox.home,
    TMPDIR: sandbox.tmp,
    XDG_DATA_HOME: sandbox.xdg,
    XDG_CONFIG_HOME: sandbox.config,
    XDG_CACHE_HOME: sandbox.cache,
    ...extra,
  }
}

/** Constant author for every commit the harness makes, so no cell inherits a machine's git identity. */
export const GIT_AUTHOR = { name: 'mnema bench', email: 'bench@invalid' }

export function git(sandbox, args, { env = {} } = {}) {
  return spawnSync('git', args, {
    cwd: sandbox.repo,
    encoding: 'utf8',
    env: { ...gitEnv(sandbox), ...env },
  })
}

function gitEnv(sandbox) {
  return {
    PATH: process.env.PATH,
    HOME: sandbox.home,
    // A cell must not read the machine's git configuration: `git init` would
    // pick up a global hooksPath, template or default branch and the fixture
    // would differ between machines.
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: GIT_AUTHOR.name,
    GIT_AUTHOR_EMAIL: GIT_AUTHOR.email,
    GIT_COMMITTER_NAME: GIT_AUTHOR.name,
    GIT_COMMITTER_EMAIL: GIT_AUTHOR.email,
  }
}

/** Copy the fixture's `repo/` into the sandbox and make it a git repository with one commit. */
export function plantRepo(sandbox, fixture) {
  cpSync(fixture.repo, sandbox.repo, { recursive: true, filter: (src) => !src.includes('__pycache__') })
  const init = git(sandbox, ['init', '-q', '-b', 'main'])
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`)
  commitAll(sandbox, 'the fixture as it starts')
}

export function commitAll(sandbox, message) {
  const add = git(sandbox, ['add', '-A'])
  if (add.status !== 0) throw new Error(`git add failed: ${add.stderr}`)
  const staged = git(sandbox, ['diff', '--cached', '--name-only'])
  if (!staged.stdout.trim()) return false
  const commit = git(sandbox, ['commit', '-q', '-m', message])
  if (commit.status !== 0) throw new Error(`git commit failed: ${commit.stderr}${commit.stdout}`)
  return true
}

/**
 * The tree the agent is handed must be clean.
 *
 * `git diff` is a metric of this protocol; a cell that starts dirty attributes
 * the seed's own writes to the agent.
 */
export function assertCleanTree(sandbox) {
  const status = git(sandbox, ['status', '--porcelain'])
  if (status.status !== 0) throw new Error(`git status failed: ${status.stderr}`)
  if (status.stdout.trim()) {
    throw new Error(`the tree is dirty before the cell runs:\n${status.stdout}`)
  }
}

export function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function exists(path) {
  return existsSync(path)
}
