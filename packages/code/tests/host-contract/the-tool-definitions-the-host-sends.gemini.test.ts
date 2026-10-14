/**
 * WHAT GEMINI CLI SENDS OF THE PLUGIN'S TOOLS, read off the request it sends the stand-in: the
 * whole definition of every one of the 27, in the request, inside the one `functionDeclarations`
 * list, named `mcp_mnema_<tool>`. The method and its limits are those of
 * `the-tool-definitions-the-host-sends.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { aGeminiForEachCase } from './support/the-gemini.js';
import {
  theEntriesOf,
  theFirstThatOffersTools,
  theServersTools,
} from './support/the-tool-definitions.js';

/** The declarations of the first tool group, where Gemini CLI puts every function. */
function declarationsOf(body: Readonly<Record<string, unknown>>): unknown {
  const groups = theEntriesOf(body['tools']);
  return groups.flatMap((group) => theEntriesOf(group['functionDeclarations']));
}

describe("what Gemini CLI sends of the plugin's tools", () => {
  const start = aGeminiForEachCase();

  it('sends the whole definition of all 27 in the request, and they weigh this much', async () => {
    const session = await start({});
    const request = theFirstThatOffersTools(session.requests, declarationsOf);
    const entries = theEntriesOf(declarationsOf(request?.body ?? {}));
    const mine = theServersTools(entries, 'mcp_mnema_');

    for (const entry of entries.filter((one) => String(one['name']).startsWith('mcp_mnema_'))) {
      expect(String(entry['description']).length, String(entry['name'])).toBeGreaterThan(40);
      expect(entry['parametersJsonSchema'], String(entry['name'])).toBeTypeOf('object');
    }
    expect({ count: mine.names.length, ...mine.all }).toEqual({
      count: 27,
      bytes: 56_876,
      tokens: 12_683,
    });
  }, 180_000);
});
