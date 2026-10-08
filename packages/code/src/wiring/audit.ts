/**
 * The `mnema audit` wiring: the questions an auditor asks of the record, as one group.
 *
 * `audit accountability` (who authorized what), `audit antipatterns` (recurring shapes) and
 * `audit exposure` (what is shaped like a credential) are three subcommands of one verb, and
 * the group is what the agent's surface already calls them: `audit_accountability`,
 * `audit_antipatterns`, `audit_exposure`. Each is declared in its own file, the way every
 * verb is, and hung here.
 *
 * The group does nothing on its own: a bare `mnema audit` prints its help, and a word it has
 * no command for is refused in the product's voice (`one-voice-for-a-no.test.ts`). It takes
 * no flags of its own, so every flag a line carries belongs to the subcommand it follows.
 *
 * It is a READ in the same strict sense each member is: every one of them folds the present
 * trees' tails and appends nothing.
 */

import type { Command } from 'commander';
import { registerAccountability } from './accountability.js';
import { registerAntipatterns } from './antipatterns.js';
import { registerExposure } from './exposure.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema audit` on the program, with the three readings under it. */
export function registerAudit(program: Command, wiring: Wiring): Declared {
  const audit = program
    .command('audit')
    .description(
      'ask the record who authorized what, what recurs, and what looks like a credential',
    );
  registerAccountability(audit, wiring);
  registerAntipatterns(audit, wiring);
  registerExposure(audit, wiring);
  return readsTheRecord(audit);
}
