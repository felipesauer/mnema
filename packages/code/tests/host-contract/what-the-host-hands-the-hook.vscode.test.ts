/**
 * WHAT VS CODE'S AGENT HANDS A HOOK ON STDIN before a file is created, read where the plugin's
 * handler passes it on: the shim of the sandbox keeps, byte for byte, what reaches `mnema
 * before-a-write`. The method and its limits are those of `what-the-host-hands-the-hook.copilot.test.ts`.
 *
 * What the product reads of it: `tool_name`, and under `tool_input` the `filePath` of
 * `create_file`.
 */

import { describe, expect, it } from 'vitest';
import { thePayloadsKept } from './support/a-sandbox.js';
import { theOnlyPayloadOf, theShapeOf } from './support/the-shape-of-a-payload.js';
import { anEditorForEachCase } from './support/the-vscode.js';

describe("what VS Code's agent hands the hook it runs before a file is created", () => {
  const start = anEditorForEachCase();

  it('hands the event, the tool `create_file` and the file under `filePath`', async () => {
    const session = await start({
      project: (it) => it.keepThePayloads(),
      target: 'src/free/a.ts',
    });
    const { payload } = theOnlyPayloadOf(thePayloadsKept(session.project), 'before-a-write');

    expect(payload['hook_event_name']).toBe('PreToolUse');
    expect(payload['tool_name']).toBe('create_file');
    expect(theShapeOf(payload)).toEqual({
      fields: [
        'cwd',
        'hook_event_name',
        'session_id',
        'timestamp',
        'tool_input',
        'tool_name',
        'tool_use_id',
        'transcript_path',
      ],
      input: ['content', 'filePath'],
    });
  }, 240_000);
});
