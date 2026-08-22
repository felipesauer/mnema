// The isolation list of the protocol (§4.4), as code.
//
// Every item there is a flag or a file here, and nothing about the invocation is
// left to whatever the machine happens to have configured. The defect this
// exists to prevent is published twice in the survey and is the most likely
// failure of any agentic measurement: the harness puts the product in a state it
// never actually runs in, or lets a setting differ between arms without anyone
// declaring it. In the case that nearly falsified `ponytail`, a SessionStart
// hook fired in every arm and the baseline was silently running the treatment.
//
// So: the command line below is IDENTICAL in all six arms. The only thing that
// differs is the CONTENT of the two files it points at.
//
// UNTIL 2026-08-18 THIS SAID the settings file was identical too, and the fifth arm
// falsified it: that arm's mechanism IS a `settings.json` key — the product's own hook
// declarations — so the file differs in exactly one arm, the way `mcp.json` differs in
// exactly two. Both differences are the arm itself and both are named in
// `ISOLATION_CHECKLIST` below. What has NOT changed is the argument vector: `claudeArgv`
// returns the same bytes for every arm, and `tests/four-arms.test.mjs` compares the
// four arms WITHOUT a surface against a golden frozen before the fifth arm existed.
//
// AND UNTIL 2026-08-19 THAT KEY HELD ONE DECLARATION. The fifth arm was `plugin` and
// carried the `SessionStart` hook alone; the arm the round pre-registered is `mnema+` and
// carries everything the product hands over unasked, so the same key now holds BOTH of
// the product's declarations — the document as the session opens, and the rules addressed
// at a file as that file is about to be written. The second one needed one substitution
// the first did not: it names an MCP server, and the name depends on how the plugin was
// installed. See `hooksDeclaration`.
//
// AND UNTIL 2026-08-20 EXACTLY ONE ARM HELD THAT KEY. Round 3 asks which of the two
// channels round 2's number belongs to, so it runs TWO arms that hold it: `mnema+` and
// `mnema-doc`. NOTHING IN THIS FILE DISTINGUISHES THEM, and that is the requirement
// rather than an omission — `round-3/arms.md` asks for the hook declaration byte-identical
// in both, so the host still calls the tool before every matched edit in `mnema-doc` and
// the tool answers with nothing because the channel is off. Two consequences it names:
// the arms differ in one bit, a switch position in the cell's own record, instead of
// differing in a switch AND in the host wiring; and `mcp_pushed` keeps counting in both,
// so both sides of the comparison carry the number of dispatches the host made. The whole
// difference between the two arms is seeded by `lib/seed.mjs` and is invisible here.

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { sandboxEnv, writeJson } from './sandbox.mjs'
import { MCP_SERVER_NAME, MCP_TRAFFIC, mcpServerDeclaration } from './mcplog.mjs'
import { GOVERNS_ADDRESS, servesUnasked, servesRecord } from './seed.mjs'
import {
  EDIT_EVENT,
  HOOK_EVENT,
  SHIM_LOG,
  hookEnv,
  hooksDeclaration,
  installMnemaOnPath,
  productPluginDir,
} from './hook.mjs'

/** Fixed and named in the result line, never inferred from a session default. */
export const MODEL = 'claude-haiku-4-5-20251001'

/**
 * The `NO_RUN` equivalent — identical in all six arms.
 *
 * It says how to work, never what to consult. A sentence about memory, records
 * or decisions here would nudge one arm's mechanism and quietly become the
 * second variable between arms.
 */
export const APPEND_SYSTEM_PROMPT = [
  'You are working in a small repository.',
  'Implement what the ticket asks by editing the files that are already there.',
  'Do not start servers or other long-running processes, and do not use the network.',
  'Stop when the ticket is done.',
].join(' ')

/**
 * One permission mode for every arm.
 *
 * Round C differed here — the second arm could not get `bypassPermissions` and
 * ran with `acceptEdits` plus a tool list instead — and that is the shape of the
 * defect above: a second difference between arms, declared and argued harmless.
 * The cell records `permission_denials` from the vendor's own result so a mode
 * that was not honoured shows up in the data instead of in an argument.
 */
export const PERMISSION_MODE = 'bypassPermissions'

export function promptFingerprint() {
  return createHash('sha256').update(APPEND_SYSTEM_PROMPT).digest('hex').slice(0, 16)
}

