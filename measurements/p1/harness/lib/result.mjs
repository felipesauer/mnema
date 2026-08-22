// One line per cell — and the qualification rides IN the line.
//
// The technique is `code-review-graph`'s: its CSV carries
// `ground_truth_mode = "graph-derived (circular — upper bound)"` as a FIELD, not
// as a sentence in the report beside it. Whoever opens the data without the
// report still reads the caveat. Ours are the model (a weaker model tends to
// benefit MORE from external knowledge, so a positive result here is a ceiling)
// and the scorer (deterministic, no judge).
//
// AND: no number in this file is ever derived. Cost and tokens come from the
// vendor's own result message; when a field is absent it is written `null` and
// named in `missing_result_fields`. An estimate that looks like a measurement is
// the one thing this protocol exists to not produce.

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { MODEL, PERMISSION_MODE, promptFingerprint } from './isolation.mjs'
import { servesUnasked } from './seed.mjs'

// `/5` for the same reason `/4`, `/3` and `/2` were: the 124 lines already
// committed — the pilot's four at `/1`, the first held-out block's 32 at `/2`, the
// round's other 80 at `/3` and the mechanism check's eight at `/4` — carry nothing
// about WHY a cell came back BROKEN, and they are NOT re-run to acquire it. A
// result is not redone to gain a column. The absent key is what says those lines
// are from before, and that only works if the number moves.
//
// WHAT `/5` ADDS, and why it is not cosmetic. Round 1 read `a5-no-retry` as four
// BROKEN cells in one arm — zero scorable cells, an arm with no rate at all — and
// the lines could not say whether the agents wrote unworkable code or the task's
// own happy path was unreachable. Answering it meant opening a diff by hand, and
// the answer was the task: its collaborator had no stated return type, so twelve
// of twenty cells guessed it wrong. The discriminant SAID so, in the sentence it
// prints beside the verdict, and the line threw that sentence away. It does not
// any more.
//
// AND WHAT `/6` ADDS is the fifth arm's second channel. The eight lines at `/4` were an
// arm whose whole mechanism was a document handed over as the session opened, and their
// `hook_ran` is all the evidence that arm could carry. The arm the round pre-registered
// also has the rules that arrive at the writing, and the evidence for that one is not a
// log this bench keeps — it is a `channel.served` the PRODUCT appends into the cell's own
// record. Those eight lines have no such key and are not re-run to gain it.
//
// AND WHAT `/7` ADDS is WHICH BUILD the cell executed. The 208 lines of the 2026-08-20
// round all carry `mnema_version: "0.0.0"`, which is what a `package.json` says and not
// what ran: that round had to be moved into a dedicated worktree mid-preflight because
// another process rebuilt `packages/code/dist` while it was starting, and had it not been
// noticed by a person, a round measuring two different products would have published one
// number with nothing in the data to say so. `mnema_build_sha256_16` is the bytes. Those
// 208 lines have no such key, they are not re-run to gain one, and the absent key is what
// says which side of this they are from.
export const RESULT_SCHEMA = 'mnema-bench/cell/7'

/**
 * What a surface-arm cell run on ROUND 1's tasks is, carried in the DATA and not only in
 * the report.
 *
 * Round 1's eight mechanism cells were run over `a2-due-day` and `a4-collation` because
 * that round had already shown those two to be the tasks that discriminate. The selection
 * is therefore BIASED BY A RESULT, which is the one thing a pre-registered split exists to
 * prevent, and it disqualifies those cells as a measurement of the promise. What they can
 * answer is narrower and worth asking: does the pushed context ARRIVE, and does the
 * verdict move with it.
 *
 * IT IS KEYED ON THE ROUND NOW, AND IT USED TO BE KEYED ON THE ARM. That was right while
 * the arm existed only as a mechanism check over burnt tasks, and it is wrong from the
 * moment a round PRE-REGISTERED it: round 2 froze its tasks, its arms and its reading
 * before this surface existed, so a `mnema+` cell of round 2 carries no such caveat and
 * must not travel with one. Round 1's tasks are still spent and still chosen after the
 * fact, so a cell of this arm run against them still does. The note therefore names the
 * round, and the line's own `null` says which side of that it is on.
 */
export const MECHANISM_CHECK_NOTE =
  'MECHANISM CHECK, NOT A MEASUREMENT. This cell ran the surface arm on ROUND 1’s tasks, which that ' +
  'round had already identified as the ones that discriminate, so the task selection is biased by a ' +
  'result and no rate computed from such cells can be compared with a pre-registered round’s. What ' +
  'they are evidence for is narrower: whether the pushed context reaches the session (hook_ran, ' +
  'channel_served) and whether the verdict moves with it. Round 2 pre-registered this arm before the ' +
  'surface existed, so its cells carry null here — and so does every cell of the other four arms.'

