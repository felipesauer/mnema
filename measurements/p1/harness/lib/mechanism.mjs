// Did the two mechanisms MOVE while the agent worked — and the premise the pilot falsified.
//
// THE PREMISE THIS FILE REPLACES. Until 2026-08-17 the question was answered by
// one number, `memory_files_after`: how many files the host's memory directory
// held when the cell ended. The doc above it claimed that number said "whether
// the host's auto-memory is LIVE in this mode at all".
//
// WHAT FALSIFIED IT. The pilot ran four cells of `a1-rounding`, one per arm, and
// the column read 2 in `host` and 0 in the other three. `seedArm` writes EXACTLY
// TWO FILES into the host's directory — the memory and its `MEMORY.md` index. So
// 2 was the seeded state, untouched, and 0 was three empty directories: the same
// four numbers would have come back from a run where the host's memory was never
// loaded at all. The column counted files, and neither reading a file nor
// rewriting one changes a count.
//
// WHAT THIS ANSWERS INSTEAD, and what it still cannot say:
//
//   WRITING   a content digest of the directory before and after. It sees a file
//             created, a file removed, and — the case the count was blind to — a
//             file MODIFIED in place. This is the half that is solid.
//   READING   the access time of each file, and only because the harness restores
//             the atime of every file it reads itself (see `memorySnapshot`), so
//             the cell's own instrument does not consume the one signal it is
//             measuring. It says a file was OPENED. It does not say the model used
//             what it read, and on a filesystem mounted `noatime` it cannot say
//             anything — which is why `atimeProbe` runs in every cell and the
//             column reports `null` rather than `false` when the probe fails.
//   NEITHER   whether the decision reached the model's context. Nothing outside
//             the vendor's own transcript can answer that, and the transcript is
//             off by isolation (`--no-session-persistence`).
//
// AND THE THIRD MECHANISM, added after the first held-out block. The `mnema`
// arm's record is not a directory the client loads — it is a server the model
// CHOOSES to call — so neither half above sees it. `mcpAsked` reads the traffic
// the wrapper recorded and answers whether a `tools/call` arrived; it lives in
// `lib/mcplog.mjs` with its own header, and it is folded in here so one object
// carries every column that qualifies without scoring.
//
// AND THE FOURTH, added with the fifth arm. That arm's mechanism is a hook the
// host runs before the model's first turn, and none of the three above can see it:
// it touches neither the memory directory nor the MCP channel. `hookInjected` reads
// the log of the cell's own `mnema` shim and answers whether the handler ran —
// `lib/hook.mjs` carries the argument for why the FIRST invocation is the hook's.
// It exists for the same reason the third one does: a cell whose hook never fired
// runs exactly like a `mnema` cell, and without the column eight such cells read as
// "the plugin did not help", which is the wrong finding with the wrong fix behind
// it.
//
// The tests are `tests/mechanism.test.mjs` — one per claim above, all against the
// fake agent, and the mutation matrix in `mutate.mjs` turns the write half back
// into a file count to prove the first one goes red.

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { mnemaRecords, servesRecord, servesUnasked } from './seed.mjs'
import { mcpAsked } from './mcplog.mjs'
import { hookInjected, pushMatchers, pushedTools } from './hook.mjs'
import { channelService } from './channel.mjs'

/** What the access-time signal is worth on this machine, in the line's own words. */
export const ATIME_USABLE = 'atime: a read that is not the harness’s own moves it on this filesystem'
export const ATIME_UNUSABLE =
  'atime does not move on this filesystem (noatime, or a kernel that does not record it): ' +
  'the read column cannot answer and is null, never false'

/**
 * Every file under `dir`, as name, content digest and access time.
 *
 * `preserveAtime` is the whole reason the read half works. Reading a file to
 * digest it IS a read, and under `relatime` — the default on Linux — only the
 * first read after a write updates the access time. An instrument that took its
 * own snapshot and left it there would spend the signal on itself and then report
 * that nobody read anything. So the before-snapshot puts the timestamps back with
 * `utimesSync` and records the value it restored, not the value it found.
 */
