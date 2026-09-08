/**
 * A TAIL THIS MACHINE DID NOT WRITE, merged in the way an offline copy is.
 *
 * A waiver may never name the tail it is written to, so `tail prune` has no successful
 * invocation over a record holding one machine's tail alone. Every test that exercises it
 * for real has to put somebody else's tail there first, and the shape a person would use
 * is the shape this uses: copy the tail directory and the PUBLIC half of the key that
 * signed it, and throw the other machine away.
 *
 * IT WAS WRITTEN OUT ONCE AND A SECOND CASE NEEDED IT, which is the shape this bench keeps
 * paying for — two spellings of one fixture is how one of them quietly stops producing
 * what its caller assumes. It came out of `every-verb-says-if-it-writes.test.ts`, where
 * the surface is exercised verb by verb, and the second caller is the guard over the run
 * a write is pinned to, which has to make the same verb succeed before it can show a
 * refused run stopping it.
 */

import { cpSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { catalogUpcasters, openChainForWriting } from '@mnema/chain';
import { createTask } from '@mnema/core/write';

/**
 * Writes a tail on `machine`, merges it into the tree at `into`, and answers with its id.
 *
 * The machine itself is removed afterwards, so nothing left behind is inside the window a
 * caller measures across an invocation — what remains is the merged copy, which is part
 * of the project being exercised.
 */
export function mergeAForeignTail(into: string, machine: string): string {
  const writer = openChainForWriting(machine, { keyRoot: machine });
  const created = createTask(
    { writer, layout: { root: machine }, upcasters: catalogUpcasters() },
    { title: 'work another machine did' },
  );
  if (!created.ok) throw new Error(`fixture: the other machine wrote nothing: ${created.code}`);
  writer.checkpoint();
  for (const tail of readdirSync(join(machine, 'tails'))) {
    cpSync(join(machine, 'tails', tail), join(into, 'tails', tail), { recursive: true });
  }
  for (const key of readdirSync(join(machine, 'keys'))) {
    if (key.endsWith('.pub')) cpSync(join(machine, 'keys', key), join(into, 'keys', key));
  }
  rmSync(machine, { recursive: true, force: true });
  return writer.tail;
}
