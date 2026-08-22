// The fifth arm's HOST WIRING — the two declarations that make the record arrive
// UNASKED, and nothing else.
//
// WHAT THIS FILE IS AND IS NOT, stated first because the file used to be the whole
// mechanism and is not any more. Until 2026-08-19 the fifth arm was one `SessionStart`
// command hook, this module was all of it, and the arm was called `plugin`. The product
// then shipped two more channels — the rules addressed at a file, handed over as that
// file is about to be written, and the pause where a rule asks for a person — and the
// round's pre-registration names the arm `mnema+`: the record served unasked AND charged
// for. So this file now holds only the wiring of both declarations, the shim the document
// handler needs, and the reading of whether the document was produced. What the per-edit
// channel DID lives with the channel (`lib/channel.mjs`), because the evidence for that
// one is a fact in the cell's own record rather than a log this bench writes.
//
// WHY THERE IS A FIFTH ARM AT ALL. The first full round measured, over the two
// tasks that discriminate, `host` 8/8 · `base` 0/8 · `mnema` 0/8, with `mcp_asked`
// false in 20 of 20 instrumented cells. The arm carrying the decision in the
// record scored what the arm carrying no decision scored, and the column says why:
// the agent never called the server. The `host` arm carried the SAME decision in a
// mechanism the client loads without being asked, and conformed exactly where
// `base` failed. The product's answer to that is the plugin of #536: a
// `SessionStart` hook that hands `mnema brief` to the session as it opens. It
// shipped with no measurement, and this file is what puts it in a cell.
//
// WHAT RUNS IS THE PRODUCT'S OWN FILE. `plugin/hooks/hooks.json` and
// `plugin/hooks/session-start.mjs`, read from the working tree, never copied here
// and never reimplemented — a bench that measured its own re-write of the handler
// would be measuring the bench. The INSTALLATION is simulated: the host would
// discover the hook through a plugin directory, and the cell instead declares it
// in the `settings.json` it already writes, with `${CLAUDE_PLUGIN_ROOT}` resolved
// the way the host resolves it. That substitution is the only thing between the
// product's bytes and the cell, and it is declared in `ISOLATION_CHECKLIST`.
//
// THE TRAP THIS FILE EXISTS TO DISARM, and it is the reason for the shim below.
// The handler runs `mnema brief` off the PATH, and its documented behaviour when
// there is no project — or no `mnema` at all — is SILENCE and exit 0. So a cell
// whose PATH has no `mnema` produces exactly what a cell with an empty record
// produces: nothing. A PATH mistake would arrive dressed as a result, and the
// result it would be dressed as is "the surface did not help". Hence two things
// that are not optional: the cell puts a `mnema` of its own on the PATH, and both
// `--selftest` and `tests/the-fifth-arm.test.mjs` require the document to come back
// carrying the SEEDED DECISION'S TITLE before any cell runs.
//
// AND THE SECOND CHANNEL HAS A TRAP OF THE SAME SHAPE, one route further out: an
// `mcp_tool` hook that names a server nothing declares is never called, and the host
// says nothing about it (`measurements/mcp-tool-channel/`, where four wrong spellings
// were tried and every one of them was silent). The rewrite in `hooksDeclaration` is
// what disarms it, and the check that the tool actually answers is in
// `lib/channel.mjs`.
//
// AND THE COLUMN, for the same reason one cell further on. `--selftest` proves the
// injection works in a selftest sandbox; it cannot prove it happened in the cell
// that spent money. The shim records every invocation that came through the cell's
// PATH, so the result line can say whether the handler ran at all — the same
// service `mcp_asked` does for the record server, and against the same confusion.

import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { REPO_ROOT } from './root.mjs'
import { sandboxEnv } from './sandbox.mjs'
import { carriesDecision, readDecision } from './fixtures.mjs'

/** The host event the plugin's document handler answers, and the key it is declared under. */
export const HOOK_EVENT = 'SessionStart'

