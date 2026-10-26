/**
 * WHAT THE COPILOT CLI HANDS A HOOK ON STDIN before a file is written, read where the plugin's
 * handler passes it on: the shim of the sandbox keeps, byte for byte, what reaches `mnema
 * before-a-write`, and the shape is read by field NAME only, never by value.
 *
 * WHAT IS HELD AND WHAT IS NOT. That, in the version the run names, the payload of the hook for a
 * write carries the fields the product reads, under the names it reads them by; and that nothing
 * else is relied on: a field the host adds goes red here, which is the day to look at whether
 * the product should read it. NOT HELD: the payload of any other event (the hook that opens a
 * session is not measured here, and its handlers read `session_id` or `cwd` from it, and no case here makes the host's question tool run without a person), and
 * that the host sends the same fields in another version.
 *
 * What the product reads of it: `tool_name`, and under `tool_input` the `path` of `Write`, and for
 * `Edit` either a `path` or the patch, which arrives as a string.
 */

import { describe, expect, it } from 'vitest';
import { thePayloadsKept } from './support/a-sandbox.js';
import { aCopilotForEachCase, creating, patching } from './support/the-copilot.js';
import { theOnlyPayloadOf, theShapeOf } from './support/the-shape-of-a-payload.js';

describe('what the Copilot CLI hands the hook it runs before a write', () => {
  const start = aCopilotForEachCase();

  it('`create`: the event, the tool `Write`, and the file under `path`', async () => {
    const session = await start({
      project: (it) => it.keepThePayloads(),
      call: creating('src/free/a.ts'),
    });
    const { payload } = theOnlyPayloadOf(thePayloadsKept(session.project), 'before-a-write');

    expect(payload['hook_event_name']).toBe('PreToolUse');
    expect(payload['tool_name']).toBe('Write');
    expect(theShapeOf(payload)).toEqual({
      fields: ['cwd', 'hook_event_name', 'session_id', 'timestamp', 'tool_input', 'tool_name'],
      input: ['file_text', 'path'],
    });
  }, 180_000);

  it('`apply_patch`: the tool `Edit`, and the patch itself as a string', async () => {
    const session = await start({
      project: (it) => it.keepThePayloads(),
      model: 'gpt-5.1-codex',
      call: patching('src/free/a.ts'),
    });
    const { payload } = theOnlyPayloadOf(thePayloadsKept(session.project), 'before-a-write');

    expect(payload['tool_name']).toBe('Edit');
    expect(theShapeOf(payload)).toEqual({
      fields: ['cwd', 'hook_event_name', 'session_id', 'timestamp', 'tool_input', 'tool_name'],
      input: 'string',
    });
  }, 180_000);
});
