/**
 * A SUBAGENT IS SENT BACK FOR ITS HAND-BACK, in the real host: a subagent that stops with a final
 * reply that does not end in the block of decisions the record asks for is held by the plugin's
 * `SubagentStop` hook and handed the format as its next instruction; one that stops with the
 * block is not touched; and the hook lets the second stop through.
 *
 * WHAT IS HELD HERE AND WHAT IS NOT. The product's half — which replies are in the format and the
 * words of the reason — is `a-subagent-hands-back-its-decisions.test.ts`. What the host does with
 * exit 2 on that event is the host's, and it is read here with the real binary: the hook's own
 * report in the stream (`hook_response`), and the request the host sends for the subagent's next
 * turn, which carries the reason. The model is a stand-in that answers every turn with the text
 * the case gives it, so the subagent's final reply is that text; nothing is decided by a model.
 *
 * THE CONTROL IS THE SAME SESSION WITH A REPLY IN THE FORMAT: the hook runs and the host does not
 * send the subagent back, so "the reason reached the subagent" is not a host that always does.
 *
 * NOT HELD: a subagent that follows the format on its second try. The stand-in says the same text
 * twice, and what is read is that the second stop is let through, not that a model complied.
 */

import { describe, expect, it } from 'vitest';
import {
  aHostForEachCase,
  everyBlockOf,
  type TheSession,
  type TheStreamEvent,
} from './support/the-host.js';
import { dispatchASubagent } from './support/the-stand-in-api.js';

const IN_THE_FORMAT =
  'Looked into it.\n\n```mnema-handback\n{"decisions":[{"settled":"Use UTC","why":"The ledger is UTC","turnedDown":"Local time: it drifts"}]}\n```';

/** The hook reports of the subagent's stop, in the order the host made them. */
function theStops(session: TheSession): TheStreamEvent[] {
  return session.stream.filter(
    (event) => event['subtype'] === 'hook_response' && event['hook_event'] === 'SubagentStop',
  );
}

/** The requests that carry the reason the hook sent the subagent back with. */
function theRequestsThatCarryTheReason(session: TheSession) {
  return session.messages.filter((request) =>
    everyBlockOf(request).some((block) => block.includes('Your last reply was not in that format')),
  );
}

describe('a subagent is sent back for its hand-back', () => {
  const start = aHostForEachCase();

  it('a reply with no block: the hook exits 2, the subagent is handed the format, and the second stop goes through', async () => {
    const session = await start({
      call: dispatchASubagent(),
      allow: ['Agent'],
      callOnce: true,
      closing: 'Analysis complete. Found 3 potential issues.',
    });
    const stops = theStops(session);
    expect(stops.map((event) => event['exit_code'])).toEqual([2, 0]);
    expect(String(stops[0]?.['stderr'] ?? stops[0]?.['output'])).toContain('```mnema-handback');
    expect(theRequestsThatCarryTheReason(session).length).toBeGreaterThan(0);
  }, 120_000);

  it('a reply in the format: the hook runs and says nothing, and nobody is sent back', async () => {
    const session = await start({
      call: dispatchASubagent(),
      allow: ['Agent'],
      callOnce: true,
      closing: IN_THE_FORMAT,
    });
    const stops = theStops(session);
    expect(stops.map((event) => event['exit_code'])).toEqual([0]);
    expect(theRequestsThatCarryTheReason(session)).toEqual([]);
  }, 120_000);
});
