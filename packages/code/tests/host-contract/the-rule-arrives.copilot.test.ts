/**
 * WHERE A RULE ARRIVES, in the Copilot CLI: the sentinel of one rule, kept in each place a rule can
 * be kept, looked for in the requests the host sends its model; see `the-rule-arrives.test.ts` for
 * what the moments are and `support/the-arrival-table.ts` for what is measured.
 *
 * LATE is the request that carries the output of the third call to the shell, the last one of a
 * session of three turns.
 *
 * AFTER A COMPACTION IS NOT TAKEN. The host asks for a summary when the usage it is told is full,
 * but it asks at the end of the run, and `copilot -p` ends there; a second run that resumes the
 * session sent the whole conversation again, the three results and none of the summary. No
 * request of a compacted conversation was seen, so the table says it was not measured.
 *
 * AT AN EDIT, the rule arrives if it is in the result of the `create` of a file at the governed path:
 * the hook that runs after the write (`postToolUse`) answers with the rules as `additionalContext`,
 * which the host appends to the text of the result. The reading is of the `tool_result` blocks alone,
 * never of the whole request, which already carries the rule from the opening.
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
import { aCopilotForEachCase, creating } from './support/the-copilot.js';
import { aScriptOfCalls } from './support/the-stand-in-api.js';

describe('where a rule arrives in the Copilot CLI', () => {
  const start = aCopilotForEachCase();

  theRowOf('copilot', ['start', 'late', 'edit'], async ({ files, record, arm }) => {
    const long = await start({
      files,
      ...(record === undefined ? {} : { project: record }),
      script: () =>
        aScriptOfCalls({
          calls: [1, 2, 3].map((n) => ({
            tool: 'bash',
            input: { command: `echo ${n}`, description: 'echo', mode: 'sync' },
          })),
        }),
    });
    const last = long.requests.at(-1);
    // The instrument: the last request carries the output of the third call.
    expect(JSON.stringify(last?.body['messages'])).toContain('toolu_stand_in_0003');
    const arrived: Partial<Record<'start' | 'late' | 'compaction' | 'edit', boolean>> = {
      start: theSentinelIsIn(long.requests[0]?.body),
      late: theSentinelIsIn(last?.body),
    };
    if (arm === 'mnema') {
      const edit = await start({
        files,
        project: record as NonNullable<typeof record>,
        call: creating(THE_GOVERNED_FILE),
      });
      expect(existsSync(join(edit.project, THE_GOVERNED_FILE))).toBe(true);
      const result = edit.requests.find((request) =>
        JSON.stringify(request.body['messages'] ?? []).includes('"tool_result"'),
      );
      expect(result, 'the request that carries the result of the create').toBeDefined();
      arrived.edit = theSentinelIsIn(resultOf(result?.body['messages']));
      // THE INSTRUMENT: the same read of the same record with the push switched off finds nothing, so
      // a sentinel found above is the push and not the opening.
      const off = await start({
        files,
        project: (project) => {
          record?.(project);
          project.mnema('switch', 'off', 'edit-rules-push');
        },
        call: creating(THE_GOVERNED_FILE),
      });
      expect(existsSync(join(off.project, THE_GOVERNED_FILE))).toBe(true);
      const offResult = off.requests.find((request) =>
        JSON.stringify(request.body['messages'] ?? []).includes('"tool_result"'),
      );
      expect(offResult, 'the request that carries the result of the create').toBeDefined();
      expect(
        theSentinelIsIn(resultOf(offResult?.body['messages'])),
        'the instrument sees a push that was switched off',
      ).toBe(false);
    }
    return { arrived, mentioned: theMentionIsIn(long.requests[0]?.body) };
  });
});

/** The content of the `tool_result` blocks of a conversation, and nothing else of it. */
function resultOf(messages: unknown): unknown {
  const out: unknown[] = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if ((block as { type?: unknown }).type === 'tool_result') {
        out.push((block as { content?: unknown }).content);
      }
    }
  }
  return out;
}