/**
 * The host event the plugin's per-edit channel answers.
 *
 * A SECOND EVENT, and it arrived after this file did. Until 2026-08-19 the fifth arm
 * was one `SessionStart` command hook and this module's header said so; the product
 * then shipped the rules addressed at a file, handed over as that file is about to be
 * written, and the pause where a rule asks for a person. Both ride this event, both
 * are declared in the same `hooks.json`, and neither is a command: the entry is of
 * type `mcp_tool`, so what runs is a tool on the MCP server the cell already declares
 * (`packages/code/src/mcp/tools.ts`). That is the arm satisfying G7 of
 * `measurements/p1/round-2/arms.md` by construction rather than by argument — the
 * intelligence is in the server, and the host wiring is a manifest.
 */
export const EDIT_EVENT = 'PreToolUse'

/** What the host expands to the plugin's own directory. The cell expands it the same way. */
export const PLUGIN_ROOT_VARIABLE = '${CLAUDE_PLUGIN_ROOT}'

/** Where the shim writes what came through the cell's PATH. Inside `cell/`, never the repo. */
export const SHIM_LOG = 'mnema-calls.jsonl'

/** The verb the handler runs. The column reports on this one by name. */
export const HANDLER_VERB = 'brief'

export const HOOK_NO_HOOK =
  'this arm declares no SessionStart hook: there was nothing to inject, and the column is null'
export const HOOK_NO_SHIM =
  'the cell left no shim log: the harness never put its own mnema on the PATH, so the column ' +
  'cannot answer and is null, never false'
export const HOOK_SILENT = 'the shim was installed and nothing ever invoked mnema through the cell’s PATH'

/**
 * The plugin directory being measured.
 *
 * The default is the product's, in the working tree. The override exists for one
 * caller — `tests/selftest-refuses.test.mjs`, which has to hand the preflight a
 * plugin that does NOT inject and require it to refuse — and it is a parameter
 * rather than an ambient read for the same reason `mnemaBin` is.
 */
export function productPluginDir() {
  return process.env.MNEMA_BENCH_PLUGIN || join(REPO_ROOT, 'plugin')
}

export function hooksJsonPath(pluginDir) {
  return join(pluginDir, 'hooks', 'hooks.json')
}

export function pluginManifestPath(pluginDir) {
  return join(pluginDir, '.claude-plugin', 'plugin.json')
}

/**
 * The name a hook must use for the MCP server the PLUGIN declares — derived from the
 * product's own two files, never written here.
 *
 * The host spells a plugin's server `plugin:<plugin>:<server>`, which is documented
 * nowhere and was found by asking the host to list its own
 * (`measurements/mcp-tool-channel/`): four other spellings were tried and the tool was
 * never called, silently. The product's own test builds the expected string this same
 * way (`the-rule-reaches-the-writing.test.ts`), so a rename of the plugin or of its
 * server moves both at once instead of leaving the bench agreeing with a stale copy.
 *
 * Throws on a manifest that declares anything other than exactly one server: this
 * function's whole value is that the name is not a guess, and a guess about which of
 * two servers the hook meant is a guess.
 */
export function pluginScopedServerName(pluginDir = productPluginDir()) {
  const path = pluginManifestPath(pluginDir)
  let manifest
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`${path}: ${err.message}`)
  }
  const servers = Object.keys(manifest?.mcpServers ?? {})
  if (servers.length !== 1) {
    throw new Error(`${path} declares ${servers.length} MCP servers, expected exactly one`)
  }
  if (typeof manifest.name !== 'string' || manifest.name === '') {
    throw new Error(`${path} declares no plugin name`)
  }
  return `plugin:${manifest.name}:${servers[0]}`
}

