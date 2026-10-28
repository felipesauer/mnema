/**
 * THE SESSION OPENS WITH THE RECORD, in the real host: what the `SessionStart` hooks print is in
 * the first request the host sends, before any tool is called, and a decision that was
 * superseded is not in it as a rule in force: it is named only on the rule that replaced it.
 *
 * THE PREMISE THIS CASE HELD BEFORE, and what falsified it: it said the decision a decision
 * replaced is "in nothing the host sent". The opening now names, on the line of a rule that
 * replaced another, the label, the title and the state of the replaced one (`supersedes ADR-n:
 * <title> (superseded)`), because an id alone told a model nothing about which call it was. What
 * still holds, and is read here, is that the replaced decision is not handed over as a RULE: it
 * has no line of its own and appears nowhere but in that clause.
 *
 * WHAT IS HELD HERE AND WHAT IS NOT. The product's half (what `mnema brief --hook` prints, and
 * that it leaves a superseded decision out of the rules in force) is held by `the-record-arrives-unasked.test.ts` and
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

  it('hands the decision in force in the first request, and the one it superseded only as the clause that names it', async () => {
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

    // It is in the FIRST request, the one that carries the call, and in a block the host names.
    const opened = whatTheSessionOpenedWith(session);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toContain('Bill in UTC');

    // The decision it replaced is named on the rule that replaced it, and in no other place in
    // anything the host sent: every mention of its title is that clause, none is a line of its own.
    const clause = 'supersedes ADR-\\d+: Bill in local time \\(superseded\\)';
    expect(opened[0]).toMatch(new RegExp(clause));
    for (const request of session.requests) {
      const sent = JSON.stringify(request.body);
      const mentions = sent.match(/Bill in local time/g)?.length ?? 0;
      const clauses = sent.match(new RegExp(clause, 'g'))?.length ?? 0;
      expect(
        mentions,
        'the superseded decision reached the host outside the clause naming it',
      ).toBe(clauses);
    }
    expect(opened[0]).not.toMatch(/^- \*\*ADR-\d+: Bill in local time\*\*/m);
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
