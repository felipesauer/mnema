import { describe, expect, it } from 'vitest';

import { UpcasterError, UpcasterRegistry, type VersionedEvent } from './upcaster.js';

/**
 * The catalog currently has only v1 of each kind, so its real upcaster ladder
 * is empty. The registry takes an injectable latest-version map, so these tests
 * drive the walk against a taller synthetic ladder — proving the multi-step
 * logic a future version bump will depend on, not just the zero-step path.
 */
describe('UpcasterRegistry', () => {
  it('returns an already-latest event unchanged (zero steps, real catalog)', () => {
    const reg = new UpcasterRegistry();
    const event: VersionedEvent = { kind: 'task.transitioned', v: 1, payload: {} };
    expect(reg.upcast(event)).toBe(event);
  });

  it('throws on an unknown kind', () => {
    const reg = new UpcasterRegistry();
    expect(() => reg.upcast({ kind: 'nope.gone', v: 1 })).toThrow(UpcasterError);
  });

  it('throws when an event is ahead of the known latest (needs a newer catalog)', () => {
    const reg = new UpcasterRegistry();
    expect(() => reg.upcast({ kind: 'task.transitioned', v: 2 })).toThrow(/ahead of the known/);
  });

  it('refuses to register two upcasters for the same rung', () => {
    const reg = new UpcasterRegistry();
    const step = (e: VersionedEvent): VersionedEvent => ({ ...e, v: e.v + 1 });
    reg.register({ kind: 'x.kind', from: 1 }, step);
    expect(() => reg.register({ kind: 'x.kind', from: 1 }, step)).toThrow(/already registered/);
  });

  describe('multi-step walk against an injected taller ladder', () => {
    // A synthetic kind whose latest is 3.
    const latest = { 'x.kind': 3 };

    it('applies every rung in order to reach the latest', () => {
      const seen: number[] = [];
      const reg = new UpcasterRegistry(latest)
        .register({ kind: 'x.kind', from: 1 }, (e) => {
          seen.push(e.v);
          return { ...e, v: 2, one: true };
        })
        .register({ kind: 'x.kind', from: 2 }, (e) => {
          seen.push(e.v);
          return { ...e, v: 3, two: true };
        });

      const result = reg.upcast({ kind: 'x.kind', v: 1, base: 'yes' }) as unknown as {
        v: number;
        base: string;
        one: boolean;
        two: boolean;
      };

      expect(seen).toEqual([1, 2]);
      expect(result.v).toBe(3);
      expect(result.base).toBe('yes');
      expect(result.one).toBe(true);
      expect(result.two).toBe(true);
    });

    it("starts from the event's own version, not always from v1", () => {
      const seen: number[] = [];
      const reg = new UpcasterRegistry(latest)
        .register({ kind: 'x.kind', from: 1 }, (e) => {
          seen.push(1);
          return { ...e, v: 2 };
        })
        .register({ kind: 'x.kind', from: 2 }, (e) => {
          seen.push(2);
          return { ...e, v: 3 };
        });

      reg.upcast({ kind: 'x.kind', v: 2 });
      expect(seen).toEqual([2]);
    });

    it('throws on a gap in the ladder before the latest is reached', () => {
      const reg = new UpcasterRegistry(latest).register({ kind: 'x.kind', from: 1 }, (e) => ({
        ...e,
        v: 2,
      }));
      // No rung from 2 → 3.
      expect(() => reg.upcast({ kind: 'x.kind', v: 1 })).toThrow(/no upcaster for x\.kind@2/);
    });

    it('detects a step that does not raise the version by exactly one', () => {
      const reg = new UpcasterRegistry(latest).register({ kind: 'x.kind', from: 1 }, (e) => ({
        ...e,
        v: e.v, // no-op: would loop forever without the guard
      }));
      expect(() => reg.upcast({ kind: 'x.kind', v: 1 })).toThrow(/expected 2/);
    });
  });
});
