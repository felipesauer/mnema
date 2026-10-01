// What the session DID, read out of the vendor's own event stream.
//
// The protocol has asked for `--output-format stream-json` since round 1 and the harness passed
// `json` until now, which is why the data says WHAT each arm produced and not by WHICH PATH:
// no round could say whether an arm's agent read the decision file first, how many times it
// rewrote the file a rule governs, or whether the rule's text reached it before a second write.
// The per-edit channel in particular had no opportunity to matter in the rounds that ran — the
// pushed text lands after the result of the write that fired it, and no cell had a second write —
// and the only way to know that of a cell is to count its writes against its pushes in order.
//
// THE STREAM IS READ, NEVER SCRAPED. Each line is one JSON event; the interactions are the
// `tool_use` blocks of the assistant's messages, and a PUSH is a `PreToolUse` hook that answered
// with text (`hook_response`, event `PreToolUse`, `additionalContext` non-empty). The hook events
// are in the stream only because the argument vector asks for them (`--include-hook-events`), and
// a stream without them would read as "no push ever happened". `tests/interactions.test.mjs` proves,
// on the real host, that a surface arm's stream carries them — it is the one thing a parser tested
// on lines typed by hand could not tell.
//
// WHAT THIS DOES NOT SAY. It counts calls; it does not say the model read what a push carried,
// and a push's position in the stream is the host's order of events, not a statement about what
// the model had when it chose its next call.

/** The tools that put bytes in a file. */
export const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']

/** The lines of a stream as events; a line that is not JSON is the instrument saying so. */
export function streamEvents(stdout) {
  const events = []
  const lines = String(stdout ?? '').split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === '') continue
    try {
      events.push(JSON.parse(lines[i]))
    } catch {
      throw new Error(`stream line ${i + 1} is not JSON: ${lines[i].slice(0, 120)}`)
    }
  }
  return events
}

/** Whether a stream event is a hook that handed the session text before a tool ran. */
function isPush(event) {
  if (event?.type !== 'system' || event.subtype !== 'hook_response') return false
  if (event.hook_event !== 'PreToolUse' || event.outcome === 'error') return false
  let reply
  try {
    reply = JSON.parse(event.output ?? event.stdout ?? '')
  } catch {
    return false
  }
  const text = reply?.hookSpecificOutput?.additionalContext
  return typeof text === 'string' && text !== ''
}

/**
 * The interactions of one session, from its `stream-json` output.
 *
 * Returns the result message (the last `result` event — the same object `--output-format json`
 * prints) and, for the interactions, `toolCalls` (name -> count), `toolSequence` (names in the
 * order they were called), `writes` (calls to a tool that writes), `pushes` (hooks that answered
 * with text) and `writesAfterPush` (writes that came AFTER the first push — a write with a push
 * behind it, which is the opportunity the per-edit channel needs).
 */
export function readStream(stdout) {
  const events = streamEvents(stdout)
  const result = [...events].reverse().find((event) => event.type === 'result') ?? null

  const toolSequence = []
  const toolCalls = {}
  let writes = 0
  let pushes = 0
  let writesAfterPush = 0
  for (const event of events) {
    if (isPush(event)) pushes += 1
    if (event.type !== 'assistant') continue
    for (const block of event.message?.content ?? []) {
      if (block?.type !== 'tool_use') continue
      toolSequence.push(block.name)
      toolCalls[block.name] = (toolCalls[block.name] ?? 0) + 1
      if (WRITE_TOOLS.includes(block.name)) {
        writes += 1
        // The push of THIS write fires after its `tool_use` and lands after its result, so a
        // write counts as "after a push" only when a push is already behind it.
        if (pushes > 0) writesAfterPush += 1
      }
    }
  }
  return { result, toolCalls, toolSequence, writes, pushes, writesAfterPush }
}

/**
 * What a cell's stdout is, in the format the cell asked for.
 *
 * `json` is one result message and no interactions: the columns that depend on them are `null`,
 * which says "this capture could not know", and not `0`, which would say "nothing happened".
 */
export function readAgentOutput(stdout, outputFormat) {
  if (outputFormat === 'stream-json') {
    const seen = readStream(stdout)
    if (!seen.result) throw new Error('the stream ended with no result event')
    return { result: seen.result, interactions: seen }
  }
  return { result: JSON.parse(stdout ?? ''), interactions: null }
}
