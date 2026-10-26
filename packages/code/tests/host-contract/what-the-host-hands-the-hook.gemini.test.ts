/**
 * WHAT GEMINI CLI HANDS A HOOK ON STDIN before a file is written, read where the extension's
 * handler passes it on: the shim of the sandbox keeps, byte for byte, what reaches `mnema
 * before-a-write`. The method and its limits are those of `what-the-host-hands-the-hook.copilot.test.ts`.
 *
 * What the product reads of it: `tool_name`, and `tool_input.file_path`.
 */

import { describe, expect, it } from 'vitest';
import { thePayloadsKept } from './support/a-sandbox.js';
import { theOnlyPayloadOf, theShapeOf } from './support/the-shape-of-a-payload.js';
import { aGeminiForEachCase, replacing, writing } from './support/the-gemini.js';

describe('what Gemini CLI hands the hook it runs before a write', () => {
  const start = aGeminiForEachCase();
  const FIELDS = [
    'cwd',
    'hook_event_name',
    'session_id',
    'timestamp',
    'tool_input',
    'tool_name',
    'transcript_path',
  ];

  it('`write_file`: the event `BeforeTool`, and the file under `file_path`', async () => {
    const session = await start({
      project: (it) => it.keepThePayloads(),
      call: writing('src/free/a.ts'),
    });
    const { payload } = theOnlyPayloadOf(thePayloadsKept(session.project), 'before-a-write');

    expect(payload['hook_event_name']).toBe('BeforeTool');
    expect(payload['tool_name']).toBe('write_file');
    expect(theShapeOf(payload)).toEqual({ fields: FIELDS, input: ['content', 'file_path'] });
  }, 180_000);

  it('`replace`: the file under `file_path`, beside the text it changes', async () => {
    const session = await start({
      project: (it) => it.keepThePayloads(),
      call: replacing('src/free/a.ts', 'a', 'b'),
    });
    const { payload } = theOnlyPayloadOf(thePayloadsKept(session.project), 'before-a-write');

    expect(payload['tool_name']).toBe('replace');
    expect(theShapeOf(payload)).toEqual({
      fields: FIELDS,
      input: ['file_path', 'instruction', 'new_string', 'old_string'],
    });
  }, 180_000);
});
