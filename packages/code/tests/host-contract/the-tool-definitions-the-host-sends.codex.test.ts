/**
 * WHAT CODEX CHARGES FOR THE PLUGIN'S TOOLS, read off the request it sends the stand-in: none of
 * the 27 definitions is in the request. Codex defers the tools of an MCP server behind one
 * `tool_search` entry, whose description lists the server and the instructions its handshake
 * gave; what the request pays is that entry, and a model that wants a tool pays a search first.
 *
 * The method and its limits are those of `the-tool-definitions-the-host-sends.test.ts`. NOT
 * MEASURED: what the search returns for a tool, and so what a definition costs once it is
 * loaded: that takes a second request after a search the stand-in would have to make.
 */

import { describe, expect, it } from 'vitest';
import { aCodexForEachCase } from './support/the-codex.js';
import {
  theEntriesOf,
  theFirstThatOffersTools,
  theServersTools,
  weigh,
} from './support/the-tool-definitions.js';

describe("what Codex charges for the plugin's tools", () => {
  const start = aCodexForEachCase();

  it('sends none of the 27 definitions, and charges for the search entry that reaches them', async () => {
    const session = await start({});
    const entries = theEntriesOf(theFirstThatOffersTools(session.requests)?.body['tools']);
    const named = (prefix: string) => theServersTools(entries, prefix).names;
    const search = entries.find((entry) => entry['type'] === 'tool_search');

    // The host did offer its own tools, so an absence of the plugin's is not a request with none.
    expect(entries.map((entry) => entry['name']).filter(Boolean)).toContain('exec_command');
    expect(named('mnema')).toEqual([]);
    expect(named('mcp__mnema')).toEqual([]);
    expect(String(search?.['description'])).toContain('- mnema:');
    expect(weigh(JSON.stringify(search))).toEqual({ bytes: 2_891, tokens: 672 });
  }, 180_000);
});
