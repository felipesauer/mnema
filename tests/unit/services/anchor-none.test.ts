import { describe, expect, it, vi } from 'vitest';

import { AnchorRegistry } from '@/services/anchor/anchor-registry.js';
import { NONE_PROVIDER, NoneAnchorProvider } from '@/services/anchor/none-anchor-provider.js';

describe('NoneAnchorProvider', () => {
  it('is registered under "none"', () => {
    const provider = new NoneAnchorProvider();
    expect(provider.name).toBe(NONE_PROVIDER);
    expect(new AnchorRegistry().register(provider).resolve('none')).toBe(provider);
  });

  it('verify() reports not-anchored (a neutral disabled state, never an error)', async () => {
    const result = await new NoneAnchorProvider().verify();
    expect(result.state).toBe('not-anchored');
    expect(result.detail).toMatch(/disabled/i);
  });

  it('stamp() does no network or filesystem I/O', async () => {
    // Spy on the obvious side-channel APIs a real provider would touch.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('none must not fetch');
    });
    const provider = new NoneAnchorProvider();
    const receipt = await provider.stamp('a'.repeat(64));
    // No fetch happened, and the receipt carries no proof.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(receipt.blob).toBe('');
    expect(receipt.status).toBe('failed'); // never a phantom 'anchored'
    fetchSpy.mockRestore();
  });
});