/**
 * How the cell authenticates, since HOME is thrown away with the sandbox.
 *
 * `copy`     the machine's OAuth credentials are copied into the cell HOME. The
 *            isolation stays total. Declared risk: the copy can refresh and
 *            rotate the token, and the rotation is discarded with the sandbox —
 *            the machine may need to log in again.
 * `inherit`  CLAUDE_CONFIG_DIR points at the real configuration directory, so
 *            refreshes land where they belong. Costs one isolation item: the
 *            cell can read that directory.
 * `api-key`  ANTHROPIC_API_KEY, passed through. Nothing of the machine's is read.
 */
export const AUTH_MODES = ['copy', 'inherit', 'api-key']

export function realConfigDir() {
  return process.env.MNEMA_BENCH_CONFIG_DIR || join(process.env.HOME ?? '', '.claude')
}

export function credentialsPath() {
  return join(realConfigDir(), '.credentials.json')
}

/**
 * What the chosen auth mode needs, and whether it is there.
 *
 * Checked before the run, never during: a run that burns half its cells and then
 * fails on authentication has spent money to learn something a file check knew.
 */
export function authRequirement(authMode) {
  switch (authMode) {
    case 'copy':
      return { what: credentialsPath(), ok: existsSync(credentialsPath()) }
    case 'inherit':
      return { what: realConfigDir(), ok: existsSync(realConfigDir()) }
    case 'api-key':
      return { what: 'ANTHROPIC_API_KEY', ok: Boolean(process.env.ANTHROPIC_API_KEY) }
    default:
      throw new Error(`unknown auth mode: ${authMode}`)
  }
}

/**
 * The environment the agent CLI is spawned with.
 *
 * `arm` reaches in for one reason: the arm that carries the hook needs its own
 * `mnema` in front of the inherited PATH, because the handler resolves the binary
 * by name and its documented behaviour when it cannot find one is SILENCE. A PATH
 * mistake there would arrive looking like a result — see the header of
 * `lib/hook.mjs`. No other arm's environment changes, and
 * `tests/four-arms.test.mjs` freezes that.
 */
export function cellEnv(sandbox, { authMode, arm = null }) {
  const extra = {}
  if (authMode === 'inherit') extra.CLAUDE_CONFIG_DIR = realConfigDir()
  if (authMode === 'api-key') extra.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? ''
  return servesUnasked(arm) ? hookEnv(sandbox, extra) : sandboxEnv(sandbox, extra)
}

/**
 * Put the credential where the cell will look for it.
 *
 * Only `copy` has anything to do: the other two modes reach the credential
 * through the environment. The copy is ONE file — not the configuration
 * directory — so the cell still gets none of the machine's settings, plugins,
 * history or memories.
 */
export function installAuth(sandbox, authMode) {
  if (authMode !== 'copy') return
  const source = credentialsPath()
  if (!existsSync(source)) throw new Error(`no credentials at ${source}`)
  const dir = join(sandbox.home, '.claude')
  mkdirSync(dir, { recursive: true })
  copyFileSync(source, join(dir, '.credentials.json'))
}

/**
 * The two per-cell configuration files.
 *
 * `settings.json` points the host's auto-memory at a directory inside the cell,
 * and that key is byte-identical in every arm. That is what keeps the MECHANISM on
 * everywhere and leaves the CONTENT as the only difference — in the `host` arm the
 * directory is seeded, in the others it is empty.
 *
 * IT USED TO BE THE WHOLE FILE, in all four arms, and the surface arms are what
 * changed that. Their mechanism is a `hooks` key: the product's own declarations,
 * BOTH of them, read out of `plugin/hooks/hooks.json` with `${CLAUDE_PLUGIN_ROOT}`
 * resolved the way the host resolves it and the plugin's server name replaced by the one
 * the line below declares. The installation is simulated and the ARTEFACT is not — a copy
 * of the handler kept here would make the cell measure the bench. Those arms also get their
 * own `mnema` in front of the PATH, because the document handler looks the binary up by
 * name. THE TWO OF THEM GET THE SAME BYTES HERE — `mnema-doc` differs from `mnema+` in a
 * switch seeded into the record and in nothing this function writes.
 *
 * THE SERVER NAME IS PASSED, not defaulted, and the two files below are why. The per-edit
 * declaration is a hook of type `mcp_tool`: it names the MCP server it calls, and the
 * server it calls is the one `mcp.json` declares two lines further down. So the ONE name
 * has to reach both files, and `MCP_SERVER_NAME` is where it comes from. Left at the
 * plugin's own spelling the host would look for a server nothing declared, the tool would
 * never be called, and nothing anywhere would say so.
 *
 * `mcp.json` is the arm too: empty for three of them, the mnema server for the three
 * that hold a record. `--project` is passed explicitly because without it the
 * cascade falls through to the global record, and that is how round A measured the
 * wrong project.
 *
 * The record server's declaration goes through `mcpServerDeclaration`, which puts
 * the traffic wrapper in front of it. That is the ONE thing this file changes for
 * the instrument, it changes it only in the arms that have a server at all, and
 * the isolation list below declares it.
 */
