/**
 * A synchronous sleep, for the two waits on the writing path: a writer waiting for a busy
 * tail (`tail-lock.ts`) and a reader waiting for an installation id another process is still
 * writing (`keystore.ts`). Everything on that path is synchronous, so its waits have to be too.
 *
 * `Atomics.wait` on a cell nothing ever notifies parks the thread for the time given, without
 * spinning a core. One cell for the module, because nothing is ever written to it.
 */

const PARKED = new Int32Array(new SharedArrayBuffer(4));

export function sleepSync(ms: number): void {
  Atomics.wait(PARKED, 0, 0, ms);
}
