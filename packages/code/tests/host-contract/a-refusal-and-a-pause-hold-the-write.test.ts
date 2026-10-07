/**
 * A REFUSAL AND A PAUSE HOLD THE WRITE, in the real host: where a rule refuses a path the file is
 * not written and the model is handed the rule that refused it, and where a rule asks for a person
 * the write is held and the model is told who asked. Where one path is both, the refusal wins.
 *
 * WHAT IS HELD HERE AND WHAT IS NOT. The product's half — which door answers `deny` and which
 * answers `ask`, and the words — is `a-rule-that-refuses-a-write.test.ts` and
 * `the-record-asks-for-a-person.test.ts`. What the host does with an answer is the host's, and it
 * is read here with the real binary: the file that does not appear, and the error the host hands
 * back as the result of the call. The session is headless, so there is nobody to ask: the host
 * refuses a call a hook answered `ask` for, and the reason it hands the model is the asking
 * rule's. A person at a screen deciding is NOT read here, and not held anywhere in this tree.
 *
 * THE CONTROLS ARE THE POINT. A write at a path that only governs is let through in
 * `the-rules-arrive-beside-the-write.test.ts`, so "the file did not appear" cannot be a host that
 * writes nothing; and what the model is handed differs between the two answers, so a pause does
 * not read as a refusal.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  aHostForEachCase,
  thePermissionDecisionsOf,
  theResultOfTheCall,
} from './support/the-host.js';
import { alsoAt, decide, ruleAt } from './support/the-record-to-stand-on.js';
import { writeTo } from './support/the-stand-in-api.js';

describe('a refusal and a pause hold the write', () => {
  const start = aHostForEachCase();

  it('deny: the file is not written and the model reads the rule that refused it', async () => {
    let rule = '';
    const session = await start({
      project: (project) => {
        rule = ruleAt(project, 'Billing is frozen', 'src/billing', 'refuses-a-write');
      },
      call: writeTo('src/billing/invoice.ts'),
    });
    expect(existsSync(join(session.project, 'src/billing/invoice.ts'))).toBe(false);
    const result = theResultOfTheCall(session);
    expect(result?.isError).toBe(true);
    expect(result?.text).toContain('refuses a write at src/billing/invoice.ts');
    expect(result?.text).toContain(rule);
    // The plugin answered `deny`, and the host took it as a hook that stopped the call.
    expect(thePermissionDecisionsOf(session, 'PreToolUse')).toEqual(['deny']);
    expect(result?.text).toContain('PreToolUse:Write hook error');
    // The limit the product declares reaches the model in the same words as the refusal.
    expect(result?.text).toContain('not the shell');
  }, 120_000);

  it('ask: the write is held, and the model is told which rule asked for a person', async () => {
    let rule = '';
    const session = await start({
      project: (project) => {
        rule = ruleAt(project, 'Ledger changes need finance', 'src/ledger', 'asks-for-a-person');
      },
      call: writeTo('src/ledger/entry.ts'),
    });
    expect(existsSync(join(session.project, 'src/ledger/entry.ts'))).toBe(false);
    const result = theResultOfTheCall(session);
    expect(result?.isError).toBe(true);
    expect(result?.text).toContain('asks that a person look at src/ledger/entry.ts');
    expect(result?.text).toContain(rule);
    expect(result?.text).not.toContain('refuses a write');
    // The plugin answered `ask`, and with nobody to ask the host held the call. That is not a hook
    // error, so the two answers do not read alike to the model.
    expect(thePermissionDecisionsOf(session, 'PreToolUse')).toEqual(['ask']);
    expect(result?.text).not.toContain('hook error');
  }, 120_000);

  it('both at one path: the refusal wins, and nobody is named as asked', async () => {
    let refusing = '';
    let asking = '';
    const session = await start({
      project: (project) => {
        refusing = ruleAt(project, 'Billing is frozen', 'src/billing', 'refuses-a-write');
        asking = decide(project, 'Billing changes need finance');
        alsoAt(project, asking, 'src/billing', 'asks-for-a-person');
      },
      call: writeTo('src/billing/invoice.ts'),
    });
    expect(existsSync(join(session.project, 'src/billing/invoice.ts'))).toBe(false);
    const result = theResultOfTheCall(session);
    expect(result?.isError).toBe(true);
    expect(result?.text).toContain(refusing);
    expect(result?.text).not.toContain(asking);
    expect(result?.text).toContain('refuses a write');
    expect(thePermissionDecisionsOf(session, 'PreToolUse')).toEqual(['deny']);
  }, 120_000);
});