export function memorySnapshot(dir, { preserveAtime = false } = {}) {
  const files = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      // Stat FIRST: `readFileSync` below is itself a read, and on the after-snapshot
      // there is nothing to restore it from.
      const was = statSync(full)
      const content = readFileSync(full)
      if (preserveAtime) utimesSync(full, was.atime, was.mtime)
      // The value RESTORED, not the value found: `utimesSync` keeps whole
      // milliseconds and the comparison later is a strict `>`.
      const atimeMs = preserveAtime ? statSync(full).atimeMs : was.atimeMs
      files.push({
        name: relative(dir, full),
        sha: createHash('sha256').update(content).digest('hex').slice(0, 16),
        atimeMs,
      })
    }
  }
  walk(dir)
  return files
}

/** What changed between two snapshots, as one sorted list of `kind:name`. */
export function memoryWrites(before, after) {
  const was = new Map(before.map((f) => [f.name, f]))
  const is = new Map(after.map((f) => [f.name, f]))
  const writes = []
  for (const [name, file] of is) {
    const previous = was.get(name)
    if (!previous) writes.push(`added:${name}`)
    else if (previous.sha !== file.sha) writes.push(`modified:${name}`)
  }
  for (const name of was.keys()) {
    if (!is.has(name)) writes.push(`removed:${name}`)
  }
  return writes.sort()
}

/** Which files somebody opened between the two snapshots. Names only — see the header. */
export function memoryReads(before, after) {
  const is = new Map(after.map((f) => [f.name, f]))
  return before
    .filter((file) => {
      const now = is.get(file.name)
      return now !== undefined && now.atimeMs > file.atimeMs
    })
    .map((file) => file.name)
    .sort()
}

/**
 * How far back the probe stamps its own file. Anything comfortably inside a tick
 * and comfortably inside `relatime`'s 24-hour rule works; five seconds is both.
 */
const PROBE_BACKDATE_MS = 5_000

/**
 * Can this filesystem answer "was it read?" at all — asked in the cell, per cell.
 *
 * It repeats the snapshot's condition on a file of its own: `atime` equal to
 * `mtime`, which is what `relatime` — the Linux default — tests before it agrees
 * to record a read. What has to hold is not "atime exists" but "atime still moves
 * after the harness put it back". A machine where it does not gets a `null`
 * column and the reason; a `false` there would be the instrument answering a
 * question it cannot hear.
 *
 * IT BACKDATES INSTEAD OF RESTORING, and that is not cosmetic. The four calls
 * below run inside microseconds while inode timestamps advance in kernel ticks,
 * so the first version — which put back the timestamps it had just found —
 * compared two stamps from the SAME tick and read them as "did not move".
 * Measured on this machine, where access times demonstrably work: **216 of 500
 * runs said unusable**, and one of them turned a mutation that must go red into a
 * green run. The backdated stamp keeps the condition identical and gives the
 * comparison a margin the clock cannot swallow. Guarded by
 * `tests/mechanism.test.mjs`, which asserts the verdict is the SAME 100 times
 * over — not that it is `true`, which would be a claim about the machine.
 */
export function atimeProbe(dir) {
  const path = join(dir, '.atime-probe')
  try {
    writeFileSync(path, 'probe\n')
    readFileSync(path)
    const past = new Date(Date.now() - PROBE_BACKDATE_MS)
    utimesSync(path, past, past)
    const stamped = statSync(path).atimeMs
    readFileSync(path)
    const moved = statSync(path).atimeMs > stamped
    return { usable: moved, detail: moved ? ATIME_USABLE : ATIME_UNUSABLE }
  } catch (err) {
    return { usable: false, detail: `the access-time probe could not run: ${err.message}` }
  } finally {
    rmSync(path, { force: true })
  }
}

