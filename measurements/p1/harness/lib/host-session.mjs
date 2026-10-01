// One cell's session against the stand-in API: the real host, the cell's own configuration
// and command line, and no model.
//
// This is the pre-flight's way of asking the host what it does, and it is deliberately the
// SAME path a paid cell takes up to the network: the same `claudeArgv`, the same `cellEnv`,
// the same `writeCellConfig`, in a sandbox seeded by the same `seedArm`. What differs is only
// where `ANTHROPIC_BASE_URL` points and what answers there. A pre-flight that built its own
// command line would clear a path no cell takes.

import { mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { cellEnv, claudeArgv, writeCellConfig } from './isolation.mjs'
import { readTicket } from './fixtures.mjs'
import { startFakeApi } from './fake-api.mjs'

/** A local port nothing listens on: the address a request that is not for the stand-in is sent to. */
const DEAD_PROXY = 'http://127.0.0.1:9'

/** Not a credential: the stand-in accepts anything. The host compares its last 20 characters. */
const STAND_IN_KEY = 'sk-ant-stand-in-0000000000000000000000'

/**
 * Run the host once, in an already-seeded sandbox, against the stand-in API.
 *
 * `script` and `outputFormat` are what a caller varies: the delivered-text pre-flight reads the
 * first request and needs neither; tests of what a session does script tool calls and read the
 * vendor's own event stream.
 */
export async function runAgainstStandIn({
  sandbox,
  arm,
  fixture,
  mnemaBin,
  pluginDir,
  claudeBin,
  script = [],
  outputFormat,
  // A session against the stand-in takes a second or two. Thirty seconds is for a machine under
  // load, and short enough that a host that never reaches the stand-in is reported as that.
  timeoutMs = 30_000,
}) {
  const { settingsPath, mcpPath } = writeCellConfig({ sandbox, arm, mnemaBin, pluginDir })
  // The host stops at "Not logged in" without an onboarding record and an approved key; the
  // sandbox HOME is where it looks, and it is the cell's own, so nothing of the machine's is read.
  writeFileSync(
    join(sandbox.home, '.claude.json'),
    JSON.stringify({
      hasCompletedOnboarding: true,
      bypassPermissionsModeAccepted: true,
      customApiKeyResponses: { approved: [STAND_IN_KEY.slice(-20)], rejected: [] },
      projects: {},
    }),
  )
  mkdirSync(join(sandbox.home, '.claude'), { recursive: true })

  const api = await startFakeApi({ script })
  const ticket = readTicket(fixture)
  try {
    const argv = claudeArgv({ ticket, settingsPath, mcpPath, outputFormat })
    const env = {
      ...cellEnv(sandbox, { authMode: 'api-key', arm }),
      ANTHROPIC_BASE_URL: api.url,
      ANTHROPIC_API_KEY: STAND_IN_KEY,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      // DEFENCE IN DEPTH, and found by a mutation: with the line above gone, the host went to the
      // real API with a key that is not one, waited, and held the whole preflight for half an hour.
      // Nothing could have been spent — the key is refused — but a stand-in the host can walk
      // around is not one. Everything that is not the stand-in is sent to a port nothing listens
      // on, so the same mistake now fails at once and by name.
      HTTPS_PROXY: DEAD_PROXY,
      HTTP_PROXY: DEAD_PROXY,
      ALL_PROXY: DEAD_PROXY,
      https_proxy: DEAD_PROXY,
      http_proxy: DEAD_PROXY,
      all_proxy: DEAD_PROXY,
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
    }
    const host = await new Promise((resolve) => {
      const child = spawn(claudeBin, argv, { cwd: sandbox.repo, env, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
      child.on('error', (error) => {
        clearTimeout(timer)
        resolve({ status: null, stdout, stderr, error })
      })
      child.on('close', (status, signal) => {
        clearTimeout(timer)
        resolve({ status, signal, stdout, stderr, error: null })
      })
    })
    return { ...host, ticket, requests: api.requests.slice() }
  } finally {
    await api.close()
  }
}
