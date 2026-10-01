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
  timeoutMs = 120_000,
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
