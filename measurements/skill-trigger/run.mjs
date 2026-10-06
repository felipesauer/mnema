#!/usr/bin/env node
// Does the `recording-decisions` skill fire when it should, and stay quiet when it should not?
//
//   node run.mjs --selftest             every check below, against the real host with a stand-in
//                                       where the model would be. No model is called.
//   node run.mjs --yes [--runs n] [--out <dir>] [--resume]
//                                       every case x both arms x the frozen runs. SPENDS.
//   node run.mjs --read <cells.jsonl>   the reading, per arm and per kind of case.
//
// TWO ARMS AND ONE DIFFERENCE. Both load a copy of this product's plugin directory with
// `--plugin-dir`, the way the plugin reaches a person; the second copy has the skill's directory
// removed and nothing else, so its sessions are the baseline WITHOUT the skill — the same hooks,
// the same server, the same command line.
//
// WHAT A CELL READS, from the vendor's own event stream: whether the session called the host's
// `Skill` tool for this skill (the skill FIRED), and whether it called the server's
// `record_decision` (something was RECORDED). The first is the trigger; the second is what the
// trigger is for, and the only one of the two the baseline can show.
//
// WHAT IT DOES NOT SAY: whether what was recorded was right, or whether a person would have wanted
// it recorded. The cases say which kind each one is, and that is a judgement made before any cell.

import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { commitAll, createSandbox, git } from '../p1/harness/lib/sandbox.mjs'
import { hookEnv, installMnemaOnPath } from '../p1/harness/lib/hook.mjs'
import { authRequirement, installAuth } from '../p1/harness/lib/isolation.mjs'
import { isSessionTurn, startFakeApi } from '../p1/harness/lib/fake-api.mjs'
import { streamEvents } from '../p1/harness/lib/interactions.mjs'
import { REPO_ROOT } from '../p1/harness/lib/root.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const CASES = JSON.parse(readFileSync(join(HERE, 'cases.json'), 'utf8'))
const PLUGIN = join(REPO_ROOT, 'plugin')
const MNEMA = process.env.MNEMA_BENCH_MNEMA || join(REPO_ROOT, 'packages/code/dist/cli.js')
const CLAUDE = process.env.MNEMA_BENCH_CLAUDE || 'claude'
const SKILL_DIR = join('skills', CASES.skill)

/** The plugin directory an arm loads: a copy of the product's, without the skill in one arm. */
export function pluginForArm(arm, dest) {
  if (!CASES.arms.includes(arm)) throw new Error(`unknown arm: ${arm}`)
  cpSync(PLUGIN, dest, { recursive: true })
  if (arm === 'without-skill') rmSync(join(dest, SKILL_DIR), { recursive: true, force: true })
  return dest
}

/** Every file under a directory, relative to it, sorted. */
function filesUnder(dir) {
  const out = []
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(relative(dir, full))
    }
  }
  walk(dir)
  return out.sort()
}

/** The command line of a cell. One for both arms; only the directory it names differs. */
export function triggerArgv({ prompt, pluginDir, model = CASES.model }) {
  return [
    '-p',
    prompt,
    '--model',
    model,
    '--output-format',
    'stream-json',
    '--verbose',
    '--setting-sources',
    'project,local',
    '--plugin-dir',
    pluginDir,
    '--permission-mode',
    'bypassPermissions',
    '--no-session-persistence',
  ]
}

/**
 * What a session's stream says: whether it called the host's Skill tool for THIS skill, and
 * whether it called the server's `record_decision`. Read from `assistant` events only — a tool
 * the session called — and never from text, which can name a skill without using it.
 */
export function readTrigger(stdout) {
  let fired = false
  let recorded = 0
  const tools = []
  for (const event of streamEvents(stdout)) {
    if (event.type !== 'assistant') continue
    for (const block of event.message?.content ?? []) {
      if (block?.type !== 'tool_use') continue
      tools.push(block.name)
      const skill = String(block.input?.skill ?? block.input?.command ?? '')
      if (block.name === 'Skill' && (skill === CASES.skill || skill.endsWith(`:${CASES.skill}`))) fired = true
      if (/(^|__)record_decision$/.test(block.name)) recorded += 1
    }
  }
  const result = [...streamEvents(stdout)].reverse().find((event) => event.type === 'result') ?? null
  return { fired, recorded, tools, result }
}