export const QUALIFICATIONS = {
  model_note:
    `${MODEL} is fixed by design; a weaker model tends to benefit more from external ` +
    'knowledge, so a positive result here is a ceiling, not the value in real use',
  scoring_note:
    'deterministic: the fixture’s own verify.<ext>, calibrated against a conforming and a ' +
    'violating reference before any model was called. No LLM judge.',
  cost_source: 'the vendor result message of the CLI; never estimated',
  axis_note:
    'axis A carries a decision the code does not reveal; axis B carries none and every arm must tie',
  mechanism_note:
    'memory_changed and memory_writes detect WRITING — a digest of the memory directory before and ' +
    'after — so a file modified in place counts, which memory_files_after alone cannot see (the ' +
    'pilot read 2 in host, and the seed writes exactly two files). memory_read is an access-time ' +
    'signal: it says a file was OPENED, never that the model used what it read, and it is null ' +
    'where memory_read_probe says the filesystem does not record access. num_turns and ' +
    'cache_read_input_tokens are INDIRECT — they separated host from base in the pilot and they ' +
    'are not evidence that anything was recalled. mcp_asked is the mnema arm’s channel: a wrapper ' +
    'in front of the record server records the JSON-RPC that ARRIVES at it, and mcp_tools names ' +
    'each tools/call as name:count. ASKING IS NOT USING — it does not say the answer was read, ' +
    'nor believed, nor obeyed — and it is null in the three arms that declare no server and where ' +
    'mcp_probe says the wrapper left no log; a server that ran and was never called is false, ' +
    'with mcp_tools empty. hook_ran is the fourth mechanism and the fifth arm’s: the cell puts its ' +
    'own mnema in front of PATH and logs every invocation, and the FIRST one being brief is the ' +
    'SessionStart hook, which fires before the model’s first turn. A later brief is not attributed ' +
    'to the hook — the agent can type the same verb. It says the document was PRODUCED and handed ' +
    'to the host, never that the model read it or obeyed it, and it is null in every arm that ' +
    'declares no hook. channel_served is the fifth mechanism and the only one this bench does not ' +
    'write: the product appends one channel.served per run and per channel into the CELL’S OWN ' +
    'record when a channel spoke, and the column is that fact read back with mnema timeline. It ' +
    'says the channel was LIVE in this cell — never that the model read what arrived, and never ' +
    'that it obeyed. An empty list is an ANSWER (nothing spoke, which is correct for a file no rule ' +
    'addresses); null is the arm with no surface, or a cell whose record could not be read, and ' +
    'channel_probe says which. mcp_pushed counts the calls the SURFACE made to that same server and ' +
    'they are OUT of mcp_asked, because a host calling a tool before an edit is not the agent ' +
    'asking — counted in, that column would have read true in every cell of this arm and looked ' +
    'like round 1’s missing finding.',
}

/**
 * Build the line. Key order is fixed so a file stays readable as it grows, and
 * every cell writes every key — a missing key and a null key say different
 * things.
 */