/**
 * The state the agent is about to be handed — taken as late as the cell allows.
 *
 * Anything the harness does to the memory directory after this point lands in the
 * agent's column, so this is the last thing a cell does before the spawn.
 */
export function mechanismBefore(sandbox) {
  return {
    // `null`, never `[]`. A before-snapshot that failed and was read as "the
    // directory was empty" would report every seeded file as one the agent added
    // — the column would not just lose the answer, it would invent one.
    memory: safely(() => memorySnapshot(sandbox.memory, { preserveAtime: true })),
    atime: atimeProbe(sandbox.cell),
  }
}

/**
 * The mechanism columns of the result line. Scores nothing, costs nothing.
 *
 * Takes the before-snapshot rather than re-deriving it: a "what moved" column
 * computed from the after-state alone is the defect this file exists to correct.
 */
export function mechanismBetween(before, sandbox, arm, mnemaBin) {
  const after = safely(() => memorySnapshot(sandbox.memory))
  const records = servesRecord(arm) ? safely(() => mnemaRecords(sandbox, mnemaBin).total) : null
  // The third mechanism is read from the cell, not from the memory directory, so
  // it survives every way the two snapshots can fail — a memory directory that
  // could not be read says nothing about whether the agent called the server.
  //
  // `pushedTools` comes out of the settings the CELL wrote, so the exclusion follows
  // whatever the product's declaration names rather than a literal kept here. A cell
  // whose settings cannot be read excludes nothing, which is the conservative side:
  // the column then over-reports asking and says so, instead of quietly dropping a
  // call the agent really made.
  const mcp = mcpAsked({ sandbox, arm, pushedTools: cellPushedTools(sandbox) })
  // Read from the cell for the same reason, and it answers on its own: a memory
  // directory that could not be read says nothing about whether the hook fired.
  const hook = hookInjected({ sandbox, arm, carriesHook: servesUnasked(arm) })
  // The fifth mechanism, and the one this bench does not write: read out of the
  // cell's own record, with the product's own reader, after the agent has run.
  const channel = channelService({ sandbox, arm, mnemaBin })
  // `memoryFiles` counts FILES, at any depth — a subdirectory is not one, its
  // contents are. The old column counted directory entries, which agrees on the
  // flat two-file directory the seed writes and would have disagreed the first
  // time an agent made a folder.
  const unknown = { memoryFiles: null, changed: null, writes: [], read: null, reads: [], records, mcp, hook, channel }
  if (after === null) return { ...unknown, readProbe: 'the memory directory could not be read after the cell' }
  if (before.memory === null) return { ...unknown, memoryFiles: after.length, readProbe: 'the memory directory could not be read before the cell' }

  const writes = memoryWrites(before.memory, after)
  const reads = before.atime.usable ? memoryReads(before.memory, after) : []
  return {
    memoryFiles: after.length,
    changed: writes.length > 0,
    writes,
    read: before.atime.usable ? reads.length > 0 : null,
    reads,
    readProbe: before.atime.detail,
    records,
    mcp,
    hook,
    channel,
  }
}

/**
 * The tools the cell's own hook declaration pushes, or none when there is no
 * declaration to read.
 *
 * Read from `<cell>/settings.json` — the file the run actually spawned with — rather
 * than from the product's `hooks.json`, because what matters for the column is what
 * THIS cell's host was told to call.
 */
export function cellPushedTools(sandbox) {
  return fromCellSettings(sandbox, pushedTools)
}

/** The host tools the cell's per-edit hook sits in front of, for the sentence that names them. */
export function cellPushMatchers(sandbox) {
  return fromCellSettings(sandbox, pushMatchers)
}

function fromCellSettings(sandbox, read) {
  try {
    return read(JSON.parse(readFileSync(join(sandbox.cell, 'settings.json'), 'utf8')).hooks)
  } catch {
    return []
  }
}

function safely(fn) {
  try {
    return fn()
  } catch {
    return null
  }
}
