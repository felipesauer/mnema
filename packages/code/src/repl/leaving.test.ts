/**
 * THE HOOKS, ON A PROCESS THIS FILE OWNS — the mechanism, without a process to kill.
 *
 * `tests/the-console-on-ink.test.ts` proves the PROPERTY in a real pty: whichever way a
 * session ends, the terminal comes back. This is the other half, and it exists because
 * of what that pty measured. Taking the hooks away does NOT turn those cases red today —
 * the layout library registers a teardown of its own, three levels down, on the same
 * exit and the same signals. So the pty says the promise is kept and cannot say by whom.
 *
 * That is exactly the shape a guarantee rots in. The hooks are this product's because a
 * promise made out of somebody else's transitive dependency is not a promise; and since
 * nothing else can see them, they are asserted here, on a port this file hands over:
 * every way out is hooked, the restore runs, and a signal still kills the process it was
 * sent to.
 */

import { describe, expect, it } from 'vitest';
import { armLeaving, EXIT_SIGNALS, type Leaving } from './leaving.js';

/** A process of this file's own: what was hooked, and what was raised. */
function aProcess(): {
  readonly port: Leaving;
  readonly hooked: Map<string, (() => void)[]>;
  readonly raised: string[];
  readonly fire: (event: string) => void;
} {
  const hooked = new Map<string, (() => void)[]>();
  const raised: string[] = [];
  const port: Leaving = {
    on: (event, listener) => {
      hooked.set(event, [...(hooked.get(event) ?? []), listener]);
    },
    off: (event, listener) => {
      hooked.set(
        event,
        (hooked.get(event) ?? []).filter((each) => each !== listener),
      );
    },
    raise: (signal) => raised.push(signal),
  };
  return {
    port,
    hooked,
    raised,
    fire: (event) => {
      for (const listener of [...(hooked.get(event) ?? [])]) listener();
    },
  };
}

/** Which events have a listener on them right now. */
function listening(hooked: Map<string, (() => void)[]>): string[] {
  return [...hooked.entries()]
    .filter(([, listeners]) => listeners.length > 0)
    .map(([event]) => event)
    .sort();
}

describe('every way this process can stop is hooked', () => {
  it('is the normal end and every signal the product declares, and nothing else', () => {
    const { port, hooked } = aProcess();
    armLeaving(port, () => undefined);
    expect(listening(hooked)).toEqual(['exit', ...EXIT_SIGNALS].sort());
    // The set is not empty, and it is the declaration's rather than a list here: a
    // signal added to it arrives hooked, and one removed cannot leave a dead listener.
    expect(EXIT_SIGNALS.length).toBeGreaterThanOrEqual(4);
  });

  it('gives the terminal back on the normal end', () => {
    const { port, fire } = aProcess();
    let restored = 0;
    armLeaving(port, () => {
      restored++;
    });
    fire('exit');
    expect(restored).toBe(1);
  });

  it('gives it back on a signal, and then dies of that signal', () => {
    // Restore first and raise second, and the disarm between them is what makes the
    // raise fatal: with ours still listening, the process would answer its own signal
    // and go on living.
    for (const signal of EXIT_SIGNALS) {
      const { port, hooked, raised, fire } = aProcess();
      const order: string[] = [];
      armLeaving(port, () => order.push('restored'));
      fire(signal);
      expect(order, signal).toEqual(['restored']);
      expect(raised, signal).toEqual([signal]);
      // Nothing of ours is listening any more, so the default disposition applies.
      expect(listening(hooked), signal).toEqual([]);
    }
  });

  it('takes its listeners off when the session ends without the process ending', () => {
    // The word that leaves closes the SESSION and the process goes on. A second session in the same
    // process would otherwise find the first one's hooks still armed, and give back a
    // terminal that was already given back.
    const { port, hooked } = aProcess();
    const disarm = armLeaving(port, () => undefined);
    disarm();
    expect(listening(hooked)).toEqual([]);
    // And disarming twice is not an error: the signal path disarms itself.
    disarm();
    expect(listening(hooked)).toEqual([]);
  });

  it('removes ITS listener and not somebody else’s', () => {
    // The port is the process. A hook that came off by event name would take down
    // whatever else the process had put there.
    const { port, hooked, fire } = aProcess();
    let elsewhere = 0;
    port.on('exit', () => {
      elsewhere++;
    });
    const disarm = armLeaving(port, () => undefined);
    disarm();
    fire('exit');
    expect(elsewhere).toBe(1);
    expect(listening(hooked)).toEqual(['exit']);
  });
});
