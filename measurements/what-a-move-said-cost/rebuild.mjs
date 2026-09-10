/**
 * What carrying a move's proof costs a REBUILD — one arm, one process.
 *
 * The slice that made `show`, `timeline` and the index serve a transition's `fields`
 * added work to the one path that is hot: the fold that replays a tree, the store that
 * writes the row, and the text the full-text index takes. This times it.
 *
 * ONE ARM PER PROCESS, and the arm is WHICHEVER BUILD IS INSTALLED. A module is
 * imported once per process, so two builds cannot be compared inside one; `drive.sh`
 * builds the product twice — once as it is, once with the fold's reader answering
 * "nothing carried proof", which is exactly the state the product was in before this
 * slice — and swaps the built files IN PLACE between processes, alternating.
 *
 * IN PLACE and not from a copy elsewhere: a `packages/*​/dist` copied outside the
 * workspace cannot resolve `@mnema/chain`, because the resolution is the workspace's
 * symlinks and not the directory's contents.
 *
 * THE RECORD IS WRITTEN ONCE AND SHARED. Both arms replay the same bytes, so nothing
 * here compares two records of different sizes: a record with notes against one without
 * would have measured the notes' own bytes through the parser and called it the fold's
 * cost. The writer is unchanged by the mutation, so which arm wrote it does not matter.
 *
 * Run through `drive.sh`, never on its own — a single number with nothing to compare it
 * to is not a measurement.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [recordRoot, moves, repeats, bare] = process.argv.slice(2);
/**
 * `bare` writes the SAME number of moves carrying NO fields at all.
 *
 * It is the case a real record is mostly made of, and the claim it settles is the one
 * that matters outside this harness: a record whose moves said nothing must pay nothing.
 * Without this arm that sentence would be an assertion about a fast path nobody timed.
 */
const BARE = bare === 'bare';
const ROOT = new URL('../../packages/', import.meta.url).pathname;
const MOVES = Number(moves ?? 2000);
const REPEATS = Number(repeats ?? 7);

const { openChainForWriting, catalogUpcasters, ensureTree } = await import(
  join(ROOT, 'chain/dist/index.js')
);
const { ProjectionCache } = await import(join(ROOT, 'core/dist/index.js'));

if (!existsSync(recordRoot)) {
  mkdirSync(recordRoot, { recursive: true });
  ensureTree({ root: recordRoot });
  const w = openChainForWriting(recordRoot, { keyRoot: recordRoot });
  const id = '01a08c00-0000-7000-8000-000000000001';
  // The envelope is the writer's contract and not decoration: an append with no `at`
  // and no `who` is REFUSED, and the first version of this harness ignored the throw
  // and timed a rebuild over an empty record — 1.3 ms for two thousand events, a
  // number that could not be true. The guard below is why that cannot happen twice.
  const env = (n) => ({
    at: new Date(Date.UTC(2026, 8, 10, 0, 0, 0, 0) + n * 1000).toISOString(),
    who: 'mnid:measure',
    signerFp: 'fp-measure',
    subject: id,
  });
  w.append({ ...env(0), kind: 'task.created', v: 1, payload: { title: 'measure me' } });
  w.append({
    ...env(0),
    kind: 'task.transitioned',
    v: 1,
    payload: { from: null, to: 'IN_PROGRESS', action: 'create' },
  });
  for (let i = 0; i < MOVES; i += 1) {
    const done = i % 2 === 0;
    w.append({
      ...env(i + 1),
      kind: 'task.transitioned',
      v: 1,
      payload: done
        ? {
            from: 'IN_PROGRESS',
            to: 'DONE',
            action: 'complete',
            ...(BARE
              ? {}
              : {
                  fields: {
                    note: `pass ${i} finished, and this note is prose rather than a word`,
                  },
                }),
          }
        : {
            from: 'DONE',
            to: 'IN_PROGRESS',
            action: 'reopen',
            ...(BARE
              ? {}
              : {
                  fields: {
                    reason: `pass ${i} was wrong, and this reason is prose rather than a word`,
                  },
                }),
          },
    });
  }
  w.checkpoint();
  process.stderr.write(
    `wrote ${MOVES} moves, ${BARE ? 'none carrying anything' : 'every one carrying prose'}\n`,
  );
}

/** One rebuild, timed, over a cache of its own so nothing is warm. */
function rebuildOnce() {
  const cache = ProjectionCache.open(recordRoot, { upcasters: catalogUpcasters() });
  const started = process.hrtime.bigint();
  cache.rebuild();
  const took = Number(process.hrtime.bigint() - started) / 1e6;
  cache.close();
  return took;
}

// THE RULER SAYS WHEN IT IS BROKEN. A rebuild over a record the writer refused looks
// exactly like a very fast rebuild, and the first run of this harness reported one.
{
  const cache = ProjectionCache.open(recordRoot, { upcasters: catalogUpcasters() });
  cache.rebuild();
  const task = cache.getTask('01a08c00-0000-7000-8000-000000000001');
  const moves = task?.proof?.length ?? 0;
  cache.close();
  // `?? 0` covers the arm with the reader switched off, where no proof is projected by
  // construction; what has to hold in BOTH arms is that the task is there at all.
  if (!BARE && moves === 0 && task !== null && task !== undefined) {
    process.stdout.write('RULER BROKEN (the record has prose and the rebuild found none)\n');
    process.exit(1);
  }
  if (task === null || task === undefined) {
    process.stdout.write('RULER BROKEN (the rebuild found no task — was the record written?)\n');
    process.exit(1);
  }
  process.stderr.write(`replaying ${MOVES + 2} events; ${moves} moves carry proof here\n`);
}

const taken = [];
for (let r = 0; r < REPEATS; r += 1) taken.push(rebuildOnce());
taken.sort((a, b) => a - b);
process.stdout.write(`${taken[Math.floor(taken.length / 2)].toFixed(2)}\n`);