/**
 * The product's own hook declaration, with the plugin root resolved and the plugin's
 * server name replaced by the one the CELL declares.
 *
 * Read from `hooks.json` rather than written here on purpose: the command string, the
 * tool name, the timeout and the shape of the matcher are all the product's, so a
 * change to any of them changes what the cell runs instead of quietly diverging from
 * it.
 *
 * TWO SUBSTITUTIONS, AND THEY ARE THE SAME SUBSTITUTION. The host discovers this
 * plugin through a plugin directory; the cell declares its pieces by hand instead, and
 * both of the strings that depend on the discovery route have to be rewritten for the
 * route the cell takes. `${CLAUDE_PLUGIN_ROOT}` is the first and was always here. The
 * second is the SERVER NAME: a hook of type `mcp_tool` names the server it calls, a
 * plugin's server is spelled `plugin:<plugin>:<server>`, and a server declared through
 * `--mcp-config` carries its plain name instead — measured, on the real host, with no
 * model, in `.refactor/probes/the-record-asks-for-a-person/asks-a-person.mjs`, which
 * declares the server as `probe` through `--mcp-config` and the hook as `server:
 * 'probe'` through `--settings` and gets the tool called. Left unrewritten the host
 * would look for a server nothing declares, the tool would never be called, and the
 * failure is SILENT: no error, no warning, and eight cells that read as "the rules did
 * not help" when the rules never arrived. That is the same trap the PATH shim exists
 * for, one channel further on.
 *
 * `serverName` IS REQUIRED, for the reason `env` is required in
 * {@link runSessionStartHook}: it has exactly one correct value — the key the cell's
 * own `mcp.json` uses — and a default here would be a second place that decides it.
 *
 * Throws on anything it cannot vouch for. A cell that ran with a hook it could not
 * read, or with a hook naming a server that is not there, would be the fifth arm minus
 * the thing that makes it the fifth arm, and it would score as the fourth.
 */
export function hooksDeclaration(pluginDir = productPluginDir(), { serverName } = {}) {
  if (!serverName) throw new Error('hooksDeclaration needs the server name the cell declares')
  const path = hooksJsonPath(pluginDir)
  const scoped = pluginScopedServerName(pluginDir)
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8').split(PLUGIN_ROOT_VARIABLE).join(pluginDir))
  } catch (err) {
    throw new Error(`${path}: ${err.message}`)
  }
  const hooks = parsed?.hooks
  if (!hooks || typeof hooks !== 'object') throw new Error(`${path} declares no "hooks" object`)
  const matchers = hooks[HOOK_EVENT]
  if (!Array.isArray(matchers) || matchers.length === 0) {
    throw new Error(`${path} declares no ${HOOK_EVENT} hook`)
  }
  const commands = handlerCommands(hooks)
  if (commands.length === 0) throw new Error(`${path} declares ${HOOK_EVENT} with no command`)
  for (const command of commands) {
    if (command.includes('${')) throw new Error(`${path}: an unresolved variable is left in: ${command}`)
  }

  // The per-edit channel. Its entries are rewritten in place, and every one of them
  // has to have named the plugin's own server before the rewrite: an entry naming
  // something else is a product this bench does not understand, and guessing what it
  // meant is how a dead hook ships looking installed.
  const pushes = mcpToolEntries(hooks)
  if (pushes.length === 0) throw new Error(`${path} declares no ${EDIT_EVENT} hook of type mcp_tool`)
  for (const entry of pushes) {
    if (entry.server !== scoped) {
      throw new Error(`${path}: a ${EDIT_EVENT} hook names the server "${entry.server}", not "${scoped}"`)
    }
    if (typeof entry.tool !== 'string' || entry.tool === '') {
      throw new Error(`${path}: a ${EDIT_EVENT} hook names no tool`)
    }
    entry.server = serverName
  }
  // Nothing may still be addressed at the plugin route. Asserted over the whole
  // declaration rather than over the entries just rewritten, because a future entry
  // under a third event would be missed by the loop and caught here.
  if (JSON.stringify(hooks).includes(scoped)) {
    throw new Error(`${path}: "${scoped}" is still in the declaration after the rewrite`)
  }
  return hooks
}

/** Every `mcp_tool` entry of the per-edit event, in order — the objects, not copies. */
export function mcpToolEntries(hooks) {
  return (hooks?.[EDIT_EVENT] ?? [])
    .flatMap((matcher) => matcher?.hooks ?? [])
    .filter((entry) => entry?.type === 'mcp_tool')
}

/**
 * The matchers the per-edit event fires on — WHICH host tools the push sits in front of.
 *
 * It exists for one sentence in one place, and that sentence is the honest half of a rule
 * that can be wrong: a cell of the surface arm where files changed and the push never fired
 * is INVALID, and one of the two ways that happens is an agent that wrote the file with a
 * tool the matcher does not cover — a `Bash` heredoc, say. The bench cannot tell that from a
 * hook that never fired, so the reason it prints names both and names the matcher, and a
 * reader who has the diff can tell which.
 */
