/**
 * WHAT CODEX HANDS A HOOK ON STDIN before a patch is applied, read where the plugin's handler
 * passes it on: the shim of the sandbox keeps, byte for byte, what reaches `mnema before-a-write`.
 * The method and its limits are those of `what-the-host-hands-the-hook.copilot.test.ts`.
 *
 * What the product reads of it: `tool_name`, and `tool_input.command`, which is the patch.
 */

import { describe, expect, it } from 'vitest';
import { thePayloadsKept } from './support/a-sandbox.js';
import { aCodexForEachCase, aPatchAdding } from './support/the-codex.js';
import { theOnlyPayloadOf, theShapeOf } from './support/the-shape-of-a-payload.js';

describe('what Codex hands the hook it runs before a patch', () => {
  const start = aCodexForEachCase();

  it('hands the event, the tool and the patch under `command`, and the fields it keeps beside them', async () => {
    const session = await start({
      project: (it) => it.keepThePayloads(),
      patch: aPatchAdding('src/free/a.ts'),
    });
    const { payload } = theOnlyPayloadOf(thePayloadsKept(session.project), 'before-a-write');

    expect(payload['hook_event_name']).toBe('PreToolUse');
    expect(payload['tool_name']).toBe('apply_patch');
    expect(theShapeOf(payload)).toEqual({
      fields: [
        'cwd',
        'hook_event_name',
        'model',
        'permission_mode',
        'session_id',
        'tool_input',
        'tool_name',
        'tool_use_id',
        'transcript_path',
        'turn_id',
      ],
      input: ['command'],
    });
    expect((payload['tool_input'] as { command: string }).command).toContain(
      '*** Add File: src/free/a.ts',
    );
  }, 180_000);
});
