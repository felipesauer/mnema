// The path a session took — read from the vendor's event stream, and from the real host's.
//
// Two kinds of case, because the parser can be wrong in two different ways. Lines built by hand
// pin the arithmetic (what counts as a write, a push, a write AFTER a push). Lines that the real
// host printed, with a stand-in where the model would be, pin the one thing hand-built lines
// cannot: that the shape the parser reads is the shape the vendor writes, and that the per-edit
// hook is in the stream at all.

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { carriesDecision, listFixtures } from '../lib/fixtures.mjs'
import { WRITE_TOOLS, readAgentOutput, readStream, streamEvents } from '../lib/interactions.mjs'
import { OUTPUT_FORMATS, OUTPUT_FORMAT_DEFAULT, claudeArgv } from '../lib/isolation.mjs'
import { outputFormatOf } from '../lib/split.mjs'
import { runAgainstStandIn } from '../lib/host-session.mjs'
import { productPluginDir } from '../lib/hook.mjs'
import { runCell, seededSandbox } from '../lib/cell.mjs'
import { createSandbox, removeInside, sandboxRoot } from '../lib/sandbox.mjs'
import { RESULT_SCHEMA } from '../lib/result.mjs'
import { FIXTURES_DIR, MNEMA_BIN, fakeAgent, vendorResult } from './helpers.mjs'

const CLAUDE = process.env.MNEMA_BENCH_CLAUDE || 'claude'
const axisA = listFixtures(FIXTURES_DIR).find((f) => carriesDecision(f.axis))
const opened = []
const scratch = []

after(() => {
  for (const sandbox of opened) sandbox.destroy()
  for (const dir of scratch) removeInside(sandboxRoot(), dir)
})

const jsonl = (events) => `${events.map((event) => JSON.stringify(event)).join('\n')}\n`
const call = (name) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `t-${name}`, name, input: {} }] } })
const push = (text = 'a rule addressed at this file') => ({
  type: 'system',
  subtype: 'hook_response',
  hook_event: 'PreToolUse',
  outcome: 'success',
  output: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } }),
})
const result = { type: 'result', subtype: 'success', is_error: false, num_turns: 3, total_cost_usd: 0.01 }