export function pushMatchers(hooks) {
  return (hooks?.[EDIT_EVENT] ?? [])
    .filter((matcher) => matcher?.hooks?.some((entry) => entry?.type === 'mcp_tool'))
    .map((matcher) => matcher.matcher ?? '(every tool)')
}

/**
 * The tools the SURFACE calls, as opposed to the ones an agent chooses to call.
 *
 * It exists for one column. `mcp_asked` answers "did the agent ask?" by counting the
 * `tools/call` messages that arrive at the cell's server, and on this arm the host
 * calls a tool on that same server before every edit. Counted in, the column would
 * read `true` in every cell of the arm and it would read as the finding round 1 was
 * missing — the agent finally asking — when nobody asked anything. So the arm's own
 * push is named here, out of the declaration the cell writes, and excluded there.
 */
export function pushedTools(hooks) {
  return [...new Set(mcpToolEntries(hooks).map((entry) => entry.tool))].sort()
}

/** Every command string the declaration would run for this event, in order. */
export function handlerCommands(hooks) {
  return (hooks?.[HOOK_EVENT] ?? [])
    .flatMap((matcher) => matcher?.hooks ?? [])
    .filter((entry) => entry?.type === 'command' && typeof entry.command === 'string')
    .map((entry) => entry.command)
}

/**
 * The script files a command names, as absolute paths.
 *
 * Used only to say WHICH artefact the cell is about to run, and to name a
 * declaration that points at nothing. A command with no such path is not an error
 * here — it is a command this function has nothing to say about, and inventing a
 * failure for it would be an instrument that errs by accusing.
 */
