/**
 * WITHOUT `mnema` ON THE PATH, THE HOOKS FAIL OPEN, in the real host: a session opens with
 * nothing added, a write a rule would have refused goes through, and no hook that runs a
 * command ends in anything but success.
 *
 * WHY IT IS A CASE OF THE HOST. The plugin's promise is that it never makes a session worse than
 * the one without it, and a hook that cannot find the program it runs is the commonest way for a
 * plugin to break one. The product's handlers are silent in that case
 * (`the-record-arrives-unasked.test.ts` runs each of them with no program); what the host does
 * with the one that is not a command — the call into the server, which cannot start — is the
 * host's, and it is read here: the write is not stopped.
 *
 * THE CONTROL IS THE SAME RECORD WITH `mnema` ON THE PATH, refused in
 * `a-refusal-and-a-pause-hold-the-write.test.ts`: the file here is written because nothing could
 * say no, and not because the rule was never there.
 *
 * NOT HELD: that this is true of every way a hook can fail. It is the one a machine without the
 * program is in.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  aHostForEachCase,
  theResultOfTheCall,
  whatTheSessionOpenedWith,
} from './support/the-host.js';
import { ruleAt } from './support/the-record-to-stand-on.js';
import { writeTo } from './support/the-stand-in-api.js';

describe('without mnema on the path the hooks fail open', () => {
  const start = aHostForEachCase();

  it('opens with nothing added, lets the write a rule would refuse through, and ends every command hook well', async () => {
    const session = await start({
      mnemaOnThePath: false,
      project: (project) => {
        ruleAt(project, 'Billing is frozen', 'src/billing', 'refuses-a-write');
      },
      call: writeTo('src/billing/invoice.ts'),
    });

    expect(session.exit).toBe(0);
    expect(whatTheSessionOpenedWith(session)).toEqual([]);
    expect(existsSync(join(session.project, 'src/billing/invoice.ts'))).toBe(true);
    const result = theResultOfTheCall(session);
    expect(result?.isError).toBe(false);
    expect(result?.text).not.toContain('refuses a write');

    // Every hook that runs a command ended in success: none of them stopped anybody.
    const commands = session.stream.filter(
      (event) =>
        event['subtype'] === 'hook_response' &&
        ['SessionStart', 'Stop'].includes(String(event['hook_event'])),
    );
    expect(commands.length).toBeGreaterThan(0);
    for (const event of commands) {
      expect(event['outcome'], JSON.stringify(event)).toBe('success');
      expect(event['exit_code']).toBe(0);
    }
  }, 120_000);
});
