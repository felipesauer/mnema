/**
 * The `mnema init` wiring: what it declares, and what it prints.
 *
 * `mnema init` — establish a project in the current directory, or say that one is
 * already there. It is the only verb that can CREATE this machine's identity, so it
 * is also the only one with something to report about keys.
 *
 * It used to print two more lines — `registered in the project index` on a founding
 * and `index entry re-asserted` on a second run — about a machine-local index that
 * nothing in the product ever read. Reporting an effect nobody consumes is worse
 * than the dead write itself, because the person acts on what they are told; both
 * the write and the two lines are gone. `cli.writes.golden.txt` is what holds every
 * line this verb prints, so their absence is pinned there byte for byte.
 */

import type { Command } from 'commander';
import type { InitResult } from '../commands/init.js';
import { fact } from '../presentation/detail.js';
import type { Render } from '../presentation/render.js';
import { here } from './context.js';
import type { CliIo } from './io.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

/**
 * The name this verb is registered under, in one place.
 *
 * It is read rather than retyped for the reason `REPL_VERB` is (`wiring/repl.ts`): the bare
 * name offers this verb as the first thing to do in a directory with no project, and it
 * names it BY IDENTITY — so the door cannot end up pointing at a word this program no longer
 * routes.
 */
export const INIT_VERB = 'init';

/** Registers `mnema init` on the program. */
export function registerInit(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const init = program
    .command(INIT_VERB)
    .description('establish a mnema project in the current directory')
    .action(async () => {
      const { runInit } = await import('../commands/init.js');
      const { onOneLine } = await import('./on-one-line.js');
      const result = runInit(here());
      // The ROOT is a directory this run discovered from the cwd, and a directory name
      // is the value this whole class was first measured on: a checkout, an archive or
      // a dependency can carry a newline in one and nobody typed it. The anchor beside
      // it cannot — `mnid:` and 64 hex (see {@link onOneLine}).
      if (result.created) {
        io.out(onOneLine`Initialized mnema project at ${result.root}`);
        io.out(render(fact(onOneLine`identity: ${result.anchor}`)));
        await reportIdentity(result.identity, io, render);
      } else {
        io.out(onOneLine`Already a mnema project at ${result.root} — nothing to found.`);
        io.out(render(fact(onOneLine`identity: ${result.anchor}`)));
      }
    });
  return mutatesTheRecord(init);
}

/**
 * Reports what establishing the identity did, on the one occasion it matters:
 * the run that created the tree.
 *
 * The line that earns its place is the backup key's — a key the person cannot
 * regenerate and cannot recover, because mnema has no central recovery. When
 * this run created it, the person is told WHERE the private half is and that it
 * has to leave the machine: a backup that stays on this disk is lost with the
 * disk, which is the exact loss it exists to survive. That warning is printed
 * only on the run that creates the key — repeated on every init it would become
 * noise a person learns to scroll past.
 *
 * A registered key this tree refused is always reported, never swallowed: a
 * person who believes they hold a usable backup and does not is worse off than
 * one who knows. For the same reason every OTHER key the tree enrolled is named
 * too — the backup is not the only key a roster can hold, and enrolling one
 * changes WHO may speak for the identity. That is not something to learn by
 * reading the chain later.
 */
async function reportIdentity(
  identity: InitResult['identity'],
  io: CliIo,
  render: Render,
): Promise<void> {
  if (identity === undefined) return;
  // Loaded here rather than handed in: this is the branch that has a path to print, and
  // a parameter would make every caller decide again which values are an actor's.
  const { onOneLine } = await import('./on-one-line.js');
  const backup = identity.backup;
  if (backup?.created === true) {
    io.out(
      render(
        fact(
          onOneLine`backup key: created and enrolled — private half at ${backup.privateKeyPath}`,
        ),
      ),
    );
    io.out(
      render(fact('Move that file off this machine: a backup left on this disk is lost with it.')),
    );
  } else if (backup !== null && identity.enrolled.includes(backup.fingerprint)) {
    io.out(render(fact('backup key: enrolled in this project')));
  }
  for (const fingerprint of identity.enrolled) {
    if (fingerprint === backup?.fingerprint) continue;
    io.out(render(fact(`key ${fingerprint} enrolled in this project`)));
  }
  for (const declined of identity.declined) {
    io.out(render(fact(`key ${declined.fingerprint} was NOT enrolled: ${declined.reason}`)));
  }
}
