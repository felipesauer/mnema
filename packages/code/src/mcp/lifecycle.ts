/**
 * When a stdio connection ENDS — and how a server hears about it.
 *
 * The SDK does not tell it. `StdioServerTransport.start()` registers `data` and
 * `error` on stdin and nothing else; its `onclose` fires only from inside its own
 * `close()`, which nothing on the server side ever calls. So a server that hung its
 * cleanup on `transport.onclose` had cleanup with no caller: measured over six exit
 * modes — SIGKILL, SIGTERM, SIGINT, the client's transport closing, the client
 * closing, and a plain EOF on stdin — the hook fired in none of them. It was not
 * "a run leaks when the host kills us"; it was every session, always.
 *
 * The signals a stdio server actually gets are the PROCESS's, so that is where the
 * triggers go:
 *
 *   - `stdin` reaching `end` (or `close`) — the client hung up its pipe. This is the
 *     ordinary way a host disconnects, and the one the transport already reads bytes
 *     from without ever reporting the end of them.
 *   - `SIGTERM` / `SIGINT` — the host asked the process to stop. Installing a handler
 *     for these SUPPRESSES the default termination, so the handler has to finish the
 *     job: it closes, removes itself, and re-raises the same signal, which lets the
 *     default action set the exit status the host expects (128 + n). Exiting 0
 *     instead would report a clean shutdown where the truth is a termination.
 *
 * `SIGKILL` is deliberately absent, because it cannot be caught. A session killed
 * that way still leaves its run open, and that is stated rather than papered over:
 * the alternative would be a sweeper deciding on its own that some other session's
 * run is dead, and two sessions provably alive at once falsify every rule that could
 * make that call.
 *
 * THE CLOSE IS SYNCHRONOUS, start to finish. It is the last chance to write, and a
 * process that has been asked to stop does not come back from an `await` — the
 * pending continuation dies with it, and the write dies in the continuation. So this
 * module takes a synchronous closer and never wraps it in a promise. (It is the same
 * reason `ensureRun` may not yield: the guarantee is that the function never cedes.)
 *
 * ONCE, whatever fires. EOF and a signal regularly arrive together (a host that
 * closes the pipe and then terminates the child does both), and a run has exactly
 * one end: a second `run.ended` for a run already closed is refused by the operation,
 * but relying on that would mean relying on a refusal to keep the record honest. The
 * guard is here instead, where the reason for it is visible.
 */

/**
 * The process facilities the triggers attach to — injected, so the wiring can be
 * exercised without signalling the test runner or closing its stdin.
 *
 * It is the narrowest surface that covers the job: subscribe, unsubscribe, deliver a
 * signal to ourselves, and subscribe to stdin. The real one is
 * {@link processLifecycle}.
 */
export interface Lifecycle {
  /** Subscribe to a process event (a signal name). */
  readonly on: (event: string, handler: () => void) => void;
  /** Unsubscribe — used before re-raising, so the default action can run. */
  readonly off: (event: string, handler: () => void) => void;
  /** Deliver a signal to this process. */
  readonly raise: (signal: NodeJS.Signals) => void;
  /** Subscribe to an event on the process's stdin. */
  readonly onStdin: (event: string, handler: () => void) => void;
}

/** The real process: what {@link armSessionClose} attaches to in production. */
export const processLifecycle: Lifecycle = {
  on: (event, handler) => {
    process.on(event, handler);
  },
  off: (event, handler) => {
    process.off(event, handler);
  },
  raise: (signal) => {
    process.kill(process.pid, signal);
  },
  onStdin: (event, handler) => {
    process.stdin.on(event, handler);
  },
};

/** The signals a host uses to ask a server to stop, and that a process can catch. */
const CATCHABLE_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

/**
 * Arms every way this process can learn its connection has ended, and returns the
 * guarded closer they all call.
 *
 * The returned function is safe to call any number of times and from anywhere else
 * that learns of the end first — the SDK's own `transport.onclose`, say, which stays
 * wired for the day it starts firing. Only the first call reaches `close`.
 *
 * A signal handler closes, unsubscribes itself, and re-raises: the connection's
 * record is settled first, then the process ends the way the host asked it to.
 */
export function armSessionClose(input: {
  /** Ends the session. Synchronous, and called at most once. */
  readonly close: () => void;
  /** The process facilities to attach to; defaults to the real process. */
  readonly lifecycle?: Lifecycle;
}): () => void {
  const lifecycle = input.lifecycle ?? processLifecycle;
  let closed = false;
  const closeOnce = (): void => {
    if (closed) return;
    closed = true;
    input.close();
  };

  // The client hung up. Both events, because which one arrives depends on how the
  // other end let go of the pipe, and the guard above makes hearing both harmless.
  lifecycle.onStdin('end', closeOnce);
  lifecycle.onStdin('close', closeOnce);

  for (const signal of CATCHABLE_SIGNALS) {
    const handler = (): void => {
      closeOnce();
      // Off, then re-raise: with our handler gone the signal's default action runs,
      // so the process dies of the signal it was sent and reports 128 + n. Keeping
      // the handler on would swallow the second delivery too, and the process would
      // hang holding a closed session.
      lifecycle.off(signal, handler);
      lifecycle.raise(signal);
    };
    lifecycle.on(signal, handler);
  }

  return closeOnce;
}
