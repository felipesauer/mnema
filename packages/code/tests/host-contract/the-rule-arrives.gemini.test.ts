/**
 * WHERE A RULE ARRIVES, in Gemini CLI: the sentinel of one rule, kept in each place a rule can be
 * kept, looked for in the requests the host sends its model; see `the-rule-arrives.test.ts` for
 * what the moments are and `support/the-arrival-table.ts` for what is measured.
 *
 * LATE is the request that carries the result of the third call to the shell, the last one of a
 * session of three turns.
 *
 * AFTER A COMPACTION IS NOT TAKEN. The stand-in reports a full window after the third call, and
 * the host made no request for a summary: in one `gemini -p` run there is a single turn of the
 * person, and the host's compression splits the history at a turn of the person after the first
 * (`findCompressSplitPoint`, read in the bundle of 0.63.0), so it compresses nothing. No request of
 * a compacted conversation was seen, so the table says it was not measured. The case below
 * requires that the host asked for no summary, so that a version that does is red and the cell is
 * taken up.
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
  aGeminiForEachCase,
  aScriptOfCalls,
  theResultOfTheCall,
  theToolsOf,
  writing,
} from './support/the-gemini.js';

describe('where a rule arrives in Gemini CLI', () => {
  const start = aGeminiForEachCase();

  theRowOf('gemini', ['start', 'late', 'edit'], async ({ files, record, arm }) => {
    const long = await start({
      files,
      ...(record === undefined ? {} : { project: record }),
      script: () =>
        aScriptOfCalls({
          calls: [1, 2, 3].map((n) => ({
            tool: 'run_shell_command',
            input: { command: `echo ${n}`, description: 'echo' },
          })),
          fillsTheWindowAfter: 3,
        }),
    });
    const withTools = long.requests.filter((request) => theToolsOf(request).length > 0);
    const last = withTools.at(-1);
    // The instrument: the last request carries the result of the third call, and the host asked
    // for no summary although the window was reported full.
    expect(JSON.stringify(last?.body['contents'])).toContain('"functionResponse"');
    expect(last?.body['contents']).toHaveLength(7);
    expect(
      long.everyRequest.filter((request) =>
        JSON.stringify(request.body['contents'] ?? []).includes('<state_snapshot>'),
      ),
      'the host asked for a summary: take up the cell',
    ).toEqual([]);
    const arrived: Partial<Record<'start' | 'late' | 'compaction' | 'edit', boolean>> = {
      start: theSentinelIsIn(withTools[0]?.body),
      late: theSentinelIsIn(last?.body),
    };
    if (arm === 'mnema') {
      const edit = await start({
        files,
        project: record as NonNullable<typeof record>,
        call: writing(THE_GOVERNED_FILE),
      });
      expect(existsSync(join(edit.project, THE_GOVERNED_FILE))).toBe(true);
      arrived.edit = theSentinelIsIn(theResultOfTheCall(edit));
    }
    return { arrived, mentioned: theMentionIsIn(withTools[0]?.body) };
  });
});
