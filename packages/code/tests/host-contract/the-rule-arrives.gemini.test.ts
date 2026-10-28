/**
 * WHERE A RULE ARRIVES, in Gemini CLI: the sentinel of one rule, kept in each place a rule can be
 * kept, looked for in the requests the host sends its model; see `the-rule-arrives.test.ts` for
 * what the moments are and `support/the-arrival-table.ts` for what is measured.
 *
 * LATE is the request that carries the result of the third call to the shell, the last one of a
 * session of three turns.
 *
 * AFTER A COMPACTION is taken in a SECOND RUN that resumes the session (`--resume latest`, in the
 * same home and project). A `gemini -p` run has a single turn of the person, and the host's
 * compression finds nothing to compress until there is a second turn of the person or a closing
 * text of the model (`findCompressSplitPoint`, read in the bundle of 0.63.0); the resumed run is that
 * second turn. The host restores the conversation, the stand-in answers the resumed prompt with a
 * call and reports a full window, and the host asks for its summary (two requests, to
 * `:generateContent`, the second one to check the first), which the stand-in answers with a text of
 * its own that does not hold the rule. The request that follows is proved to be the compacted
 * conversation: it carries the summary and fewer results than the one before the summary.
 *
 * WHAT THAT READING IS. The resumed run starts the session again, so the plugin's own start runs
 * again, and its text is in the turn of the person that the compaction keeps beside the summary.
 * The reading is what is in front of the model in the first request after the summary, and it says
 * nothing about a compaction in a session that was never resumed.
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

const THE_SUMMARY = 'Summary chosen by the case: the person asked for four calls to the shell.';

/** What the host's request for a summary ends with, in the turn that asks for it and in the one that checks it. */
const ASKS_FOR_THE_SUMMARY = 'state_snapshot>';

/** The text of the last turn of a request's conversation. */
function theLastTextOf(body: Readonly<Record<string, unknown>>): string {
  const contents = (Array.isArray(body['contents']) ? body['contents'] : []) as {
    parts?: { text?: string }[];
  }[];
  return (contents.at(-1)?.parts ?? []).map((part) => part.text ?? '').join('');
}

/** How many results of calls a request's conversation carries. */
function theResultsIn(body: Readonly<Record<string, unknown>> | undefined): number {
  return JSON.stringify(body?.['contents'] ?? []).split('"functionResponse"').length - 1;
}

describe('where a rule arrives in Gemini CLI', () => {
  const start = aGeminiForEachCase();

  theRowOf('gemini', ['start', 'late', 'compaction', 'edit'], async ({ files, record, arm }) => {
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
      resume: {
        prompt: 'Now run one more command.',
        script: () =>
          aScriptOfCalls({
            calls: [
              { tool: 'run_shell_command', input: { command: 'echo 4', description: 'echo' } },
            ],
            countsFromTheFirstRequest: true,
            fillsTheWindowAfter: 1,
            isTheSummaryRequest: (body) => theLastTextOf(body).includes(ASKS_FOR_THE_SUMMARY),
            summary: THE_SUMMARY,
          }),
      },
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
    // The instrument for the compaction: the resumed run asked for a summary (a request that offers
    // no tool, whose last turn asks for the snapshot), and the request after it is the compacted
    // conversation: it carries the summary the stand-in gave and fewer results than the request
    // before the summary.
    const resumed = long.resumedEveryRequest;
    const asked = resumed.findIndex(
      (request) =>
        request.url.includes(':generateContent') &&
        theLastTextOf(request.body).includes(ASKS_FOR_THE_SUMMARY),
    );
    expect(asked, 'the resumed run never asked for a summary').toBeGreaterThan(0);
    const before = resumed[asked - 1];
    const after = resumed
      .slice(asked)
      .find((request) => request.url.includes(':streamGenerateContent'));
    expect(before, 'a request before the summary').toBeDefined();
    expect(after, 'a request after the summary').toBeDefined();
    expect(JSON.stringify(after?.body['contents'])).toContain(THE_SUMMARY);
    expect(theResultsIn(after?.body)).toBeLessThan(theResultsIn(before?.body));
    expect(
      theSentinelIsIn(THE_SUMMARY),
      'the summary holds the rule: the instrument is blind',
    ).toBe(false);
    const arrived: Partial<Record<'start' | 'late' | 'compaction' | 'edit', boolean>> = {
      start: theSentinelIsIn(withTools[0]?.body),
      late: theSentinelIsIn(last?.body),
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
    return { arrived, mentioned: theMentionIsIn(withTools[0]?.body) };
  });
});