export function writeCellConfig({ sandbox, arm, mnemaBin, pluginDir = productPluginDir() }) {
  const settingsPath = join(sandbox.cell, 'settings.json')
  const settings = { autoMemoryDirectory: sandbox.memory }
  // Throws rather than degrades: a surface cell whose hooks could not be read, or whose
  // per-edit hook names a server this cell does not declare, is the `mnema` arm with a
  // longer name — and it would score as one.
  if (servesUnasked(arm)) {
    settings.hooks = hooksDeclaration(pluginDir, { serverName: MCP_SERVER_NAME })
  }
  writeJson(settingsPath, settings)

  const mcpPath = join(sandbox.cell, 'mcp.json')
  const mcpServers = servesRecord(arm)
    ? { [MCP_SERVER_NAME]: mcpServerDeclaration({ sandbox, mnemaBin }) }
    : {}
  writeJson(mcpPath, { mcpServers })

  const shim = servesUnasked(arm) ? installMnemaOnPath({ sandbox, mnemaBin }) : null

  return { settingsPath, mcpPath, shim }
}

/**
 * The command line — one shape, every arm.
 *
 * `--setting-sources project,local` drops the machine's user settings, and with
 * them its plugins; `--strict-mcp-config` drops every MCP server that is not in
 * the file above. Those two lines are the correction that saved the `ponytail`
 * result, and they are copied here on purpose.
 */
export function claudeArgv({ ticket, settingsPath, mcpPath, maxBudgetUsd = null }) {
  const argv = [
    '-p',
    ticket,
    '--model',
    MODEL,
    '--output-format',
    'json',
    '--setting-sources',
    'project,local',
    '--strict-mcp-config',
    '--mcp-config',
    mcpPath,
    '--settings',
    settingsPath,
    '--append-system-prompt',
    APPEND_SYSTEM_PROMPT,
    '--permission-mode',
    PERMISSION_MODE,
    '--no-session-persistence',
  ]
  if (maxBudgetUsd != null) argv.push('--max-budget-usd', String(maxBudgetUsd))
  return argv
}

/**
 * The isolation list itself, as data — printed by `--selftest` so the run states what it held fixed.
 *
 * IT IS COMPLETE WITH RESPECT TO `claudeArgv`, and that is a checked property rather than an
 * intention: `packages/code/tests/the-ruler-runs-in-another-hand.test.ts` requires every flag the
 * vector carries to be declared here or in the protocol's own §"What a cell holds fixed". An
 * undeclared flag is the defect that whole section exists to prevent — a published benchmark
 * elsewhere was nearly invalidated by a baseline running the treatment in secret — so it is red
 * here instead of being something a reader has to diff for.
 *
 * THREE ENTRIES WERE MISSING when that guard was written, and none of them was secret: they were
 * the three flags nobody had thought of as isolation. Two of them are how the cell is WIRED and one
 * is how it is READ, and all three change what a cell is.
 */