export function resultLine(fields) {
  const {
    fixture,
    axis,
    arm,
    run,
    // Which round's tasks this cell ran, because one caveat depends on it and nothing
    // else in the line can say it. It has no default: a line that could not say which
    // round it belongs to would be a line whose caveat is a guess.
    round,
    startedAt,
    endedAt,
    cliVersion,
    mnemaVersion,
    verdict = null,
    exit = null,
    status,
    error = null,
    rulerDetail = null,
    brokenDetail = null,
    seedOk,
    seedDetail = null,
    result = null,
    missingResultFields = [],
    diff = null,
    mechanism = null,
    truncated = false,
    // The build the cell executed, from `lib/build.mjs`. No default: a line that could
    // not say which bytes it ran is the line this key exists to abolish, and an omitted
    // argument silently producing `null` would rebuild it.
    build,
  } = fields

  const usage = result?.usage ?? {}
  return {
    schema: RESULT_SCHEMA,
    fixture,
    axis,
    arm,
    run,
    model: MODEL,
    cli_version: cliVersion,
    mnema_version: mnemaVersion,
    // WHICH BUILD, beside WHICH VERSION, and the pair is the point: the version is
    // `0.0.0` on both sides of a rebuild and the digest is not. `null` with a probe when
    // the artefact could not be digested — never a digest of something else.
    mnema_build_sha256_16: build.digest,
    mnema_build_files: build.files,
    mnema_build_probe: build.probe,
    permission_mode: PERMISSION_MODE,
    system_prompt_sha256_16: promptFingerprint(),

    verdict,
    exit,
    status,
    error,
    ruler_detail: rulerDetail,
    // The discriminant's OWN sentence when it refused the code — first line, as
    // printed. `null` on every cell whose code RAN, so the field says which of two
    // things happened: there was nothing to report, or the reason existed and was
    // thrown away. Round 1 threw it away.
    broken_detail: brokenDetail,
    truncated,

    cost_usd: result?.total_cost_usd ?? null,
    input_tokens: usage.input_tokens ?? null,
    output_tokens: usage.output_tokens ?? null,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
    duration_ms: result?.duration_ms ?? null,
    duration_api_ms: result?.duration_api_ms ?? null,
    num_turns: result?.num_turns ?? null,
    permission_denials: countDenials(result),
    result_subtype: result?.subtype ?? null,
    missing_result_fields: missingResultFields,

    files_changed: diff?.filesChanged ?? null,
    added_lines: diff?.added ?? null,
    removed_lines: diff?.removed ?? null,

    // Not scores — what the two mechanisms DID. The count is kept because it is
    // still the cheapest description of the directory, but it is no longer the
    // column that answers: the pilot's `host` cells read 2, which is exactly what
    // the seed wrote, and four such lines are consistent with a memory nobody
    // touched. `memory_changed` is the digest, `memory_read` the access time, and
    // `mechanism_note` states the limit of both — see `lib/mechanism.mjs`.
    memory_files_after: mechanism?.memoryFiles ?? null,
    memory_changed: mechanism?.changed ?? null,
    memory_writes: mechanism?.writes ?? [],
    memory_read: mechanism?.read ?? null,
    memory_reads: mechanism?.reads ?? [],
    memory_read_probe: mechanism?.readProbe ?? null,
    records_after: mechanism?.records ?? null,

    // The third mechanism, and the one the other two are blind to: the record is
    // served by a process the model has to CHOOSE to call. `mcp_asked` false and
    // `mcp_tools` empty is an answer — the server ran and nobody called it — and
    // it is the reading `null` would slander, so the two are never merged.
    mcp_asked: mechanism?.mcp?.asked ?? null,
    mcp_calls: mechanism?.mcp?.calls ?? null,
    mcp_tools: mechanism?.mcp?.tools ?? [],
    mcp_probe: mechanism?.mcp?.probe ?? null,

    // The fourth mechanism, and the one that separates "the surface did not help"
    // from "the surface did not run". Those are opposite conclusions about the
    // product, and eight cells cannot tell them apart without this column.
    hook_ran: mechanism?.hook?.ran ?? null,
    hook_calls: mechanism?.hook?.calls ?? null,
    hook_invocations: mechanism?.hook?.invocations ?? [],
    hook_probe: mechanism?.hook?.probe ?? null,

    // The fifth mechanism, and the only one whose evidence this bench does not write.
    // `channel.served` is appended by the PRODUCT into the cell's own record, once per
    // run and per channel, and read back here with the product's own reader. It is what
    // G5 of the round's arms.md asks for on the channel where `hook_ran` cannot reach:
    // a channel that was switched off, one that broke, and one that had nothing to say
    // all produce the same nothing in a diff, and only a fact tells them apart.
    channels_on: mechanism?.channel?.channels ?? null,
    channel_served: mechanism?.channel?.served ?? null,
    channel_served_any: mechanism?.channel?.servedAny ?? null,
    channel_probe: mechanism?.channel?.probe ?? null,

    // The calls the SURFACE made to the record server, kept apart from the agent's.
    mcp_pushed: mechanism?.mcp?.pushed ?? null,

    seed_ok: seedOk,
    seed_detail: seedDetail,

    started_at: startedAt,
    ended_at: endedAt,
    ...QUALIFICATIONS,
    // Arm- AND round-dependent, so it cannot live in QUALIFICATIONS with the
    // constants. It used to be arm-dependent alone, on the premise that only the
    // hooked arm's cells could be a mechanism check; round 2 pre-registered this arm
    // before the surface existed, which falsifies that — a `mnema+` cell of round 2
    // carries no caveat and a `mnema+` cell of round 1 still carries one, because
    // round 1's tasks were chosen after seeing which of them discriminate. `null` in
    // every other case is the honest value, and the key is written in EVERY line,
    // because a missing key and a null key say different things about which round a
    // line came from.
    selection_note: servesUnasked(arm) && round === 1 ? MECHANISM_CHECK_NOTE : null,
  }
}

function countDenials(result) {
  const denials = result?.permission_denials
  if (denials == null) return null
  return Array.isArray(denials) ? denials.length : null
}

/** Which of the fields the vendor was expected to provide did not arrive. */
export const EXPECTED_RESULT_FIELDS = ['total_cost_usd', 'duration_ms', 'num_turns', 'usage']

export function missingFrom(result) {
  if (!result) return EXPECTED_RESULT_FIELDS.slice()
  return EXPECTED_RESULT_FIELDS.filter((k) => result[k] == null)
}

export function appendResult(path, line) {
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(line)}\n`)
}