export function handlerFiles(hooks) {
  const found = []
  for (const command of handlerCommands(hooks)) {
    for (const match of command.matchAll(/(\/[^\s"']+\.(?:mjs|cjs|js|sh))/g)) found.push(match[1])
  }
  return found
}

export function binDir(sandbox) {
  return join(sandbox.cell, 'bin')
}

export function shimLogPath(sandbox) {
  return join(sandbox.cell, SHIM_LOG)
}

/**
 * Put a `mnema` on the cell's PATH, and make it say it was called.
 *
 * The log is created EMPTY here, and that is the whole three-silences idiom of
 * this bench in one line: a log that is missing means the harness never installed
 * the shim, so the column cannot answer and is `null`; a log that exists and is
 * empty means it was installed and nothing called it, which is `false` and is an
 * answer. Collapsing the two would slander the cell that was instrumented
 * correctly and simply never had its hook fire.
 *
 * The shim is CommonJS with an absolute interpreter: it has no extension, because
 * PATH lookup needs the name `mnema` exactly, and a `node` found through PATH would
 * be one more thing the cell inherited from the machine.
 */
export function installMnemaOnPath({ sandbox, mnemaBin }) {
  const dir = binDir(sandbox)
  mkdirSync(dir, { recursive: true })
  const log = shimLogPath(sandbox)
  writeFileSync(log, '')
  const shim = join(dir, 'mnema')
  writeFileSync(
    shim,
    `#!${process.execPath}\n` +
      `const { appendFileSync } = require('node:fs')\n` +
      `const { spawnSync } = require('node:child_process')\n` +
      `const argv = process.argv.slice(2)\n` +
      `try { appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, ppid: process.ppid }) + '\\n') } catch {}\n` +
      // stdio inherited: the handler reads the document off this process's stdout,
      // and anything this shim added to it would be the bench editing the record.
      `const out = spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(mnemaBin)}, ...argv], { stdio: 'inherit' })\n` +
      `process.exit(out.status ?? 1)\n`,
  )
  chmodSync(shim, 0o755)
  return { dir, shim, log }
}

/** The cell environment with the shim's directory in front of the inherited PATH. */
export function hookEnv(sandbox, extra = {}) {
  const base = sandboxEnv(sandbox, extra)
  return { ...base, PATH: `${binDir(sandbox)}:${base.PATH}` }
}

/**
 * Run the declared `SessionStart` handler the way the host runs a command hook:
 * through a shell, in the project directory, in the environment given.
 *
 * `env` IS REQUIRED, and that is the correction that matters here. The first
 * version built its own with `hookEnv`, and the mutation matrix found the hole: the
 * mutation that takes the shim OFF the cell's PATH (`m`) left this check GREEN,
 * because the check was not asking the same question the cell asks. It is the same
 * defect `mcpProbe` already avoids by reading the declaration the cell writes
 * instead of a command of its own making — a preflight that clears a path no cell
 * takes has cleared nothing. So the environment comes from the ONE place that
 * builds a cell's environment, `cellEnv`, and there is no default to fall back to.
 *
 * Nothing is written to its stdin. The handler documents that it reads none, and a
 * writer waiting on a pipe nobody closes would hang the preflight.
 */
export function runSessionStartHook({ sandbox, settingsPath, env, timeoutMs = 30_000 }) {
  if (!env) throw new Error('runSessionStartHook needs the environment the cell will spawn with')
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
  const commands = handlerCommands(settings.hooks)
  if (commands.length === 0) return { ok: false, detail: `${settingsPath} declares no ${HOOK_EVENT} command` }

  const outputs = []
  for (const command of commands) {
    const ran = spawnSync('/bin/sh', ['-c', command], {
      cwd: sandbox.repo,
      encoding: 'utf8',
      // `CLAUDE_PROJECT_DIR` is what the host announces to every command hook.
      env: { ...env, CLAUDE_PROJECT_DIR: sandbox.repo },
      timeout: timeoutMs,
      input: '',
    })
    if (ran.error) return { ok: false, detail: `the handler could not run: ${ran.error.message}`, command }
    outputs.push({ command, exit: ran.status, stdout: ran.stdout ?? '', stderr: ran.stderr ?? '' })
  }
  return { ok: true, outputs }
}

/**
 * The document the handler would hand the session, or the reason there is none.
 *
 * The handler's contract is one JSON object on stdout with the context inside it,
 * and silence for every outcome it cannot serve. So the parse is strict: a mute
 * handler and a handler whose output is not that object are DIFFERENT sentences
 * here, because "the hook did not help" and "the hook did not run" are opposite
 * conclusions about the product.
 */
export function injectedDocument({ sandbox, settingsPath, env }) {
  const ran = runSessionStartHook({ sandbox, settingsPath, env })
  if (!ran.ok) return { document: null, detail: ran.detail }

  const documents = []
  for (const out of ran.outputs) {
    if (out.stdout.trim() === '') {
      return {
        document: null,
        detail:
          `the handler wrote nothing (exit ${out.exit})` +
          (out.stderr.trim() ? `, and said on stderr: ${out.stderr.trim().split('\n')[0].slice(0, 200)}` : ''),
      }
    }
    let reply
    try {
      reply = JSON.parse(out.stdout)
    } catch {
      return { document: null, detail: `the handler wrote something that is not its reply object: ${out.stdout.slice(0, 200)}` }
    }
    const specific = reply?.hookSpecificOutput
    if (specific?.hookEventName !== HOOK_EVENT) {
      return { document: null, detail: `the handler answered for "${specific?.hookEventName}", not ${HOOK_EVENT}` }
    }
    if (typeof specific.additionalContext !== 'string' || specific.additionalContext === '') {
      return { document: null, detail: 'the handler answered with no additionalContext' }
    }
    documents.push(specific.additionalContext)
  }
  return { document: documents.join('\n'), detail: null }
}

/**
 * Everything wrong with the injection in one seeded cell, and THE DOCUMENT THAT ARRIVED.
 * An empty problem list means the record arrived.
 *
 * THE ASSERTION THAT MATTERS is the last one: on axis A the document must carry
 * the SEEDED DECISION'S TITLE. Without it a cell whose hook never fired runs
 * exactly like a `mnema` cell, and eight such cells read as "the plugin did not
 * help" — the wrong finding, with the wrong fix behind it.
 *
 * On axis B there is no decision to look for, and the check is that a document
 * arrives at all. That still catches the PATH trap, which is the failure that
 * disguises itself, because a `mnema` the shell cannot find produces no document
 * on either axis.
 *
 * IT RETURNS THE DOCUMENT NOW, and the shape changed rather than a second entry point
 * being added beside it. Round 3's pair asks a question no per-cell check can answer —
 * whether the two surface arms hand over the SAME document — and answering it needs the
 * bytes of two cells at once. Running the handler a second time to get them would be a
 * second reading of a channel that costs a process spawn per task per arm, and worse, it
 * would compare a document to one this check never saw.
 */
export function injectionProblems({ sandbox, fixture, settingsPath, env }) {
  const problems = []
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
  const commands = handlerCommands(settings.hooks)
  if (commands.length === 0) {
    problems.push(`${settingsPath} declares no ${HOOK_EVENT} command`)
    return { problems, document: null }
  }
  for (const file of handlerFiles(settings.hooks)) {
    if (!existsSync(file)) problems.push(`the declared handler is not there: ${file}`)
  }

  const { document, detail } = injectedDocument({ sandbox, settingsPath, env })
  if (document === null) {
    problems.push(`no document reached the session: ${detail}`)
    return { problems, document: null }
  }

  const called = hookCalls(sandbox)
  if (called.ran !== true) {
    problems.push(`the document arrived without the cell’s own mnema being called first: ${called.probe}`)
  }

  if (carriesDecision(fixture.axis)) {
    const { title } = readDecision(fixture)
    if (!document.includes(title)) {
      problems.push(`the document does not name the seeded decision "${title}"`)
    }
  }
  return { problems, document }
}

/**
 * A document with everything that is FRESH PER CELL named out of it.
 *
 * WHY IT IS NEEDED AT ALL, and it is not strictness: every cell founds its own record and
 * its own signing identity, so the decision's id differs between ANY two cells — two of
 * the same arm included. A raw comparison of two documents therefore never matches and
 * says nothing about the arms that produced them. What the claim "the two surface arms
 * hand over the same document" is about is the TEXT A MODEL READS, so the ids are named
 * and taken out and the rest is compared byte for byte.
 *
 * NAMED AND NEVER STRIPPED. A document with the citation removed would compare equal to
 * one that never cited anything, and citing the accepted decision BY ID is G1 of
 * `round-3/arms.md` — the one thing the comparison must not be able to lose.
 */
export function withoutFreshIds(text) {
  if (typeof text !== 'string') return null
  return text.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<A-FRESH-ID>')
}

/** Every invocation the shim recorded, or `null` if there is no log to read. */
export function readShimLog(sandbox) {
  let text
  try {
    text = readFileSync(shimLogPath(sandbox), 'utf8')
  } catch {
    return null
  }
  const calls = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      calls.push(JSON.parse(line))
    } catch {
      calls.push({ argv: null, truncated: true })
    }
  }
  return calls
}

/**
 * Did the handler run — and the one argument that makes this readable.
 *
 * `ran` is true when the FIRST thing that came through the cell's PATH was
 * `mnema brief`. That ordering is the evidence: a `SessionStart` hook fires before
 * the model's first turn, so nothing the agent chose to do can precede it. A
 * `brief` later in the log is NOT attributed to the hook — the agent can type the
 * same verb, and the document itself names the record's doors — so `invocations`
 * lists everything and the probe says the limit out loud.
 */
export function hookCalls(sandbox) {
  const silent = { ran: null, calls: null, invocations: [] }
  const log = readShimLog(sandbox)
  if (log === null) return { ...silent, probe: HOOK_NO_SHIM }
  if (log.length === 0) return { ran: false, calls: 0, invocations: [], probe: HOOK_SILENT }

  const counted = new Map()
  for (const call of log) {
    const verb = call.argv?.[0] ?? '(none)'
    counted.set(verb, (counted.get(verb) ?? 0) + 1)
  }
  const first = log[0].argv?.[0] ?? null
  return {
    ran: first === HANDLER_VERB,
    calls: log.length,
    invocations: [...counted].map(([verb, times]) => `${verb}:${times}`).sort(),
    probe:
      first === HANDLER_VERB
        ? `the first thing through the cell’s PATH was "mnema ${HANDLER_VERB}", which only the ` +
          'SessionStart hook can have run: it fires before the model’s first turn. A later ' +
          `${HANDLER_VERB} in the list is not attributed to the hook — the agent can type it too`
        : `the first thing through the cell’s PATH was "mnema ${first}", not "${HANDLER_VERB}": ` +
          'nothing here says the SessionStart hook ran',
  }
}

/** The hook columns of the result line, for whichever arm carries the hook. */
export function hookInjected({ sandbox, arm, carriesHook }) {
  if (!carriesHook) return { ran: null, calls: null, invocations: [], probe: HOOK_NO_HOOK }
  return hookCalls(sandbox)
}
