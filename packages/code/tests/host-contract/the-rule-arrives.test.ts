/**
 * WHERE A RULE ARRIVES, in Claude Code: the sentinel of one rule, kept in each place a rule can be
 * kept, looked for in the requests the host sends its model, at the start of a session, late in
 * one, after the conversation was compacted, and at an edit. The table of what is measured and
 * what is not is `support/the-arrival-table.ts`; the page that shows it is `docs/rule-arrival.md`.
 *
 * LATE IS MEASURED, NOT ASSUMED. The host sends its whole conversation again with each request, so
 * a rule that was in the first request should be in the later ones; the session here makes three
 * calls to the shell, one per turn, and reads the request after the second.
 *
 * AFTER A COMPACTION. The stand-in says, in the turn that answers the third call, that the window
 * is full, and the host asks for a summary of the conversation; the summary the stand-in answers
 * with is a text of its own that does not hold the rule, so what the next request carries of it
 * is what the host or the product put back. The request that follows is proved to be the compacted
 * conversation: it carries the summary and none of the three results. The window is told to the
 * host with `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, which the binary reads.
 *
 * NOT HELD: that the model reads the rule or follows it.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect } from 'vitest';
import {
  THE_GOVERNED_FILE,
  theMentionIsIn,
  theSentinelIsIn,
} from './support/the-arms-of-a-rule.js';
import { theRowOf } from './support/the-arrival-harness.js';
import {
  aHostForEachCase,
  type TheSession,
  whatWasAddedBesideTheResult,
} from './support/the-host.js';
import { aScriptOfCalls, runInTheShell, writeTo } from './support/the-stand-in-api.js';

/** What the stand-in answers the request for a summary with: no rule in it, and a marker that it was this one. */
const THE_SUMMARY = 'Summary chosen by the case: the person asked for three shell echoes.';

/** The host asks for its summary with this instruction at the end of the conversation. */
const ASKS_FOR_THE_SUMMARY = 'CRITICAL: Respond with TEXT ONLY';

describe('where a rule arrives in Claude Code', () => {
  const start = aHostForEachCase();

  const sessionOf = (spec: Parameters<typeof start>[0]): Promise<TheSession> => start(spec);

  theRowOf(
    'claude-code',
    ['start', 'late', 'compaction', 'edit'],
    async ({ files, record, arm }) => {
      const long = await sessionOf({
        files,
        ...(record === undefined ? {} : { project: record }),
        script: (project) =>
          aScriptOfCalls({
            calls: [1, 2, 3].map((n) => runInTheShell(() => `echo ${n}`)(project)),
            fillsTheWindowAfter: 3,
            isTheSummaryRequest: (body) =>
              JSON.stringify(body['messages'] ?? []).includes(ASKS_FOR_THE_SUMMARY),
            summary: THE_SUMMARY,
          }),
        allow: ['Bash'],
        env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '100000' },
      });
      const asked = long.messages.findIndex((request) =>
        JSON.stringify(request.body.messages ?? []).includes(ASKS_FOR_THE_SUMMARY),
      );
      // The instrument: the host did compact, and the request after the summary is the compacted one.
      expect(asked, 'the host never asked for a summary').toBeGreaterThan(1);
      const before = long.messages[asked - 1];
      const after = long.messages[asked + 1];
      expect(before, 'a request before the summary').toBeDefined();
      expect(after, 'a request after the summary').toBeDefined();
      expect(JSON.stringify(after?.body.messages)).toContain(THE_SUMMARY);
      expect(JSON.stringify(after?.body.messages)).not.toContain('toolu_stand_in_0001');
      expect(JSON.stringify(before?.body.messages)).toContain('toolu_stand_in_0002');

      const arrived: Partial<Record<'start' | 'late' | 'compaction' | 'edit', boolean>> = {
        start: theSentinelIsIn(long.messages[0]?.body),
        late: theSentinelIsIn(before?.body),
        compaction: theSentinelIsIn(after?.body),
      };
      if (arm === 'mnema') {
        const edit = await sessionOf({
          files,
          project: record as NonNullable<typeof record>,
          call: writeTo(THE_GOVERNED_FILE),
        });
        expect(existsSync(join(edit.project, THE_GOVERNED_FILE))).toBe(true);
        arrived.edit = theSentinelIsIn(whatWasAddedBesideTheResult(edit, 'PreToolUse:Write'));
      }
      return { arrived, mentioned: theMentionIsIn(long.messages[0]?.body) };
    },
  );
});
