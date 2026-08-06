/**
 * EVERY WAY THIS PROCESS CAN STOP, AND THE TERMINAL GIVEN BACK IN ALL OF THEM.
 *
 * A console takes the terminal. It puts the input in raw mode — no echo, no line editing
 * — and it hides the cursor while it draws. Neither of those is this process's state:
 * they belong to the TERMINAL, and they outlive the process that set them. A session
 * that stops without undoing them leaves the caller's shell with no echo and no caret,
 * which is the worst defect this frontier can produce and the worst precisely because
 * the program that caused it is already gone by the time anybody sees it.
 *
 * SO THE RULE IS ABOUT A SET, and the set is the reason this is a file rather than three
 * lines at the bottom of the loop: it is not "give the terminal back when the session
 * ends", it is "give it back on EVERY way this process ends". They are:
 *
 *   - `exit` — the normal end, and it covers more than it looks like. Leaving by the
 *     word, the input reaching its end, a `process.exit` anywhere, and an UNCAUGHT
 *     EXCEPTION all arrive here: node emits it before the process goes, even for the
 *     throw nobody handled.
 *   - a SIGNAL. Node does NOT emit `exit` for one — the default disposition ends the
 *     process without running anything of ours. Measured, in a pty, against a control
 *     that takes the terminal and hooks nothing: killed with `SIGHUP` it leaves the
 *     device with `-echo -icanon` and the cursor hidden, and the next command a caller
 *     types is invisible. Each signal of {@link EXIT_SIGNALS} is therefore hooked,
 *     restored, unhooked and RAISED AGAIN — so the process still dies of what it was
 *     killed by, and a parent still sees "terminated by signal" rather than an exit code
 *     we invented.
 *
 * A PREMISE THIS FILE WAS WRITTEN UNDER WAS FALSIFIED, and saying which one is the point
 * of writing it down. The premise was that the layout library undoes NOTHING for us, so
 * every path here would be bare without this file. Measured in a pty, that is wrong: the
 * library registers its own teardown on `exit` and on the signals, so on those paths it
 * also leaves the mode and the cursor as it found them. What survives the measurement is
 * why this file still exists, and it is two things rather than one:
 *
 *   - THE NORMAL RETURN IS NOT AN EXIT. `.exit` and the end of input close the SESSION
 *     and the process goes on — commander returns, the entry finishes, and anything
 *     after it runs in a terminal that must already be the caller's again. No hook of a
 *     library's fires there, because nothing is exiting.
 *   - A PROMISE MADE OF SOMEBODY ELSE'S TRANSITIVE DEPENDENCY IS NOT A PROMISE. What
 *     restores today is a package three levels down from a package we chose for LAYOUT.
 *     The guarantee is this product's, so the hook is this product's, and the pty cases
 *     are what hold whoever does the work to it.
 *
 * WHAT IS NOT COVERED, said out loud so a pass is not read as covering it: `SIGKILL` and
 * `SIGSTOP` cannot be caught by anyone, and a process the kernel destroys leaves whatever
 * it left. That is the same for `vim`, `htop` and every other program that takes the
 * terminal, and the remedy is the same one — `reset`.
 */

/**
 * The signals that END this program, and that a caller or a supervisor actually sends.
 *
 * All four terminate by default and all four can be caught, which is what makes them the
 * set: a signal whose default is to be ignored needs nothing from us, and one that cannot
 * be caught would be a promise this file could not keep. `SIGINT` and `SIGQUIT` are here
 * for the SIGNAL and not for the keystroke — while the session is reading keys the
 * terminal is in raw mode, so Ctrl-C and Ctrl-\ arrive as BYTES the console answers
 * (Ctrl-C abandons the line being typed and the session lives on). What reaches here is
 * `kill -INT`.
 */
export const EXIT_SIGNALS = ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGTERM'] as const;

/** The event node emits before the process goes, whichever way it is going. */
const ON_EXIT = 'exit';

/**
 * The part of the process a leaving session touches, and the whole of it.
 *
 * It is a port for the reason every other fact about the process on this surface is one:
 * the entry is where the process is. A module that reached for the global would be a
 * module no test could arm twice, and this one is armed and disarmed once per session.
 */
export interface Leaving {
  /** Listen for an event or a signal. */
  readonly on: (event: string, listener: () => void) => void;
  /** Stop listening — the same listener, so nothing else's is removed. */
  readonly off: (event: string, listener: () => void) => void;
  /** Send this signal to this process again, now that nothing of ours answers it. */
  readonly raise: (signal: string) => void;
}

/** The process itself, as the port above. What the entry hands a real session. */
export const leavingProcess: Leaving = {
  on: (event, listener) => {
    process.on(event, listener);
  },
  off: (event, listener) => {
    process.off(event, listener);
  },
  raise: (signal) => {
    process.kill(process.pid, signal as NodeJS.Signals);
  },
};

/**
 * Hooks `restore` to every way the process can stop, and answers with how to unhook it.
 *
 * `restore` must be IDEMPOTENT and it must be SYNCHRONOUS. Idempotent because two of
 * these can fire on one death — a signal arriving while the normal path unwinds — and
 * synchronous because an `exit` listener is the last code that runs: a promise scheduled
 * there is a promise nobody will ever await, and the terminal would stay taken.
 *
 * The disarm is returned rather than being another method because the session's normal
 * end has to take these listeners OFF: the hooks belong to one open console, and a
 * second session in the same process would otherwise give back a terminal the first one
 * already gave back.
 */
export function armLeaving(leaving: Leaving, restore: () => void): () => void {
  const hooked: { readonly event: string; readonly listener: () => void }[] = [];

  function disarm(): void {
    for (const { event, listener } of hooked) leaving.off(event, listener);
    hooked.length = 0;
  }

  function hook(event: string, listener: () => void): void {
    leaving.on(event, listener);
    hooked.push({ event, listener });
  }

  hook(ON_EXIT, restore);
  for (const signal of EXIT_SIGNALS) {
    hook(signal, () => {
      restore();
      // Ours are off before the signal goes again, so node applies the default
      // disposition and the process dies of what killed it. Restoring first and raising
      // second is the order that matters: after the raise, nothing of ours runs.
      disarm();
      leaving.raise(signal);
    });
  }

  return disarm;
}
