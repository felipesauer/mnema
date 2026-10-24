/**
 * WHAT CLAUDE CODE SENDS OF THE PLUGIN'S TOOLS WHEN IT DEFERS THEM, read off the requests it sends
 * the stand-in. With tool search on, the first request carries none of the 27 definitions: it
 * lists their names in a `<system-reminder>` of the first message, offers one `ToolSearch` tool,
 * and a model that wants a tool asks that tool for it. The request that follows the search then
 * carries the definitions the search loaded, in `tools`, each as the host wrote it, and the search's
 * own answer is a list of `tool_reference` blocks, not the definitions.
 *
 * The stand-in plays the model that asks: the same method as the other cases of this directory
 * (`support/the-stand-in-api.ts` makes the one call the case names), against the same binary.
 *
 * WHEN THE HOST DEFERS ON ITS OWN is also held, by the version the run was started for: the first
 * request of a run that sets nothing carries the 27 definitions before 2.1.304 and none from it on.
 * The vendor's page says the same ("Configure tool search"); this is the binary's answer.
 *
 * WHAT IS HELD: that, in a `-p` run of this binary, the names, the search tool and the loaded
 * definitions weigh this much. NOT HELD: what an interactive session sends, which is the host's to
 * decide and which a single prompt with no screen cannot start; and which tools a model's own
 * query would load (the keyword query here is the case's).
 */

import { describe, expect, it } from 'vitest';
import { aHostForEachCase, theHostUnderTest } from './support/the-host.js';
import {
  atLeast,
  theEntriesOf,
  theFirstThatOffersTools,
  theNamesListedAsDeferred,
  theServersTools,
  theToolResultsOf,
  weigh,
} from './support/the-tool-definitions.js';

const PREFIX = 'mcp__plugin_mnema_mnema__';

/** The first version of the host that defers its MCP tools without being told to. */
const DEFERS_BY_ITSELF_FROM = '2.1.304';

describe("what Claude Code sends of the plugin's tools when it defers them", () => {
  const start = aHostForEachCase();

  it('lists the names of the 27, offers a search tool, and the search loads definitions that weigh this much', async () => {
    const on = { ENABLE_TOOL_SEARCH: 'true' };
    const opening = await start({ env: on });
    const first = theFirstThatOffersTools(opening.messages);
    const entries = theEntriesOf(first?.body['tools']);
    const names = theNamesListedAsDeferred(first?.body ?? {}, PREFIX);
    const searchTool = entries.find((entry) => entry['name'] === 'ToolSearch');

    // Names, not definitions: none of the 27 is in `tools`, all 27 are listed, and a way to ask.
    expect(theServersTools(entries, PREFIX).names).toEqual([]);
    expect(names).toHaveLength(27);
    expect(searchTool).toBeDefined();

    const searched = async (query: string, max: number) => {
      const session = await start({
        env: on,
        call: () => ({ tool: 'ToolSearch', input: { query, max_results: max } }),
      });
      const after = session.theRequestAfterTheCall;
      const loaded = theServersTools(theEntriesOf(after?.body['tools']), PREFIX);
      const results = theToolResultsOf(after?.body ?? {});
      expect(results).toHaveLength(1);
      // What comes back is a reference per tool; the definition is in `tools` from then on.
      expect(JSON.stringify(results[0])).toContain('tool_reference');
      expect(JSON.stringify(results[0])).not.toContain('input_schema');
      return {
        tools: loaded.names.map((name) => name.slice(PREFIX.length)),
        definitions: loaded.all,
        answer: weigh(JSON.stringify(results[0])),
      };
    };

    const measured = {
      listedNames: weigh(names.join('\n')),
      searchTool: weigh(JSON.stringify(searchTool)),
      oneTool: await searched(`select:${PREFIX}record_decision`, 5),
      keywordQuery: await searched('record a decision', 5),
      allTwentySeven: await searched(`select:${names.join(',')}`, 30),
    };
    expect(measured.oneTool.tools).toEqual(['record_decision']);
    expect(measured.allTwentySeven.tools).toHaveLength(27);
    await expect(`${JSON.stringify(measured, null, 2)}\n`).toMatchFileSnapshot(
      './weights/claude-code-tool-search.json',
    );
  }, 300_000);

  it('defers by itself from 2.1.304 and sends the 27 whole before', async () => {
    const { version } = theHostUnderTest();
    const session = await start({});
    const entries = theEntriesOf(theFirstThatOffersTools(session.messages)?.body['tools']);
    const inTools = theServersTools(entries, PREFIX).names.length;
    const listed = theNamesListedAsDeferred(
      theFirstThatOffersTools(session.messages)?.body ?? {},
      PREFIX,
    ).length;

    expect({ inTools, listed }, version).toEqual(
      atLeast(version, DEFERS_BY_ITSELF_FROM)
        ? { inTools: 0, listed: 27 }
        : { inTools: 27, listed: 0 },
    );
  }, 120_000);
});