export const ISOLATION_CHECKLIST = [
  ['--setting-sources project,local', 'the machine’s user settings and plugins do not load'],
  ['--strict-mcp-config', 'no MCP server outside the per-cell file'],
  [`--model ${MODEL}`, 'fixed, and written into every result line'],
  [
    '--settings <cell>/settings.json',
    'autoMemoryDirectory inside the cell, identical in every arm. The file itself is NOT identical ' +
      'any more: the surface arms’ hooks are a key in it, on the lines below — and it is the SAME ' +
      'key with the same bytes in both of them',
  ],
  ['--append-system-prompt', 'identical in every arm; says how to work, never what to consult'],
  [`--permission-mode ${PERMISSION_MODE}`, 'one mode for every arm; denials are recorded'],
  ['--no-session-persistence', 'no transcript survives the cell'],
  [
    '--mcp-config <cell>/mcp.json',
    'the per-cell file `--strict-mcp-config` reduces the world to. It is the ONE thing that ' +
      'differs between the arms without a record and the arms with one, and the command line is ' +
      'identical in all six precisely so that this is where the difference has to be',
  ],
  [
    '--output-format json',
    'the result message is parsed, not scraped: cost, duration and turns are copied from the ' +
      'vendor’s own fields and a field that did not arrive is written null. It is on this list ' +
      'because it decides what a cell can be asked afterwards — the protocol asks future rounds ' +
      'for `stream-json`, which would say which doors the agent went through and in what order',
  ],
  [
    '--max-budget-usd <n>',
    'passed only when a ceiling is given, and then to every arm alike. A ceiling on one arm is a ' +
      'cell that stopped for a reason the other arms did not have',
  ],
  ['HOME / XDG_DATA_HOME / TMPDIR', 'inside the sandbox; the environment is an allowlist'],
  ['TZ=UTC', 'pinned — one fixture’s discriminant is a timezone'],
  ['fresh copy of the fixture repo', 'per cell, committed, and asserted clean before the agent runs'],
  ['fresh mnema record and identity', 'per cell — the product writes while it serves'],
  // No flag changed for this one, and it is on the list anyway: it is something
  // the harness DOES to the cell before the agent runs, in every arm, and an
  // undeclared difference between arms is the defect this list exists to prevent.
  // Nor for this one, and it is the first item that is NOT the same in every arm —
  // because the thing it wraps only exists in the three that hold a record. What it
  // must not do is change what the agent sees, so the transparency of the transport
  // is asserted byte for byte in `tests/mcp.test.mjs` before it is believed.
  [
    'mnema server behind the traffic wrapper',
    `the arms that hold a record: <cell>/${MCP_TRAFFIC} records the JSON-RPC that ARRIVES at the ` +
      'server — method, and the tool name of every tools/call, never the arguments. It forwards ' +
      'stdin unchanged and never touches the server’s own stdout/stderr, which are inherited file ' +
      'descriptors. Nothing the agent can observe differs: no tool, no prompt and no answer changes',
  ],
  [
    'memory snapshot before the spawn',
    'the same in every arm: the harness digests the memory directory and puts back the ' +
      'atime/mtime it read, so its own instrument does not consume the read signal. The probe ' +
      'file it writes lives in <cell>/, never in the memory directory or the repo',
  ],
  // The last items are the SURFACE, and they are the ones on this list that are NOT
  // the same in every arm. They ARE the same in the two arms that have them, which is
  // round 3's own requirement and the reason the wording below says "both surface arms"
  // rather than naming one: the only thing that separates those two is a switch seeded
  // into the record, and it is the item after these. Every one of them is declared for the same reason the wrapper
  // is: an undeclared difference between arms is the defect this list exists to prevent,
  // and a difference that IS the arm has to be readable as such.
  [
    `${HOOK_EVENT} hook in <cell>/settings.json`,
    'both surface arms, byte-identical: the declaration is read from the product’s own ' +
      'plugin/hooks/hooks.json, with ${CLAUDE_PLUGIN_ROOT} resolved to the plugin directory in the ' +
      'working tree, so what runs is the file the product ships and never a copy kept here. The ' +
      'INSTALLATION is simulated — a real host would find the hook through a plugin directory — ' +
      'and the artefact is not',
  ],
  [
    `${EDIT_EVENT} hook in <cell>/settings.json`,
    `both surface arms and byte-identical in them, out of the same file: an mcp_tool entry that ` +
      `calls a tool on the ` +
      `${MCP_SERVER_NAME} server this cell already declares, before every Write, Edit or ` +
      'NotebookEdit. ONE STRING IS REWRITTEN and it is declared here rather than argued away: a ' +
      'hook names its server, a server a PLUGIN declares is spelled plugin:<plugin>:<server>, and ' +
      `a server declared through --mcp-config carries its plain name — so the product’s ` +
      `plugin:mnema:mnema becomes ${MCP_SERVER_NAME}, derived from the product’s own manifest and ` +
      'never written here. It is the same substitution as ${CLAUDE_PLUGIN_ROOT}: both strings ' +
      'depend on the installation route, and the cell takes a different one. Left alone the host ' +
      'would look for a server nothing declares, the tool would never be called, and it fails ' +
      'SILENTLY — measured, with four wrong spellings, in measurements/mcp-tool-channel/. That the ' +
      'plain name IS the one that works was measured too, on the real host and with no model, in ' +
      '.refactor/probes/the-record-asks-for-a-person/asks-a-person.mjs',
  ],
  [
    'an ADDRESS on the seeded decision',
    'both surface arms: `mnema link <id> ' +
      GOVERNS_ADDRESS +
      ' --rel governs`, one string for all ten tasks. It is what lets the per-edit channel speak ' +
      'at all — measured: with no address the tool answers {} and appends nothing, so the arm ' +
      'would collapse into the document channel alone, which is the mechanism the eight cells of ' +
      '2026-08-18 already measured. An address says WHERE a rule applies and never what it says, ' +
      'so the knowledge the three seeded arms carry is still identical and still asserted. AND ' +
      'THE ADDRESS THIS ARM DOES NOT GET is --rel asks-for-a-person: the gate’s effect is that the ' +
      'write waits until a person decides, a -p cell has nobody to ask, and every cell of the arm ' +
      'would come back with the edit refused. That is a limit of a headless cell, not a choice ' +
      'about the product, and assertSeed asserts the absence rather than trusting it',
  ],
  [
    'a switch position in the cell’s own record',
    'the mnema-doc arm only, and it IS that arm: `mnema switch off edit-rules-push --scope private`, ' +
      'through the product’s own verb, so the position is an attributed fact the line reports out of ' +
      '`mnema switch` rather than out of a promise this bench makes. THE SCOPE IS PRIVATE AND IT WAS ' +
      'CHOSEN BY MEASUREMENT: `public` is the product’s default and makes `brief` replace the two ' +
      'lines saying the addressed rules arrive at an edit with three saying nothing will, naming the ' +
      'channel, who switched it and when — measured at +111 bytes of text handed to the model, in ' +
      '.refactor/probes/the-arm-that-separates-them/. That is correct of the product and wrong for ' +
      'this pair: round-3/arms.md asks that the two arms differ in exactly one bit, and a public ' +
      'switch makes them differ in a switch AND in three lines about the bench’s own arrangement. A ' +
      'private switch is invisible to the committed document, so the two arms hand over the SAME ' +
      'document, and `mnema switch` still reports the position because that reading spans every ' +
      'tree. THE COST, stated: in this arm the document tells the model the addressed rules arrive ' +
      'on their own and nothing arrives. It is the same sentence mnema+ reads, in the same position, ' +
      'so it is common to both sides of the subtraction — which is what a controlled variable is',
  ],
  [
    'a cell-owned mnema in front of PATH',
    `both surface arms: <cell>/bin/mnema, which forwards to the same build the record server ` +
      `runs and appends every invocation to <cell>/${SHIM_LOG}. It is not convenience. The ` +
      'handler resolves the binary by name and its correct behaviour when there is none is ' +
      'SILENCE, so without this a PATH mistake would produce exactly what an empty record ' +
      'produces and would be read as "the plugin did not help". AND IT IS A SECOND DIFFERENCE, ' +
      'declared rather than argued away: the handler inherits the agent’s environment, so a PATH ' +
      'the handler can see is a PATH the agent’s shell can see too, and this arm can reach the ' +
      'CLI where the mnema arm can only reach the server. It cannot be avoided inside the one ' +
      'variable this arm is allowed to add — giving every arm the shim would change the four arms ' +
      'that already spent cells — so it is MEASURED instead: hook_invocations names every verb ' +
      'that came through, so a cell where the agent used the CLI says so in its own line',
  ],
  [
    'a record this arm WRITES to while it serves',
    'the mnema+ arm, and it is a consequence rather than an arrangement: the per-edit channel ' +
      'appends channel.served to the cell’s own record, so this arm’s .mnema/ grows during the cell ' +
      'where the mnema arm’s only did if the agent chose to write. It changes no score — the diff ' +
      'the discriminant reads excludes .mnema by pathspec, exactly as it did in round 1 — and it is ' +
      'the point rather than a cost: that fact is the only evidence, in the cell that spent money, ' +
      'that the channel was live',
  ],
]
