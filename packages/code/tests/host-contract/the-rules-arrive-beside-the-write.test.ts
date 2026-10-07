/**
 * THE RULES ARRIVE BESIDE THE WRITE, in the real host: where a decision in force is linked to a
 * path with `governs`, the host's own write to that path succeeds and the rules addressed at it
 * are in the next request, beside the result of that write; a path no rule names gets nothing.
 *
 * WHAT IS HELD HERE AND WHAT IS NOT. The product's half — which rules are addressed at a path and
 * what the reply says — is `the-rule-reaches-the-writing.test.ts`. What it cannot say is that the
 * host calls the plugin's server at the edit, under the name the plugin gave it, and hands the
 * reply to the model. That is read here, off the request the host sends after the write, with a
 * stand-in for the model. The server's name is the one thing a rename of either half of the plugin
 * breaks, and the case that names no rule is the control: without it, silence would read as
 * working.
 *
 * NOT HELD: that the model reads the rules, or that it follows them.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  aHostForEachCase,
  theResultOfTheCall,
  whatWasAddedBesideTheResult,
} from './support/the-host.js';
import { ruleAt } from './support/the-record-to-stand-on.js';
import { writeTo } from './support/the-stand-in-api.js';

describe('the rules arrive beside the write', () => {
  const start = aHostForEachCase();

  it('hands the rules addressed at the path beside the result of the write that happens', async () => {
    let rule = '';
    const session = await start({
      project: (project) => {
        rule = ruleAt(project, 'Bill in UTC', 'src/billing', 'governs');
      },
      call: writeTo('src/billing/invoice.ts'),
    });

    // The write happened: a rule that only governs informs, it does not hold.
    expect(existsSync(join(session.project, 'src/billing/invoice.ts'))).toBe(true);
    expect(theResultOfTheCall(session)?.isError).toBe(false);

    // And the rule is beside it, with its id, which is what the agent asks the record about.
    const beside = whatWasAddedBesideTheResult(session, 'PreToolUse:Write').join('\n');
    expect(beside).toContain('Bill in UTC');
    expect(beside).toContain(rule);
    expect(beside).toContain('governs src/billing');
  }, 120_000);

  it('hands nothing beside a write to a path no rule names', async () => {
    const session = await start({
      project: (project) => {
        ruleAt(project, 'Bill in UTC', 'src/billing', 'governs');
      },
      call: writeTo('src/other/notes.ts'),
    });
    expect(existsSync(join(session.project, 'src/other/notes.ts'))).toBe(true);
    expect(whatWasAddedBesideTheResult(session, 'PreToolUse:Write')).toEqual([]);
  }, 120_000);
});
