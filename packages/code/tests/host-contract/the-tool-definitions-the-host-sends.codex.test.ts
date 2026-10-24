/**
 * WHAT CODEX SENDS OF THE PLUGIN'S TOOLS, read off the request it sends the stand-in: none of
 * the 27 definitions is in the request. Codex defers the tools of an MCP server behind one
 * `tool_search` entry, whose description lists the server; the request carries that entry, and a
 * model that wants a tool searches first.
 *
 * The method and its limits are those of `the-tool-definitions-the-host-sends.test.ts`. The
 * second case makes the stand-in ask the search for something, and reads what comes back in the
 * request that follows: the namespace of the server, its instructions once, and the definitions
 * the search ranked first. WHAT IS HELD: that, for these two queries, in a `exec` run of this
 * binary, the search returns that many definitions and they weigh this much. NOT HELD: what a
 * model's own query would match; the queries are the case's, and a different one returns other
 * tools (always the same number of them, here).
 */

import { describe, expect, it } from 'vitest';
import { aCodexForEachCase, theResultOfTheSearch } from './support/the-codex.js';
import {
  theEntriesOf,
  theFirstThatOffersTools,
  theServersTools,
  weigh,
} from './support/the-tool-definitions.js';

describe("what Codex sends of the plugin's tools", () => {
  const start = aCodexForEachCase();

  it('sends none of the 27 definitions, and sends the search entry that reaches them', async () => {
    const session = await start({});
    const entries = theEntriesOf(theFirstThatOffersTools(session.requests)?.body['tools']);
    const named = (prefix: string) => theServersTools(entries, prefix).names;
    const search = entries.find((entry) => entry['type'] === 'tool_search');

    // The host did offer its own tools, so an absence of the plugin's is not a request with none.
    expect(entries.map((entry) => entry['name']).filter(Boolean)).toContain('exec_command');
    expect(named('mnema')).toEqual([]);
    expect(named('mcp__mnema')).toEqual([]);
    expect(String(search?.['description'])).toContain('- mnema:');
    expect(weigh(JSON.stringify(search))).toEqual({ bytes: 2_866, tokens: 678 });
  }, 180_000);

  it('returns, for a query, one namespace of the definitions it ranked first, and they weigh this much', async () => {
    const queries = ['record a decision', 'read what the last session left'];
    const measured: Record<string, unknown> = {};
    for (const query of queries) {
      const session = await start({ search: query });
      const result = theResultOfTheSearch(session);
      const namespaces = theEntriesOf(result?.['tools']);
      // One namespace, the server's, holding its instructions once and then the tools.
      expect(namespaces.map((one) => one['name'])).toEqual(['mcp__mnema']);
      const tools = theEntriesOf(namespaces[0]?.['tools']);
      expect(tools.length).toBeGreaterThan(0);
      for (const tool of tools) {
        expect(String(tool['description']).length, String(tool['name'])).toBeGreaterThan(40);
      }
      measured[query] = {
        tools: tools.map((tool) => tool['name']),
        namespace: weigh(JSON.stringify(namespaces[0])),
      };
    }
    await expect(`${JSON.stringify(measured, null, 2)}\n`).toMatchFileSnapshot(
      './weights/codex-tool-search.json',
    );
  }, 360_000);
});
