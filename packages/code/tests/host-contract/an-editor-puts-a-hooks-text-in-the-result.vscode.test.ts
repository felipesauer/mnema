/**
 * AN EDITOR PUTS A HOOK'S TEXT INSIDE THE RESULT OF THE TOOL, in the real VS Code: a command hook
 * that lets the call run and says something has what it said arrive in the result of that tool,
 * wrapped in `<PreToolUse-context>`, in the request the editor makes of the model next.
 *
 * WHAT IS HELD HERE AND WHAT IS NOT. This is a fact about the editor and not about the plugin: the
 * hook is the case's own, a command that says `allow` and a marker text, so what is read is where
 * the editor puts a hook's words and how it marks them. The plugin's own command says something to
 * the editor only to ask or to refuse, which is read in `an-editor-holds-or-refuses-the-write`.
 * NOT HELD: that the model reads the text, or that another version of the editor wraps it the same.
 */

import { describe, expect, it } from 'vitest';
import {
  A_HOOK_THAT_ALLOWS_AND_SAYS,
  anEditorForEachCase,
  theResultTheModelWasHanded,
} from './support/the-vscode.js';

const MARKER = 'A TEXT A HOOK SAID, 7Q2';

describe("an editor puts a hook's text inside the result", () => {
  const start = anEditorForEachCase();

  it('hands the text to the model in the result of the tool, in a block the editor names', async () => {
    const session = await start({
      plugin: false,
      target: 'notes.txt',
      hookFiles: {
        says: {
          hooks: {
            PreToolUse: [
              {
                type: 'command',
                command: `node "${A_HOOK_THAT_ALLOWS_AND_SAYS}" "${MARKER}"`,
              },
            ],
          },
        },
      },
    });
    expect(session.written).toBe(true);
    const handed = theResultTheModelWasHanded(session);
    expect(handed).toContain(MARKER);
    expect(handed).toMatch(
      /<PreToolUse-context>[\s\S]*A TEXT A HOOK SAID, 7Q2[\s\S]*<\/PreToolUse-context>/,
    );
  }, 240_000);
});
