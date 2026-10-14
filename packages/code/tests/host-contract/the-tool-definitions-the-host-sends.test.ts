/**
 * WHAT CLAUDE CODE SENDS OF THE PLUGIN'S TOOLS, read off the request it sends the stand-in: it
 * sends the whole definition of every one of the 27, in the request, whether or not the model
 * will ever call one.
 *
 * The plugin is loaded, the stand-in answers with a closing text, and the first request that
 * offers a tool list is read. The entries named `mcp__plugin_mnema_mnema__*` are counted as the
 * host wrote them (`support/the-tool-definitions.ts`): the bytes of each entry and its `o200k_base`
 * tokens. The two figures below are the ones of the binary this run was started for; a host that
 * changes how it wraps a definition, or a server that gains a tool or a word of one, turns this
 * red, and the diff to the figure is the cost.
 *
 * WHAT IS HELD: that, in this binary, in a `-p` run, the definitions are in the request, whole,
 * and what they weigh. NOT HELD: that an interactive session pays the same. The host can defer
 * its MCP tools behind a search when they are many; whether and when it does is the host's, and
 * this run (a single prompt, no screen) is the one the contract can start.
 */

import { describe, expect, it } from 'vitest';
import { aHostForEachCase } from './support/the-host.js';
import {
  theEntriesOf,
  theFirstThatOffersTools,
  theServersTools,
} from './support/the-tool-definitions.js';

describe("what Claude Code sends of the plugin's tools", () => {
  const start = aHostForEachCase();

  it('sends the whole definition of all 27 in the request, and they weigh this much', async () => {
    const session = await start({});
    const request = theFirstThatOffersTools(session.messages);
    const entries = theEntriesOf(request?.body['tools']);
    const mine = theServersTools(entries, 'mcp__plugin_mnema_mnema__');

    // Whole: a description and an input schema on every one, not a name to be searched for.
    for (const entry of entries.filter((one) => String(one['name']).startsWith('mcp__'))) {
      expect(String(entry['description']).length, String(entry['name'])).toBeGreaterThan(40);
      expect(entry['input_schema'], String(entry['name'])).toBeTypeOf('object');
    }
    expect({ count: mine.names.length, ...mine.all }).toEqual({
      count: 27,
      bytes: 50_050,
      tokens: 11_352,
    });
  }, 120_000);
});
