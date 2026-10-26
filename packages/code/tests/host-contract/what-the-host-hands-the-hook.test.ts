/**
 * WHAT CLAUDE CODE HANDS A HOOK ON STDIN after a file is written, read where the plugin's handler
 * passes it on: the shim of the sandbox keeps, byte for byte, what reaches `mnema after-a-write`.
 * The method and its limits are those of `what-the-host-hands-the-hook.copilot.test.ts`.
 *
 * The gate before an edit is not here: Claude Code runs it as a call into the MCP server
 * (`type: "mcp_tool"`), which has no stdin to read; the input it hands is `{path}` from
 * `${tool_input.file_path}`, and `the-rules-arrive-beside-the-write.test.ts` holds that it arrives.
 *
 * What the product reads of it: `hook_event_name`, `tool_name`, `tool_input.file_path`, the
 * `content` or `new_string` under it, and `transcript_path`.
 */

import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { thePayloadsKept } from './support/a-sandbox.js';
import { aHostForEachCase } from './support/the-host.js';
import { theOnlyPayloadOf, theShapeOf } from './support/the-shape-of-a-payload.js';

describe('what Claude Code hands the hook it runs after a write', () => {
  const start = aHostForEachCase();

  it('hands the event, the tool `Write`, the file under `file_path` and the transcript', async () => {
    const session = await start({
      project: (it) => it.keepThePayloads(),
      call: (project) => ({
        tool: 'Write',
        input: {
          // A note of the host's own memory is what the hook is filtered to pass on.
          file_path: join(
            dirname(project),
            'claude-config',
            'projects',
            project.replace(/[^a-zA-Z0-9]/g, '-'),
            'memory',
            'feedback_build.md',
          ),
          content: '---\nname: Builds use pnpm\ntype: feedback\n---\nThe build runs with pnpm.\n',
        },
      }),
    });
    const { payload } = theOnlyPayloadOf(thePayloadsKept(session.project), 'after-a-write');

    expect(payload['hook_event_name']).toBe('PostToolUse');
    expect(payload['tool_name']).toBe('Write');
    expect(typeof payload['transcript_path']).toBe('string');
    expect(theShapeOf(payload)).toEqual({
      fields: [
        'cwd',
        'duration_ms',
        'hook_event_name',
        'permission_mode',
        'prompt_id',
        'session_id',
        'tool_input',
        'tool_name',
        'tool_response',
        'tool_use_id',
        'transcript_path',
      ],
      input: ['content', 'file_path'],
    });
  }, 120_000);
});
