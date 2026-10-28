/**
 * WHERE A RULE ARRIVES, in Codex: the sentinel of one rule, kept in each place a rule can be kept,
 * looked for in the requests the host sends its model; see `the-rule-arrives.test.ts` for what the
 * moments are and `support/the-arrival-table.ts` for what is measured.
 *
 * THE CALLS ARE PATCHES. Codex offers its model `apply_patch`, so the session of several turns is
 * three patches that each add a file, one per turn.
 *
 * AFTER A COMPACTION. The stand-in reports a full window in the turn that answers the third patch
 * and the host's limit for compacting is set low in its configuration, so that it compacts: the
 * summary is asked for by a request that offers no tool and begins "You are performing a CONTEXT
 * CHECKPOINT COMPACTION", and the stand-in answers it with a text of its own that does not hold
 * the rule. The request that follows is proved to be the compacted conversation: it carries the
 * summary and none of the outputs.
 *
 * AT AN EDIT, the rule arrives if it is in the output of the patch to the governed path.
 *
 * NOT HELD: that the model reads the rule or follows it.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect } from 'vitest';
import {
  THE_GOVERNED_DIRECTORY,
  theMentionIsIn,
  theSentinelIsIn,
} from './support/the-arms-of-a-rule.js';
import { theRowOf } from './support/the-arrival-harness.js';
import {
  aCodexForEachCase,
  aPatchAdding,
  aScriptOfPatches,
  theResultOfTheCall,
} from './support/the-codex.js';

const THE_SUMMARY = 'Summary chosen by the case: the person asked for three files.';

const ASKS_FOR_THE_SUMMARY = 'CONTEXT CHECKPOINT COMPACTION';

describe('where a rule arrives in Codex', () => {
  const start = aCodexForEachCase();

  theRowOf('codex', ['start', 'late', 'compaction', 'edit'], async ({ files, record, arm }) => {
    const long = await start({
      files,
      ...(record === undefined ? {} : { project: record }),
      config: ['model_auto_compact_token_limit = 50000'],
      script: () =>
        aScriptOfPatches({
          patches: [1, 2, 3].map((n) => aPatchAdding(`f${n}.ts`)),
          fillsTheWindowAfter: 3,
          isTheSummaryRequest: (body) =>
            JSON.stringify(body['input'] ?? []).includes(ASKS_FOR_THE_SUMMARY),
          summary: THE_SUMMARY,
        }),
    });
    const asked = long.requests.findIndex((request) =>
      JSON.stringify(request.body['input'] ?? []).includes(ASKS_FOR_THE_SUMMARY),
    );
    // The instrument: the host did compact, and the request after the summary is the compacted one.
    expect(asked, 'the host never asked for a summary').toBeGreaterThan(1);
    const before = long.requests[asked - 1];
    const after = long.requests[asked + 1];
    expect(before, 'a request before the summary').toBeDefined();
    expect(after, 'a request after the summary').toBeDefined();
    expect(JSON.stringify(before?.body['input'])).toContain('call_stand_in_2');
    expect(JSON.stringify(after?.body['input'])).toContain(THE_SUMMARY);
    expect(JSON.stringify(after?.body['input'])).not.toContain('call_stand_in_1');

    const arrived: Partial<Record<'start' | 'late' | 'compaction' | 'edit', boolean>> = {
      start: theSentinelIsIn(long.requests[0]?.body),
      late: theSentinelIsIn(before?.body),
      compaction: theSentinelIsIn(after?.body),
    };
    if (arm === 'mnema') {
      const edit = await start({
        files,
        project: record as NonNullable<typeof record>,
        patch: aPatchAdding(`${THE_GOVERNED_DIRECTORY}/invoice.ts`),
      });
      expect(existsSync(join(edit.project, THE_GOVERNED_DIRECTORY, 'invoice.ts'))).toBe(true);
      arrived.edit = theSentinelIsIn(theResultOfTheCall(edit));
    }
    return { arrived, mentioned: theMentionIsIn(long.requests[0]?.body) };
  });
});
