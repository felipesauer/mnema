/**
 * THE SHELL GOES ROUND THE RULE, and this case requires that it does.
 *
 * The product says it out loud: a rule that refuses a write covers the editing tools, not the
 * shell, and a write to a governed path made through the shell goes round the rule. That is a
 * declared limit, and a limit that is only declared is one change away from being forgotten. So it
 * is held as a case: in the real host, the same path a rule refuses to the host's own write is
 * edited by `sed -i` through the shell, and the edit happens, with no refusal and no word from the
 * record.
 *
 * IT FAILS THE DAY THE PRODUCT STARTS TO COVER THE SHELL, and that is the point: the page that
 * says the shell is not covered would then be wrong, and this is red until the page and the case
 * are changed together, by a decision and not by an accident.
 *
 * WHAT IT DOES NOT SHOW: that no other way round exists, or that the shell is the only one. It
 * shows the one a person would try first.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aHostForEachCase, theResultOfTheCall } from './support/the-host.js';
import { aFile, ruleAt, type TheProject } from './support/the-record-to-stand-on.js';
import { runInTheShell, writeTo } from './support/the-stand-in-api.js';

const PATH = 'src/billing/invoice.ts';

/** A record that refuses writes under `src/billing`, and a file there. */
function aFrozenFile(project: TheProject): void {
  ruleAt(project, 'Billing is frozen', 'src/billing', 'refuses-a-write');
  aFile(project, PATH, 'rate = old\n');
}

describe('the shell goes round the rule', () => {
  const start = aHostForEachCase();

  it('refuses the host’s own write to the file', async () => {
    const session = await start({ project: aFrozenFile, call: writeTo(PATH, 'rate = new\n') });
    expect(readFileSync(join(session.project, PATH), 'utf-8')).toBe('rate = old\n');
    expect(theResultOfTheCall(session)?.isError).toBe(true);
  }, 120_000);

  it('lets `sed -i` through the shell edit the same file', async () => {
    const session = await start({
      project: aFrozenFile,
      allow: ['Bash'],
      call: runInTheShell((project) => `sed -i 's/old/new/' ${join(project, PATH)}`),
    });
    expect(existsSync(join(session.project, PATH))).toBe(true);
    expect(readFileSync(join(session.project, PATH), 'utf-8')).toBe('rate = new\n');
    const result = theResultOfTheCall(session);
    expect(result?.isError).toBe(false);
    expect(result?.text).not.toContain('refuses a write');
  }, 120_000);
});