describe('the arithmetic, on lines built by hand', () => {
  test('counts every tool by name, keeps the order, and counts the ones that write', () => {
    const seen = readStream(jsonl([call('Read'), call('Edit'), call('Bash'), call('Write'), call('Read'), result]))
    assert.deepEqual(seen.toolCalls, { Read: 2, Edit: 1, Bash: 1, Write: 1 })
    assert.deepEqual(seen.toolSequence, ['Read', 'Edit', 'Bash', 'Write', 'Read'])
    assert.equal(seen.writes, 2)
    assert.deepEqual(WRITE_TOOLS, ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
  })

  test('a write is "after a push" only when a push is already behind it', () => {
    // write 1 fires the first push; write 2 and write 3 come after it.
    const seen = readStream(jsonl([call('Write'), push(), call('Write'), push(), call('Edit'), result]))
    assert.equal(seen.writes, 3)
    assert.equal(seen.pushes, 2)
    assert.equal(seen.writesAfterPush, 2)
  })

  test('one write, however many pushes, was never changed by the channel: no write after a push', () => {
    const seen = readStream(jsonl([call('Read'), call('Write'), push(), result]))
    assert.equal(seen.writes, 1)
    assert.equal(seen.pushes, 1)
    assert.equal(seen.writesAfterPush, 0)
  })

  test('a hook that answered with nothing, or failed, or was the opening hook, is not a push', () => {
    const empty = push('')
    const failed = { ...push(), outcome: 'error' }
    const opening = { ...push(), hook_event: 'SessionStart' }
    const seen = readStream(jsonl([empty, failed, opening, call('Write'), call('Write'), result]))
    assert.equal(seen.pushes, 0)
    assert.equal(seen.writesAfterPush, 0)
  })

  test('the result is the LAST result event', () => {
    const seen = readStream(jsonl([{ ...result, num_turns: 1 }, call('Read'), { ...result, num_turns: 9 }]))
    assert.equal(seen.result.num_turns, 9)
  })

  test('a line that is not JSON is the instrument saying so, with its line number', () => {
    assert.throws(() => streamEvents('{"type":"system"}\nnot json\n'), /stream line 2 is not JSON/)
  })
})

describe('what a capture can and cannot know', () => {
  test('`json` is one result message and no interactions — null, never zero', () => {
    const read = readAgentOutput(JSON.stringify(result), 'json')
    assert.equal(read.result.num_turns, 3)
    assert.equal(read.interactions, null)
  })

  test('`stream-json` returns the same result message plus the interactions', () => {
    const read = readAgentOutput(jsonl([call('Write'), result]), 'stream-json')
    assert.equal(read.result.num_turns, 3)
    assert.equal(read.interactions.writes, 1)
  })

  test('a stream that ends with no result is refused, not read as an empty session', () => {
    assert.throws(() => readAgentOutput(jsonl([call('Write')]), 'stream-json'), /no result event/)
  })
})

describe('the command line', () => {
  const base = { ticket: 't', settingsPath: '/nowhere/s.json', mcpPath: '/nowhere/m.json' }

  test('`json` is the default and adds nothing — the four spent arms keep their bytes', () => {
    assert.equal(OUTPUT_FORMAT_DEFAULT, 'json')
    const argv = claudeArgv(base)
    assert.equal(argv[argv.indexOf('--output-format') + 1], 'json')
    assert.equal(argv.includes('--verbose'), false)
    assert.equal(argv.includes('--include-hook-events'), false)
  })

  test('`stream-json` asks for the verbose stream and for the hook events, and nothing else changes', () => {
    const json = claudeArgv(base)
    const stream = claudeArgv({ ...base, outputFormat: 'stream-json' })
    assert.equal(stream[stream.indexOf('--output-format') + 1], 'stream-json')
    assert.deepEqual(
      stream.filter((a) => !json.includes(a)),
      ['stream-json', '--verbose', '--include-hook-events'],
    )
    assert.equal(stream.length, json.length + 2)
  })

  test('a format the harness does not know is refused by name', () => {
    assert.deepEqual(OUTPUT_FORMATS, ['json', 'stream-json'])
    assert.throws(() => claudeArgv({ ...base, outputFormat: 'text' }), /--output-format must be one of json, stream-json, not text/)
  })

  test('a round declares its format in the pre-registration, and a typo is refused rather than defaulted', () => {
    const dir = mkdtempSync(join(sandboxRoot(), 'mnema-bench-format-'))
    scratch.push(dir)
    const split = (extra) => {
      const path = join(dir, `split-${Object.keys(extra).length}-${JSON.stringify(extra).length}.json`)
      writeFileSync(path, JSON.stringify({ frozen_at: 'x', rule: 'x', pilot: 'p', development: ['p'], held_out: [], ...extra }))
      return { split: path }
    }
    assert.equal(outputFormatOf(split({})), 'json', 'a round that says nothing keeps the format it ran with')
    assert.equal(outputFormatOf(split({ output_format: 'stream-json' })), 'stream-json')
    assert.throws(() => outputFormatOf(split({ output_format: 'stream_json' })), /"output_format" is "stream_json"/)
  })
})

describe('the real host, with a stand-in where the model would be', () => {
  async function session(arm) {
    const sandbox = seededSandbox({ fixture: axisA, arm, mnemaBin: MNEMA_BIN, label: 'interactions' })
    opened.push(sandbox)
    const target = join(sandbox.repo, 'invoice.php')
    const out = await runAgainstStandIn({
      sandbox,
      arm,
      fixture: axisA,
      mnemaBin: MNEMA_BIN,
      pluginDir: productPluginDir(),
      claudeBin: CLAUDE,
      outputFormat: 'stream-json',
      script: [
        { name: 'Read', input: { file_path: target } },
        { name: 'Write', input: { file_path: target, content: '<?php // one\n' } },
        { name: 'Write', input: { file_path: target, content: '<?php // two\n' } },
      ],
    })
    assert.equal(out.status, 0, out.stderr)
    return readAgentOutput(out.stdout, 'stream-json')
  }

  test('the arm that pushes: two writes, two pushes, and the second write has a push behind it', async () => {
    const { interactions } = await session('mnema+')
    assert.deepEqual(interactions.toolSequence, ['Read', 'Write', 'Write'])
    assert.equal(interactions.writes, 2)
    assert.equal(interactions.pushes, 2, 'the per-edit hook is in the stream — if this is 0 the flag that asks for hook events stopped working')
    assert.equal(interactions.writesAfterPush, 1)
  })

  test('the arm with the same surface and the channel switched off: the same two writes, no push', async () => {
    const { interactions } = await session('mnema-doc')
    assert.equal(interactions.writes, 2)
    assert.equal(interactions.pushes, 0)
    assert.equal(interactions.writesAfterPush, 0)
  })

  test('an arm with no hooks at all: pushes is 0 and a result message is still there to be read', async () => {
    const read = await session('base')
    assert.equal(read.interactions.pushes, 0)
    assert.equal(read.result.subtype, 'success')
    assert.equal(typeof read.result.total_cost_usd, 'number')
  })
})

describe('and it reaches the line', () => {
  function lineFor(outputFormat, stdout) {
    const dir = mkdtempSync(join(sandboxRoot(), 'mnema-bench-line-'))
    scratch.push(dir)
    const claudeBin = fakeAgent(dir, { refDir: join(axisA.dir, 'refs/good'), stdout })
    return runCell({
      fixture: axisA,
      arm: 'base',
      run: 1,
      round: 5,
      claudeBin,
      mnemaBin: MNEMA_BIN,
      authMode: 'api-key',
      outDir: null,
      resultsPath: join(dir, 'cells.jsonl'),
      versions: { cli: 'fake', mnema: 'fake' },
      outputFormat,
    }).line
  }

  test('schema 9 carries the path of a stream-json cell', () => {
    const line = lineFor('stream-json', jsonl([call('Read'), call('Write'), push(), call('Write'), vendorResult()]))
    assert.equal(line.schema, RESULT_SCHEMA)
    assert.equal(RESULT_SCHEMA, 'mnema-bench/cell/11')
    assert.equal(line.status, 'ok', line.error)
    assert.equal(line.output_format, 'stream-json')
    assert.deepEqual(line.tool_calls, { Read: 1, Write: 2 })
    assert.deepEqual(line.tool_sequence, ['Read', 'Write', 'Write'])
    assert.equal(line.writes, 2)
    assert.equal(line.pushes, 1)
    assert.equal(line.writes_after_push, 1)
    assert.equal(line.cost_usd, 0.0123, 'the cost still comes from the vendor’s result message')
  })

  test('and a json cell says it could not know: the same columns, all null', () => {
    const line = lineFor('json', JSON.stringify(vendorResult()))
    assert.equal(line.output_format, 'json')
    for (const key of ['tool_calls', 'tool_sequence', 'writes', 'pushes', 'writes_after_push']) {
      assert.equal(line[key], null, key)
    }
  })

  test('a stream with no result is a harness error, never a cell with a verdict', () => {
    const line = lineFor('stream-json', jsonl([call('Write')]))
    assert.equal(line.status, 'harness_error')
    assert.match(line.error, /wrote no result JSON/)
  })
})
