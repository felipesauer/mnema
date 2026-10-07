/**
 * THE SESSION OPENS WITH THE RECORD, in the real host: what the `SessionStart` hooks print is in
 * the first request the host sends, before any tool is called, and a decision that was
 * superseded is not in it.
 *
 * WHAT IS HELD HERE AND WHAT IS NOT. The product's half — what `mnema brief --hook` prints, and
 * that it leaves a superseded decision out — is held by `the-record-arrives-unasked.test.ts` and
 * the brief's own cases. What none of those can say is that the host takes the text a hook prints
 * and puts it in front of the model: that is the host's, and it is read here off the request the
 * host sends to a stand-in for the model, with the version it was read on named by the run.
 *
 * NOT HELD, said where it would be assumed: that the model READS what arrived, or follows the
 * decision in force instead of the one it replaced. The request is evidence of what was put in
 * front of it, never of what it made of it.
 */

import { describe, expect, it } from 'vitest';
import { aHostForEachCase, whatTheSessionOpenedWith } from './support/the-host.js';
import { decide } from './support/the-record-to-stand-on.js';

describe('the session opens with the record', () => {
  const start = aHostForEachCase();

  it('hands the decision in force in the first request, and not the one it superseded', async () => {
    const session = await start({
      project: (project) => {
        const before = decide(project, 'Bill in local time');
        const now = decide(project, 'Bill in UTC');
        project.mnema(
          'decision',
          'supersede',
          before,
          now,
          '--reason',
          'ledgers are read across zones',
        );
      },
    });

    // The hook ran at SessionStart, and said something.
    const ran = session.stream.filter(
      (event) => event['subtype'] === 'hook_response' && event['hook_event'] === 'SessionStart',
    );
    expect(ran.length).toBeGreaterThan(0);

    // It is in the FIRST request — the one that carries the call — and in a block the host names.
    const opened = whatTheSessionOpenedWith(session);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toContain('Bill in UTC');

    // The decision it replaced is in nothing the host sent, not in the opening and not elsewhere.
    expect(JSON.stringify(session.requests.map((request) => request.body))).not.toContain(
      'Bill in local time',
    );
  }, 120_000);

  it('hands over exactly the text the verb prints, byte for byte', async () => {
    const session = await start({
      project: (project) => {
        decide(project, 'Bill in UTC');
      },
    });
    const printed = session.mnema('brief', '--hook').trim();
    expect(printed.length).toBeGreaterThan(0);
    expect(whatTheSessionOpenedWith(session).join('\n')).toContain(printed);
  }, 120_000);
});
