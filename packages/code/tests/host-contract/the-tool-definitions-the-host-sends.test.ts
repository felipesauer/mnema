/**
 * WHAT CLAUDE CODE SENDS OF THE PLUGIN'S TOOLS WHEN TOOL SEARCH IS OFF, read off the request it
 * sends the stand-in: it sends the whole definition of every one of the 27, in the request,
 * whether or not the model will ever call one. The case switches tool search off
 * (`ENABLE_TOOL_SEARCH=false`) so that it holds for any version: from 2.1.304 the host defers MCP
 * tools by itself, and `the-tool-definitions-the-host-defers.test.ts` holds that, and what a
 * deferred definition costs once it is loaded.
 *
 * The plugin is loaded, the stand-in answers with a closing text, and the first request that
 * offers a tool list is read. The entries named `mcp__plugin_mnema_mnema__*` are counted as the
 * host wrote them (`support/the-tool-definitions.ts`): the bytes of each entry and its `o200k_base`
 * tokens. The two figures below are the ones of the binary this run was started for; a host that
 * changes how it wraps a definition, or a server that gains a tool or a word of one, turns this
 * red, and the diff to the figure is the cost.
 *
 * WHAT IS HELD: that, in this binary, in a `-p` run with tool search off, the definitions are in
 * the request, whole, and what they weigh. NOT HELD: what an interactive session sends; that is
 * the host's to decide, and this run (a single prompt, no screen) is the one the contract can
 * start.
 */

import { describe, expect, it } from 'vitest';
import { aHostForEachCase } from './support/the-host.js';
import {
  theEntriesOf,
  theFirstThatOffersTools,
  theServersTools,
  theWeightsFile,
} from './support/the-tool-definitions.js';

describe("what Claude Code sends of the plugin's tools", () => {
  const start = aHostForEachCase();

  it('sends the whole definition of all 27 in the request, and they weigh this much', async () => {
    const session = await start({ env: { ENABLE_TOOL_SEARCH: 'false' } });
    const request = theFirstThatOffersTools(session.messages);
    const entries = theEntriesOf(request?.body['tools']);
    const mine = theServersTools(entries, 'mcp__plugin_mnema_mnema__');

    // Whole: a description and an input schema on every one, not a name to be searched for.
    for (const entry of entries.filter((one) => String(one['name']).startsWith('mcp__'))) {
      expect(String(entry['description']).length, String(entry['name'])).toBeGreaterThan(40);
      expect(entry['input_schema'], String(entry['name'])).toBeTypeOf('object');
    }
    expect(mine.names).toHaveLength(27);
    await expect(theWeightsFile(mine.all)).toMatchFileSnapshot('./weights/claude-code.json');
  }, 120_000);
});
