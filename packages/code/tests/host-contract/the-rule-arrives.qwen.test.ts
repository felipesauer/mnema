/**
 * WHERE A RULE ARRIVES, in Qwen Code: the sentinel of one rule, kept in each place a rule can be
 * kept, looked for in the requests the host sends its model; see `the-rule-arrives.test.ts` for
 * what the moments are and `support/the-arrival-table.ts` for what is measured.
 *
 * LATE is the last request before the summary, which carries the result of the second call.
 *
 * AFTER A COMPACTION. The stand-in reports a full window after the third call and the host asks
 * for a summary, in a user message that begins "You are the component that summarizes a
 * conversation". The stand-in answers it with a text of its own that does not hold the rule. The
 * request that follows is proved to be the compacted conversation: it carries the summary and not
 * the first result (the host keeps the most recent part of the conversation as it was, which is
 * the last result). The usage the stand-in claims is below the host's hard limit, because above
 * it the host refuses to send anything after compressing.
 *
 * AT AN EDIT, the rule arrives if it is in the result of the write to the governed path.
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
  aQwenForEachCase,
  aScriptOfCalls,
  theResultOfTheCall,
  writing,
} from './support/the-qwen.js';

const THE_SUMMARY = 'Summary chosen by the case: the person asked for three shell echoes.';

/** The host asks for its summary with this instruction at the end of the conversation. */
const ASKS_FOR_THE_SUMMARY = 'You are the component that summarizes a conversation';

describe('where a rule arrives in Qwen Code', () => {
  const start = aQwenForEachCase();

  theRowOf('qwen', ['start', 'late', 'compaction', 'edit'], async ({ files, record, arm }) => {
    const long = await start({
      files,
      ...(record === undefined ? {} : { project: record }),
      script: () =>
        aScriptOfCalls({
          calls: [1, 2, 3].map((n) => ({
            tool: 'run_shell_command',
            input: { command: `echo ${n}`, description: 'echo', is_background: false },
          })),
          fillsTheWindowAfter: 3,
          isTheSummaryRequest: (body) =>
            JSON.stringify(body['messages'] ?? []).includes(ASKS_FOR_THE_SUMMARY),
          summary: `<analysis>none</analysis><state_snapshot>${THE_SUMMARY}</state_snapshot>`,
        }),
    });
    const asked = long.requests.findIndex((request) =>
      JSON.stringify(request.body['messages'] ?? []).includes(ASKS_FOR_THE_SUMMARY),
    );
    // The instrument: the host did compact, and the request after the summary is the compacted one.
    expect(asked, 'the host never asked for a summary').toBeGreaterThan(1);
    const before = long.requests[asked - 1];
    const after = long.requests[asked + 1];
    expect(before, 'a request before the summary').toBeDefined();
    expect(after, 'a request after the summary').toBeDefined();
    expect(JSON.stringify(before?.body['messages'])).toContain('Command: echo 2');
    expect(JSON.stringify(after?.body['messages'])).toContain(THE_SUMMARY);
    expect(JSON.stringify(after?.body['messages'])).not.toContain('Command: echo 1');

    const arrived: Partial<Record<'start' | 'late' | 'compaction' | 'edit', boolean>> = {
      start: theSentinelIsIn(long.requests[0]?.body),
      late: theSentinelIsIn(before?.body),
      compaction: theSentinelIsIn(after?.body),
    };
    if (arm === 'mnema') {
      const edit = await start({
        files,
        project: record as NonNullable<typeof record>,
        call: writing(THE_GOVERNED_FILE),
      });
      expect(existsSync(join(edit.project, THE_GOVERNED_FILE))).toBe(true);
      arrived.edit = theSentinelIsIn(theResultOfTheCall(edit));
      // THE INSTRUMENT: the same read of the same record with the push switched off finds nothing, so
      // a sentinel found above is the push and not the opening, which already carries the rule.
      const off = await start({
        files,
        project: (project) => {
          record?.(project);
          project.mnema('switch', 'off', 'edit-rules-push');
        },
        call: writing(THE_GOVERNED_FILE),
      });
      expect(existsSync(join(off.project, THE_GOVERNED_FILE))).toBe(true);
      expect(
        theSentinelIsIn(theResultOfTheCall(off)),
        'the instrument sees a push that was switched off',
      ).toBe(false);
    }
    return { arrived, mentioned: theMentionIsIn(long.requests[0]?.body) };
  });
});
