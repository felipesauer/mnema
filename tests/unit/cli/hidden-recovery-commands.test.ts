import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { AgentCommand } from '@/cli/commands/agent-command.js';
import { AuditCommand } from '@/cli/commands/audit-command.js';

/**
 * A first-user's `--help` must not surface the rare deep-repair mutators
 * (they train users to reach for dangerous recovery when they don't need it);
 * `mnema doctor` is the single discovery point. The commands stay REGISTERED
 * and runnable by name — hiding only removes them from help — so an existing
 * script or a doctor pointer still works. The reliable, API-stable signal is
 * the group's help text: a hidden subcommand is absent from it while a visible
 * one is present, and every command (hidden or not) is still registered.
 */
function groupHelp(
  register: (p: Command) => void,
  group: string,
): { help: string; names: string[] } {
  const program = new Command();
  register(program);
  const grp = program.commands.find((c) => c.name() === group);
  if (grp === undefined) throw new Error(`group ${group} not registered`);
  return { help: grp.helpInformation(), names: grp.commands.map((c) => c.name()) };
}

const HIDDEN_AUDIT = ['reattest', 'reconcile', 'accept-truncation', 'diagnose', 'repair'];
const VISIBLE_AUDIT = ['query', 'verify'];

describe('recovery-command help visibility', () => {
  it('hides the rare audit recovery mutators from help but keeps them registered', () => {
    const { help, names } = groupHelp((p) => new AuditCommand().register(p), 'audit');
    for (const name of HIDDEN_AUDIT) {
      expect(names, `${name} must still be registered (runnable by name)`).toContain(name);
      expect(help, `${name} must be absent from help`).not.toContain(name);
    }
  });

  it('keeps query and verify visible in help (CI / everyday use)', () => {
    const { help } = groupHelp((p) => new AuditCommand().register(p), 'audit');
    for (const name of VISIBLE_AUDIT) expect(help).toContain(name);
  });

  it('hides agent close-orphans but keeps inspect/diff visible', () => {
    const { help, names } = groupHelp((p) => new AgentCommand().register(p), 'agent');
    expect(names, 'close-orphans must still be registered').toContain('close-orphans');
    expect(help, 'close-orphans must be absent from help').not.toContain('close-orphans');
    for (const name of ['inspect', 'diff']) expect(help).toContain(name);
  });
});
