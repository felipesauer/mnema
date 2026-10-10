/**
 * VS CODE'S AGENT, IN THIS CONTRACT, SHOWS NO HANDSHAKE OF THE PLUGIN'S MCP SERVER — so there is
 * nothing of what it hands a server to read here, and this says so by value rather than by silence.
 *
 * The editor is run the way every case of this directory runs it: the plugin listed in
 * `chat.pluginLocations`, a stand-in extension for the model, nobody at the screen. Its hooks
 * run (that is what the other files here read); of the server the plugin declares, no report is
 * written and none of its tools is offered. Here `mnema mcp` is replaced by a server that writes
 * down what it was handed, and it wrote nothing, and none of its tools reaches the model.
 *
 * NOT HELD: why. A confirmation to trust a server that nobody answers would look the same, and
 * so would a plugin whose servers the agent does not read. A page may not say "VS Code hands a
 * server X" on the strength of this file: it says "not measured", and this goes red the day
 * a handshake arrives, which is the day to measure it.
 */

import { describe, expect, it } from 'vitest';
import { theServerWasHanded } from './support/a-sandbox.js';
import { anEditorForEachCase } from './support/the-vscode.js';

describe("what VS Code's agent hands the server it starts", () => {
  const start = anEditorForEachCase();

  it("sees no handshake of the plugin's server in this contract, and is offered none of its tools", async () => {
    const session = await start({
      project: (it) => it.measureTheServer(),
      target: 'src/anywhere/file.ts',
    });
    const offered = session.requests[0]?.tools ?? [];

    // The editor did offer its own tools, so an empty list is not an editor that said nothing.
    expect(offered).toContain('create_file');
    expect(offered.filter((name) => /mnema/i.test(name))).toEqual([]);
    expect(() => theServerWasHanded(session.project)).toThrow(/wrote no report/);
  }, 240_000);
});
