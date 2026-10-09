/**
 * AN EDITOR HOLDS OR REFUSES THE WRITE, in the real VS Code: where a rule of the record refuses a
 * path, the plugin's command answers `deny`, the file is not created and the model is handed the
 * rule that refused it; where a rule asks for a person, the same command answers `ask`, and the
 * agent stops on a confirmation and creates nothing.
 *
 * WHAT IS HELD HERE AND WHAT IS NOT. The product's half — what `mnema before-a-write --host vscode`
 * answers for each kind of rule — is `a-rule-that-refuses-a-write.test.ts` and
 * `a-host-that-runs-commands-asks-for-a-person.test.ts`. What the editor does with the answer is the
 * editor's, and it is read here with the real editor: the plugin is loaded from its own directory, the
 * model is a stand-in extension, and the file that does not appear and what the model is handed are
 * read off what the editor did. A person at the confirmation, deciding, and what the screen shows them,
 * are NOT read here and are held by nothing in this tree.
 *
 * THE CONTROL IS A PATH A RULE ONLY GOVERNS. The editor creates that file, so "the file did not
 * appear" is the plugin's answer and not an editor that writes nothing.
 */

import { describe, expect, it } from 'vitest';
import { ruleAt, theChannelFactsOf } from './support/the-record-to-stand-on.js';
import { anEditorForEachCase, theResultTheModelWasHanded } from './support/the-vscode.js';

describe('an editor holds or refuses the write', () => {
  const start = anEditorForEachCase();

  it('deny: the file is not created and the model reads the rule that refused it', async () => {
    let rule = '';
    const session = await start({
      project: (project) => {
        rule = ruleAt(project, 'Billing is frozen', 'src/frozen', 'refuses-a-write');
      },
      target: 'src/frozen/invoice.ts',
    });
    expect(session.written).toBe(false);
    const handed = theResultTheModelWasHanded(session);
    expect(handed, 'the editor never asked the model again').toBeDefined();
    expect(handed).toContain('refuses a write at src/frozen/invoice.ts');
    expect(handed).toContain(rule);
    // The refusal was recorded by the plugin's command, as the fact it is.
    expect(theChannelFactsOf(session.project, session.home)).toMatchObject({
      'channel.refused': 1,
      'channel.asked': 0,
    });
    // VS Code ran the plugin's own file and not Codex's: the gate it ran is VS Code's, and no
    // command it started named Codex — the opening's included.
    const calls = session.calls();
    expect(calls).toContain('before-a-write --host vscode');
    expect(calls.filter((call) => call.includes('--host codex'))).toEqual([]);
  }, 240_000);

  it('ask: the agent stops on a confirmation, creates nothing and does not go on', async () => {
    const session = await start({
      project: (project) => {
        ruleAt(project, 'Ledger changes need finance', 'src/ledger', 'asks-for-a-person');
      },
      target: 'src/ledger/entry.ts',
    });
    expect(session.held).toBe(true);
    expect(session.written).toBe(false);
    // Nothing was handed back to the model: the call is still waiting for a person.
    expect(session.requests).toHaveLength(1);
    expect(theChannelFactsOf(session.project, session.home)).toMatchObject({
      'channel.asked': 1,
      'channel.refused': 0,
    });
  }, 240_000);

  it('control: a path a rule only governs is created, and the plugin said nothing to stop it', async () => {
    const session = await start({
      project: (project) => {
        ruleAt(project, 'Bill in UTC', 'src/billing', 'governs');
      },
      target: 'src/billing/invoice.ts',
    });
    expect(session.written).toBe(true);
    expect(session.held).toBe(false);
    expect(theChannelFactsOf(session.project, session.home)).toMatchObject({
      'channel.refused': 0,
      'channel.asked': 0,
    });
  }, 240_000);
});
