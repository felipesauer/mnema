/**
 * The triggers that tell a stdio server its connection ended — and that they fire
 * exactly once.
 *
 * This is the half of the close that could not be tested before, and that is why it is
 * its own module: the previous mechanism was `transport.onclose`, installed inside
 * `connect()` on a transport `connect()` builds itself, over the real stdio — so no
 * in-process test could reach it, and the SDK never fired it either. It went six exit
 * modes without running and nothing went red.
 *
 * The lifecycle is INJECTED, so what is exercised here is the wiring itself: which
 * events are subscribed to, what happens when each fires, and what happens when two
 * fire together. The composition — that the closer really ends the session's runs on
 * disk — is proven where the session is (`mcp-session-close.test.ts`), and the whole
 * path through the real transport is proven by the six-mode probe.
 */

import { describe, expect, it } from 'vitest';
import { armSessionClose, type Lifecycle } from './lifecycle.js';

/** A process that records what was subscribed to and lets a test fire it. */
function fakeLifecycle(): Lifecycle & {
  readonly fire: (event: string) => void;
  readonly fireStdin: (event: string) => void;
  readonly subscribed: () => readonly string[];
  readonly stdinSubscribed: () => readonly string[];
  readonly raised: () => readonly string[];
} {
  const handlers = new Map<string, Set<() => void>>();
  const stdinHandlers = new Map<string, Set<() => void>>();
  const raised: string[] = [];
  const add = (map: Map<string, Set<() => void>>, event: string, handler: () => void): void => {
    const set = map.get(event) ?? new Set<() => void>();
    set.add(handler);
    map.set(event, set);
  };
  return {
    on: (event, handler) => add(handlers, event, handler),
    off: (event, handler) => {
      handlers.get(event)?.delete(handler);
    },
    raise: (signal) => {
      raised.push(signal);
    },
    onStdin: (event, handler) => add(stdinHandlers, event, handler),
    fire: (event) => {
      for (const handler of [...(handlers.get(event) ?? [])]) handler();
    },
    fireStdin: (event) => {
      for (const handler of [...(stdinHandlers.get(event) ?? [])]) handler();
    },
    // Only events that still HAVE a handler: `off` empties the set, and a fake that
    // reported the leftover key would let an unsubscribe that never happened pass.
    subscribed: () =>
      [...handlers.entries()].filter(([, set]) => set.size > 0).map(([event]) => event),
    stdinSubscribed: () =>
      [...stdinHandlers.entries()].filter(([, set]) => set.size > 0).map(([event]) => event),
    raised: () => raised,
  };
}

describe('armSessionClose — how a stdio server learns its connection ended', () => {
  it('subscribes to stdin ending and to the catchable signals, and nothing else', () => {
    const lifecycle = fakeLifecycle();
    armSessionClose({ close: () => {}, lifecycle });
    // Both stdin events: which one arrives depends on how the other end let go.
    expect([...lifecycle.stdinSubscribed()].sort()).toEqual(['close', 'end']);
    // SIGKILL is absent BY DESIGN — it cannot be caught. A session killed that way
    // still leaves its run open, and this asserts the product does not pretend
    // otherwise by installing a handler that could never run.
    expect([...lifecycle.subscribed()].sort()).toEqual(['SIGINT', 'SIGTERM']);
  });

  it.each(['end', 'close'])('closes when stdin reaches %s', (event) => {
    let closes = 0;
    const lifecycle = fakeLifecycle();
    armSessionClose({
      close: () => {
        closes += 1;
      },
      lifecycle,
    });
    lifecycle.fireStdin(event);
    expect(closes).toBe(1);
  });

  it.each(['SIGTERM', 'SIGINT'])('closes on %s, then lets the signal do its job', (signal) => {
    let closes = 0;
    const lifecycle = fakeLifecycle();
    armSessionClose({
      close: () => {
        closes += 1;
      },
      lifecycle,
    });
    lifecycle.fire(signal);
    expect(closes).toBe(1);
    // Re-raised, so the process dies of the signal it was sent and reports 128 + n
    // rather than a clean 0. Installing a handler suppresses the default action, so
    // a handler that only closed would leave the process alive and unkillable by the
    // same signal.
    expect(lifecycle.raised()).toEqual([signal]);
    // And the handler took itself off first, so the re-raise reaches the default
    // action instead of this handler again.
    expect(lifecycle.subscribed()).not.toContain(signal);
  });

  it('closes ONCE when two triggers fire together', () => {
    // The ordinary way a host disconnects: it closes the pipe AND terminates the
    // child. A run has exactly one end, and a second `run.ended` would be refused by
    // the operation — but relying on a refusal to keep the record honest is not the
    // same as not writing twice.
    let closes = 0;
    const lifecycle = fakeLifecycle();
    const closeOnce = armSessionClose({
      close: () => {
        closes += 1;
      },
      lifecycle,
    });
    lifecycle.fireStdin('end');
    lifecycle.fireStdin('close');
    lifecycle.fire('SIGTERM');
    lifecycle.fire('SIGINT');
    closeOnce();
    expect(closes).toBe(1);
    // Each signal still did its job even though the close was already done: the
    // process was asked to stop, and the guard is on the WRITE, not on the exit. In
    // a real process the FIRST re-raise ends it, so the second never arrives; here
    // nothing dies, which is why both are listed.
    expect(lifecycle.raised()[0]).toBe('SIGTERM');
  });

  it('returns a closer any other caller can share', () => {
    // The transport's own `onclose` stays wired to this. It never fires today; if a
    // future SDK starts firing it, the session must still end exactly once.
    let closes = 0;
    const lifecycle = fakeLifecycle();
    const closeOnce = armSessionClose({
      close: () => {
        closes += 1;
      },
      lifecycle,
    });
    closeOnce();
    closeOnce();
    lifecycle.fireStdin('end');
    expect(closes).toBe(1);
  });

  it('is synchronous: the close has finished before the trigger returns', () => {
    // A process that has been asked to stop does not come back from an `await`, so a
    // close reached through a promise writes nothing however early it fires. This
    // pins the shape that guarantee rests on.
    const order: string[] = [];
    const lifecycle = fakeLifecycle();
    armSessionClose({
      close: () => {
        order.push('closed');
      },
      lifecycle,
    });
    lifecycle.fireStdin('end');
    order.push('after the trigger returned');
    expect(order).toEqual(['closed', 'after the trigger returned']);
  });
});
