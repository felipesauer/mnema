import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '@/config/config-schema.js';
import { buildAnchorRegistry } from '@/services/anchor/anchor-factory.js';

/** A minimal valid config with the given anchor provider. */
function configWith(provider: string) {
  return ConfigSchema.parse({
    version: '1.0',
    mnema_version: '0.1.0',
    project: { key: 'TEST', name: 'Test' },
    audit: {
      anchor: provider === 'rfc3161' ? { provider, tsa: 'https://tsa.example' } : { provider },
    },
  });
}

describe('buildAnchorRegistry — git is opt-in', () => {
  it('registers ONLY none by default (provider: none) — git-signed is absent', () => {
    const registry = buildAnchorRegistry(configWith('none'), '/repo');
    expect(registry.has('none')).toBe(true);
    // The git-backed provider is NOT registered, so nothing can invoke git
    // on the default path — git is strictly opt-in.
    expect(registry.has('git-signed')).toBe(false);
  });

  it('registers git-signed only when explicitly selected', () => {
    const registry = buildAnchorRegistry(configWith('git-signed'), '/repo');
    expect(registry.has('none')).toBe(true);
    expect(registry.has('git-signed')).toBe(true);
  });

  it('resolving the configured none provider never touches git-signed', () => {
    const registry = buildAnchorRegistry(configWith('none'), '/repo');
    expect(registry.resolve('none').name).toBe('none');
    // Resolving git-signed throws because it was never registered.
    expect(() => registry.resolve('git-signed')).toThrow(/unknown anchor provider/i);
  });

  it('registers rfc3161 only when explicitly selected (with a tsa url)', () => {
    const registry = buildAnchorRegistry(configWith('rfc3161'), '/repo');
    expect(registry.has('none')).toBe(true);
    expect(registry.has('rfc3161')).toBe(true);
    expect(registry.resolve('rfc3161').name).toBe('rfc3161');
  });

  it('does not register rfc3161 on the default path — network is opt-in', () => {
    const registry = buildAnchorRegistry(configWith('none'), '/repo');
    expect(registry.has('rfc3161')).toBe(false);
  });
});
