/**
 * WHICH FILE OF A TREE IS THE CACHE — the one path a read of the command line may leave behind,
 * and the one a whole-sandbox digest must not count as the read having written.
 *
 * Every guard that proves "a read writes nothing" does it by digesting the whole sandbox before
 * and after, and that was true of every read while the projection was held in memory. The
 * command line keeps it in the tree now (`CacheOptions.persist`, `projectionCachePath`), under
 * `locks/` where git already looks away, so a read of a tree that has tails leaves
 * `locks/projection.db` and its journal beside it. That is not the record: it is derived, it can
 * be deleted at no cost to any answer, and a clone never carries it.
 *
 * ONE PATH IS EXCUSED AND NO OTHER, and it is excused by its shape rather than by "anything under
 * `locks/`": a read that left a different file there, or touched the tails, a key or the
 * `.gitignore`, would still be accused. That the cache is the ONLY thing a read adds is held where
 * it is measured over the real binary (`the-record-is-kept-between-reads.test.ts`).
 */

/** The cache a read leaves in a tree — `locks/projection.db`, and the files SQLite keeps beside it. */
export function isTheDerivedCache(path: string): boolean {
  return /(?:^|[\\/])locks[\\/]projection\.db(?:-wal|-shm|-journal)?$/.test(path);
}
