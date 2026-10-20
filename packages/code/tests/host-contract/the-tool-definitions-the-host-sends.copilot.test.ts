/**
 * WHAT THE COPILOT CLI SENDS OF THE PLUGIN'S TOOLS, read off the request it sends the
 * stand-in: the whole definition of every one of the 27, in the request, named `mnema-<tool>`.
 * The method and its limits are those of `the-tool-definitions-the-host-sends.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { aCopilotForEachCase } from './support/the-copilot.js';
import {
  theEntriesOf,
  theFirstThatOffersTools,
  theServersTools,
} from './support/the-tool-definitions.js';

describe("what the Copilot CLI sends of the plugin's tools", () => {
  const start = aCopilotForEachCase();

  it('sends the whole definition of all 27 in the request, and they weigh this much', async () => {
    const session = await start({});
    const entries = theEntriesOf(theFirstThatOffersTools(session.requests)?.body['tools']);
    const mine = theServersTools(entries, 'mnema-');

    for (const entry of entries.filter((one) => String(one['name']).startsWith('mnema-'))) {
      expect(String(entry['description']).length, String(entry['name'])).toBeGreaterThan(40);
      expect(entry['input_schema'], String(entry['name'])).toBeTypeOf('object');
    }
    expect({ count: mine.names.length, ...mine.all }).toEqual({
      count: 27,
      bytes: 50_040,
      tokens: 11_524,
    });
  }, 180_000);
});
