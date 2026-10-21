/**
 * A NOTE OF THE HOST'S MEMORY IS COPIED, in the real host: where `host-memory-mirror` is switched on,
 * the host's own write of a note into its memory directory runs the plugin's `PostToolUse` hook, the
 * note lands in the project's private tree, and the line naming the memory reaches the model with the
 * result of that write; a write anywhere else in the project adds nothing.
 *
 * WHAT IS HELD HERE AND WHAT IS NOT. The product's half (which file is a note, what is copied, once
 * per content) is `what-a-write-means-to-the-record.test.ts`. What it cannot say is that this host runs
 * the hooks file's shell as written (the path read out of the payload by the shell itself) and hands
 * the reply to the model. That is read here with a stand-in for the model; the memory directory is the
 * one under the `CLAUDE_CONFIG_DIR` the host is started with. The write to the project is the control.
 *
 * WHERE THE LINE LANDS, AS READ ON 2.1.281: inside the `tool_result` of the write, after its text, as a
 * `<system-reminder>` naming `PostToolUse:Write`, and not as a block of its own beside it.
 *
 * NOT HELD: that the host's own memory feature writes there; the stand-in writes the file itself.
 */

import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aHostForEachCase, theResultOfTheCall } from './support/the-host.js';
import { writeTo } from './support/the-stand-in-api.js';

const NOTE =
  '---\nname: Builds use pnpm\ntype: feedback\n---\nThe build runs with pnpm, never npm.\n';

/** What the host says a `PostToolUse` hook on the write added, inside the result. */
const ADDED = '<system-reminder>\nPostToolUse:Write hook additional context:';

describe('a note of the host’s memory is copied', () => {
  const start = aHostForEachCase();

  it('copies a note written into the memory directory, and the line reaches the model with the result', async () => {
    const session = await start({
      project: (project) => {
        project.mnema('switch', 'on', 'host-memory-mirror');
      },
      call: (project) => ({
        tool: 'Write',
        input: {
          // The host is started with `CLAUDE_CONFIG_DIR` beside the project (`support/the-host.ts`).
          file_path: join(
            dirname(project),
            'claude-config',
            'projects',
            project.replace(/[^a-zA-Z0-9]/g, '-'),
            'memory',
            'feedback_build.md',
          ),
          content: NOTE,
        },
      }),
    });
    const result = theResultOfTheCall(session)?.text ?? '';
    expect(result).toContain(
      `${ADDED} This note of the host’s memory, feedback_build.md, was copied`,
    );
    // The host stamps a note written into this project's memory directory (2.1.281 turned the name
    // into `builds-use-pnpm`), so what is held is where the copy landed and the file it came from.
    expect(session.mnema('search', 'pnpm')).toMatch(/ private .*\[host memory feedback_build\.md/);
  }, 120_000);

  it('adds nothing to a write elsewhere in the project', async () => {
    const session = await start({
      project: (project) => {
        project.mnema('switch', 'on', 'host-memory-mirror');
      },
      call: writeTo('src/notes.ts'),
    });
    const result = theResultOfTheCall(session);
    expect(result?.isError).toBe(false);
    expect(result?.text).not.toContain(ADDED);
  }, 120_000);
});
