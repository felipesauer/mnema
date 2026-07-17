import { describe, expect, it } from 'vitest';

import type {
  AnchorProvider,
  AnchorReceipt,
  AnchorVerifyResult,
} from '@/services/anchor/anchor-provider.js';
import { AnchorRegistry } from '@/services/anchor/anchor-registry.js';

/** A minimal conformant provider a real one must structurally satisfy. */
class FakeProvider implements AnchorProvider {
  constructor(readonly name: string) {}
  async stamp(head: string): Promise<AnchorReceipt> {
    return { provider: this.name, head, blob: `blob:${head}`, status: 'anchored' };
  }
  async verify(head: string, receipt: AnchorReceipt): Promise<AnchorVerifyResult> {
    return receipt.head === head
      ? { state: 'anchored', detail: 'ok' }
      : { state: 'broken', detail: 'head mismatch' };
  }
}

describe('AnchorRegistry', () => {
  it('resolves a registered provider by name', () => {
    const registry = new AnchorRegistry().register(new FakeProvider('fake'));
    expect(registry.resolve('fake').name).toBe('fake');
    expect(registry.has('fake')).toBe(true);
  });

  it('throws a clear error for an unknown provider name', () => {
    const registry = new AnchorRegistry().register(new FakeProvider('fake'));
    expect(() => registry.resolve('nope')).toThrow(/unknown anchor provider "nope"/i);
    // The error lists what IS registered, to aid the fix.
    expect(() => registry.resolve('nope')).toThrow(/fake/);
  });

  it('holds two providers independently', () => {
    const registry = new AnchorRegistry()
      .register(new FakeProvider('a'))
      .register(new FakeProvider('b'));
    expect(registry.resolve('a').name).toBe('a');
    expect(registry.resolve('b').name).toBe('b');
  });

  it('last registration wins for the same name (override)', () => {
    const first = new FakeProvider('dup');
    const second = new FakeProvider('dup');
    const registry = new AnchorRegistry().register(first).register(second);
    expect(registry.resolve('dup')).toBe(second);
  });

  it('a conformant provider satisfies the interface (stamp/verify round-trip)', async () => {
    const provider = new FakeProvider('fake');
    const receipt = await provider.stamp('a'.repeat(64));
    expect(receipt.provider).toBe('fake');
    expect((await provider.verify('a'.repeat(64), receipt)).state).toBe('anchored');
    expect((await provider.verify('b'.repeat(64), receipt)).state).toBe('broken');
  });
});