/** A sandbox planted with the small repository the cases talk about, a record founded in it. */
function plantedCell(label) {
  const sandbox = createSandbox(`trigger-${label}`)
  cpSync(join(HERE, 'repo'), sandbox.repo, { recursive: true })
  const init = git(sandbox, ['init', '-q', '-b', 'main'])
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`)
  commitAll(sandbox, 'the repository as it starts')
  installMnemaOnPath({ sandbox, mnemaBin: MNEMA })
  const founded = spawnSync(join(sandbox.cell, 'bin', 'mnema'), ['init'], { cwd: sandbox.repo, env: hookEnv(sandbox), encoding: 'utf8' })
  if (founded.status !== 0) throw new Error(`mnema init failed: ${founded.stderr || founded.stdout}`)
  commitAll(sandbox, 'the record founded')
  return sandbox
}

function runHost(argv, { cwd, env, timeoutMs }) {
  return new Promise((done) => {
    const child = spawn(CLAUDE, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => {
      stdout += c
    })
    child.stderr.on('data', (c) => {
      stderr += c
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('close', (status) => {
      clearTimeout(timer)
      done({ status, stdout, stderr })
    })
  })
}

const DEAD_PROXY = 'http://127.0.0.1:9'
const STAND_IN_KEY = 'sk-ant-stand-in-0000000000000000000000'

/** One session of an arm against the stand-in API: the first request, the stream, nothing spent. */
export async function standInSession({ arm, prompt, script = [] }) {
  const sandbox = plantedCell(`selftest-${arm}`)
  try {
    const pluginDir = pluginForArm(arm, join(sandbox.cell, 'plugin'))
    writeFileSync(
      join(sandbox.home, '.claude.json'),
      JSON.stringify({
        hasCompletedOnboarding: true,
        bypassPermissionsModeAccepted: true,
        customApiKeyResponses: { approved: [STAND_IN_KEY.slice(-20)], rejected: [] },
        projects: {},
      }),
    )
    const api = await startFakeApi({ script })
    try {
      const env = {
        ...hookEnv(sandbox),
        ANTHROPIC_BASE_URL: api.url,
        ANTHROPIC_API_KEY: STAND_IN_KEY,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        HTTPS_PROXY: DEAD_PROXY,
        HTTP_PROXY: DEAD_PROXY,
        https_proxy: DEAD_PROXY,
        http_proxy: DEAD_PROXY,
        NO_PROXY: '127.0.0.1,localhost',
        no_proxy: '127.0.0.1,localhost',
      }
      const host = await runHost(triggerArgv({ prompt, pluginDir }), { cwd: sandbox.repo, env, timeoutMs: 30_000 })
      const turns = api.requests.filter((r) => String(r.url).includes('/v1/messages') && isSessionTurn(r.body))
      return { ...host, turns }
    } finally {
      await api.close()
    }
  } finally {
    sandbox.destroy()
  }
}

/** Every string a model would read in a request. */
function requestText(body) {
  const out = []
  const walk = (v) => {
    if (typeof v === 'string') out.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!['type', 'role', 'cache_control'].includes(k)) walk(x)
  }
  walk({ system: body.system, messages: body.messages, tools: body.tools })
  return out.join('\n').replace(/\s+/g, ' ')
}

/** The skill's description, as its SKILL.md frontmatter says it — what the host lists. */
function skillDescription() {
  const text = readFileSync(join(PLUGIN, SKILL_DIR, 'SKILL.md'), 'utf8')
  return /^description:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? ''
}

export async function selftest(onCheck = () => {}) {
  const checks = []
  const record = (name, ok, detail) => {
    checks.push({ name, ok, detail })
    onCheck({ name, ok, detail })
    return ok
  }
  // 1 — the cases are the frozen shape: unique ids, both kinds present, and a prompt each.
  {
    const ids = CASES.cases.map((c) => c.id)
    const kinds = new Set(CASES.cases.map((c) => c.expect))
    const ok =
      new Set(ids).size === ids.length &&
      kinds.size === 2 &&
      [...kinds].every((k) => ['trigger', 'no-trigger'].includes(k)) &&
      CASES.cases.every((c) => typeof c.prompt === 'string' && c.prompt.length > 0)
    if (!record('cases', ok, `${ids.length} cases: ${CASES.cases.filter((c) => c.expect === 'trigger').length} that should fire, ${CASES.cases.filter((c) => c.expect === 'no-trigger').length} that should not`)) return checks
  }
  // 2 — the two arms differ in the skill's directory and in nothing else.
  {
    const scratch = createSandbox('trigger-arms')
    try {
      const withSkill = filesUnder(pluginForArm('with-skill', join(scratch.cell, 'with')))
      const without = filesUnder(pluginForArm('without-skill', join(scratch.cell, 'without')))
      const missing = withSkill.filter((f) => !without.includes(f))
      const ok = missing.length > 0 && missing.every((f) => f.startsWith(`${SKILL_DIR}/`)) && without.every((f) => withSkill.includes(f))
      if (!record('arms', ok, `the baseline lacks [${missing}] and holds every other file of the plugin (${without.length})`)) return checks
    } finally {
      scratch.destroy()
    }
  }
  // 3 — what reaches the model: the skill is offered in one arm and not in the other.
  {
    const description = skillDescription().slice(0, 60)
    const seen = {}
    for (const arm of CASES.arms) {
      const session = await standInSession({ arm, prompt: CASES.cases[0].prompt })
      const first = session.turns[0]
      if (!first) {
        record('the skill is offered in one arm only', false, `${arm}: the host sent no session turn (exit ${session.status}): ${(session.stderr || session.stdout).slice(0, 200)}`)
        return checks
      }
      const text = requestText(first.body)
      seen[arm] = text.includes(CASES.skill) && text.includes(description)
    }
    const ok = seen['with-skill'] === true && seen['without-skill'] === false
    if (!record('the skill is offered in one arm only', ok, `the first request names the skill and its description: with-skill ${seen['with-skill']}, without-skill ${seen['without-skill']}`)) return checks
  }
  // 4 — the detector reads the real host's stream: a scripted call to the skill is read as one,
  //     the host resolves the name (no error result), and a session that calls nothing is not.
  {
    const called = await standInSession({
      arm: 'with-skill',
      prompt: CASES.cases[0].prompt,
      script: [{ name: 'Skill', input: { skill: `mnema:${CASES.skill}` } }],
    })
    const read = readTrigger(called.stdout)
    const resolved = called.turns[1]?.body?.messages?.at(-1)?.content?.find?.((c) => c?.type === 'tool_result')
    const quiet = readTrigger((await standInSession({ arm: 'with-skill', prompt: CASES.cases[0].prompt })).stdout)
    const ok = read.fired === true && resolved !== undefined && resolved.is_error !== true && quiet.fired === false
    if (
      !record(
        'the trigger is read off the stream',
        ok,
        `a scripted Skill call reads as fired (${read.fired}) and the host ran it (${resolved ? (resolved.is_error ? 'error' : 'ok') : 'no result'}); a session with no call reads as not fired (${!quiet.fired})`,
      )
    )
      return checks
  }
  // 5 — authentication, as a file.
  {
    const need = authRequirement('copy')
    record('auth (copy)', need.ok, need.ok ? 'the account credential file is there' : `missing: ${need.what}`)
  }
  return checks
}

/** The reading: per arm and per kind of case, how many cells fired the skill and how many recorded. */
export function reading(lines) {
  const out = {}
  for (const line of lines) {
    if (line.status !== 'ok') continue
    const key = `${line.arm} / ${line.expect}`
    const at = (out[key] ??= { cells: 0, fired: 0, recorded: 0 })
    at.cells += 1
    if (line.fired) at.fired += 1
    if (line.recorded > 0) at.recorded += 1
  }
  return out
}

/**
 * The sessions a capture already holds as `ok`, so a run cut by a limit can resume into the same
 * file. A session that failed is run again; every attempt stays in the capture.
 */
export function sessionsDone(path) {
  if (!existsSync(path)) return new Set()
  const done = new Set()
  for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line)
    if (row.status === 'ok') done.add(`${row.case}\u0000${row.arm}\u0000${row.run}`)
  }
  return done
}

async function runCells({ runs, outDir, resume }) {
  const version = spawnSync(CLAUDE, ['--version'], { encoding: 'utf8' }).stdout.trim()
  if (version !== CASES.cli_version) throw new Error(`the cases were frozen for ${CASES.cli_version} and this CLI is ${version}`)
  mkdirSync(outDir, { recursive: true })
  const path = join(outDir, 'cells.jsonl')
  if (!resume && existsSync(path)) throw new Error(`${path} already holds a capture: resume it with --resume`)
  const done = sessionsDone(path)
  let n = 0
  for (let run = 1; run <= runs; run += 1) {
    for (const [i, c] of CASES.cases.entries()) {
      const arms = (run + i) % 2 ? CASES.arms : [...CASES.arms].reverse()
      for (const arm of arms) {
        if (done.has(`${c.id}\u0000${arm}\u0000${run}`)) continue
        n += 1
        const sandbox = plantedCell(`${c.id}-${arm}-r${run}`)
        try {
          const pluginDir = pluginForArm(arm, join(sandbox.cell, 'plugin'))
          installAuth(sandbox, 'copy')
          const host = await runHost(triggerArgv({ prompt: c.prompt, pluginDir }), { cwd: sandbox.repo, env: hookEnv(sandbox), timeoutMs: 10 * 60_000 })
          let line
          try {
            const read = readTrigger(host.stdout)
            const ok = read.result?.subtype === 'success' && read.result?.is_error !== true
            line = {
              case: c.id, expect: c.expect, arm, run, model: CASES.model, cli_version: version,
              status: ok ? 'ok' : 'harness_error', fired: read.fired, recorded: read.recorded, tools: read.tools,
              cost_usd: read.result?.total_cost_usd ?? null, duration_ms: read.result?.duration_ms ?? null,
              error: ok ? null : String(read.result?.result ?? host.stderr).slice(0, 300),
            }
          } catch (err) {
            line = { case: c.id, expect: c.expect, arm, run, model: CASES.model, cli_version: version, status: 'harness_error', error: err.message }
          }
          appendFileSync(path, `${JSON.stringify(line)}\n`)
          console.log(`[${n}] ${c.id} ${arm} r${run}: ${line.status === 'ok' ? `fired=${line.fired} recorded=${line.recorded}` : line.error}`)
        } finally {
          sandbox.destroy()
        }
      }
    }
  }
  return path
}

async function main(argv) {
  if (argv.includes('--read')) {
    const path = argv[argv.indexOf('--read') + 1]
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    console.log(JSON.stringify(reading(lines), null, 2))
    return
  }
  if (!existsSync(MNEMA)) throw new Error(`no mnema build at ${MNEMA} — run \`pnpm build\` first`)
  const checks = await selftest((c) => console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}\n      ${c.detail}`))
  if (!checks.every((c) => c.ok) || checks.length < 5) {
    console.log('\nthe run does not start')
    process.exit(1)
  }
  console.log('\nevery check passed')
  if (argv.includes('--selftest')) return
  const runs = argv.includes('--runs') ? Number(argv[argv.indexOf('--runs') + 1]) : CASES.runs
  const cells = CASES.cases.length * CASES.arms.length * runs
  console.log(`\n${cells} sessions, model ${CASES.model}`)
  if (!argv.includes('--yes')) {
    console.log('this spends real budget. Re-run with --yes to start.')
    process.exit(2)
  }
  // The capture is named (`--out`, and the pre-registration names it); a resume without one is
  // refused rather than opening a second capture of the same sessions.
  const resume = argv.includes('--resume')
  const named = argv.includes('--out') ? resolve(argv[argv.indexOf('--out') + 1]) : null
  if (resume && !named) throw new Error('--resume needs --out <the capture to resume>')
  const outDir = named ?? resolve(HERE, 'results', new Date().toISOString().slice(0, 10))
  const path = await runCells({ runs, outDir, resume })
  console.log(`\nwrote ${path}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
}
