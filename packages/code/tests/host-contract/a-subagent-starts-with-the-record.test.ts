/**
 * A SUBAGENT STARTS WITH THE RECORD, in the real host: what the plugin's `SubagentStart` hook prints
 * is in a request the host sends for the subagent's own turn, under the host's name for text a
 * hook added, and it is the text `mnema brief --hook` prints.
 *
 * WHAT IS HELD HERE AND WHAT IS NOT. The product's half (the same verb, the event echoed back, the
 * silence outside a project and with the channel off) is `the-record-arrives-unasked.test.ts`.
 * What it cannot say is that the host takes the `additionalContext` of that event and puts it in
 * front of the subagent: that is the host's, and it is read here off the requests the host sends
 * to a stand-in for the model, one of which is the subagent's. The model is a stand-in that
 * answers every turn with the text the case gives it; nothing is decided by a model.
 *
 * THE CONTROL IS THE SAME SESSION WITH THE CHANNEL SWITCHED OFF: the hook still runs, and nothing
 * under that header reaches any request, so "it arrived" is not a host that always adds the text.
 *
 * NOT HELD: that the subagent READS what arrived. The request is evidence of what was put in front
 * of it, never of what it made of it.
 */

import { describe, expect, it } from 'vitest';
import {
  aHostForEachCase,
  everyBlockOf,
  type TheSession,
  type TheStreamEvent,
} from './support/the-host.js';
import { decide } from './support/the-record-to-stand-on.js';
import { dispatchASubagent } from './support/the-stand-in-api.js';

/** The header the host puts over the text a `SubagentStart` hook added. */
const HEADER = '<system-reminder>\nSubagentStart hook additional context:';

/** The hook reports of the subagent's start, in the order the host made them. */
function theStarts(session: TheSession): TheStreamEvent[] {
  return session.stream.filter(
    (event) => event['subtype'] === 'hook_response' && event['hook_event'] === 'SubagentStart',
  );
}

/** What the `SubagentStart` hook handed the host, as it reached any request. */
function whatTheSubagentStartedWith(session: TheSession): string[] {
  return session.messages.flatMap((request) =>
    everyBlockOf(request).filter((block) => block.startsWith(HEADER)),
  );
}

describe('a subagent starts with the record', () => {
  const start = aHostForEachCase();

  it('hands the brief of the session to the subagent that begins, byte for byte', async () => {
    const session = await start({
      call: dispatchASubagent(),
      allow: ['Agent'],
      callOnce: true,
      closing: 'Done.',
      project: (project) => {
        decide(project, 'Bill in UTC');
      },
    });
    expect(theStarts(session).length).toBeGreaterThan(0);
    const arrived = whatTheSubagentStartedWith(session);
    expect(arrived.length).toBeGreaterThan(0);
    const printed = session.mnema('brief', '--hook').trim();
    expect(printed).toContain('Bill in UTC');
    expect(arrived.every((block) => block.includes(printed))).toBe(true);
  }, 120_000);

  it('hands nothing when the document channel is switched off', async () => {
    const session = await start({
      call: dispatchASubagent(),
      allow: ['Agent'],
      callOnce: true,
      closing: 'Done.',
      project: (project) => {
        decide(project, 'Bill in UTC');
        project.mnema('switch', 'off', 'brief-document', '--reason', 'kept by hand');
      },
    });
    expect(whatTheSubagentStartedWith(session)).toEqual([]);
  }, 120_000);
});
