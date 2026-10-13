/**
 * WHAT OPENCODE SENDS OF THE PLUGIN'S TOOLS, read off the request it sends the stand-in: the
 * whole definition of every one of the 27, in the request, named `mnema_<tool>`. Its first
 * request is a title preflight with no tool list; the first one that offers tools is the one
 * measured. The method and its limits are those of `the-tool-definitions-the-host-sends.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { anOpencodeForEachCase } from './support/the-opencode.js';
import {
  theEntriesOf,
  theFirstThatOffersTools,
  theServersTools,
} from './support/the-tool-definitions.js';

describe("what OpenCode sends of the plugin's tools", () => {
  const start = anOpencodeForEachCase();

  it('sends the whole definition of all 27 in the request, and they weigh this much', async () => {
    const session = await start({});
    const entries = theEntriesOf(theFirstThatOffersTools(session.requests)?.body['tools']);
    const mine = theServersTools(entries, 'mnema_');

    for (const entry of entries.filter((one) => String(one['name']).startsWith('mnema_'))) {
      expect(String(entry['description']).length, String(entry['name'])).toBeGreaterThan(40);
      expect(entry['input_schema'], String(entry['name'])).toBeTypeOf('object');
    }
    expect({ count: mine.names.length, ...mine.all }).toEqual({
      count: 27,
      bytes: 50_551,
      tokens: 11_331,
    });
  }, 180_000);
});
