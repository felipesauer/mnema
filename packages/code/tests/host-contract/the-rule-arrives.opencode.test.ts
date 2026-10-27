/**
 * WHERE A RULE ARRIVES, in OpenCode: the sentinel of one rule, kept in each place a rule can be
 * kept, looked for in the requests the host sends its model; see `the-rule-arrives.test.ts` for
 * what the moments are and `support/the-arrival-table.ts` for what is measured.
 *
 * ITS FIRST REQUEST IS NOT THE CONVERSATION'S. OpenCode asks the model for a title with a request
 * that offers no tool, before the one that opens the work; the start is the first request that
 * offers a tool, which is the one that carries the system prompt of the work.
 *
 * AFTER A COMPACTION. The host compares the usage the model reports with the window the model is
 * declared with, and the stand-in declares a small one and reports a full one after the third call.
 * The summary is asked for by a request that offers no tool and begins "Here is the conversation
 * so far", and the stand-in answers it with a text of its own that does not hold the rule. The
 * request that follows is proved to be the compacted conversation: it carries the summary and
 * none of the results.
 *
 * AT AN EDIT, the rule arrives if it is in the result of the write to the governed path or beside
 * it; the plugin module refuses a write and adds nothing to one it lets through.
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
  anOpencodeForEachCase,
  theResultOfTheCall,
  theToolsOf,
  writing,
} from './support/the-opencode.js';
import { aScriptOfCalls } from './support/the-stand-in-api.js';

const THE_SUMMARY = 'Summary chosen by the case: the person asked for three shell echoes.';

/** The window the model is declared with, small so that a full one is reported by a claim of 190,000 tokens. */
const A_SMALL_WINDOW = 100_000;

describe('where a rule arrives in OpenCode', () => {
  const start = anOpencodeForEachCase();

  theRowOf('opencode', ['start', 'late', 'compaction', 'edit'], async ({ files, record, arm }) => {
    const long = await start({
      files,
      ...(record === undefined ? {} : { project: record }),
      script: () =>
        aScriptOfCalls({
          calls: [1, 2, 3].map((n) => ({
            tool: 'bash',
            input: { command: `echo ${n}`, description: 'echo' },
          })),
          fillsTheWindowAfter: 3,
          isTheSummaryRequest: (body) =>
            theToolsOf({ url: '', body, userAgent: '' }).length === 0 &&
            JSON.stringify(body['messages'] ?? []).includes('Here is the conversation so far'),
          summary: THE_SUMMARY,
        }),
      window: A_SMALL_WINDOW,
    });
    const asked = long.requests.findIndex(
      (request) =>
        theToolsOf(request).length === 0 &&
        JSON.stringify(request.body['messages'] ?? []).includes('Here is the conversation so far'),
    );
    // The instrument: the host did compact, and the request after the summary is the compacted one.
    expect(asked, 'the host never asked for a summary').toBeGreaterThan(1);
    const withTools = long.requests.filter((request) => theToolsOf(request).length > 0);
    const first = withTools[0];
    const before = long.requests[asked - 1];
    const after = long.requests[asked + 1];
    expect(first, 'a request that offers a tool').toBeDefined();
    expect(before, 'a request before the summary').toBeDefined();
    expect(after, 'a request after the summary').toBeDefined();
    expect(JSON.stringify(before?.body['messages'])).toContain('toolu_stand_in_0002');
    expect(JSON.stringify(after?.body['messages'])).not.toContain('toolu_stand_in_0001');

    const arrived: Partial<Record<'start' | 'late' | 'compaction' | 'edit', boolean>> = {
      start: theSentinelIsIn(first?.body),
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
    }
    return { arrived, mentioned: theMentionIsIn(first?.body) };
  });
});
