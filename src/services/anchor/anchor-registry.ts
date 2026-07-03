import type { AnchorProvider } from './anchor-provider.js';

/**
 * Resolves an {@link AnchorProvider} by name. Pure: registration and
 * lookup do no I/O, so constructing the registry never touches the network
 * or filesystem — providers do their work only when `stamp`/`verify` are
 * called, off the write path.
 *
 * The registry is the single seam every concrete provider plugs into; the
 * audit write path depends on none of them directly.
 */
export class AnchorRegistry {
  private readonly providers = new Map<string, AnchorProvider>();

  /**
   * Registers a provider under its `name`. A later registration for the
   * same name replaces the earlier one (last wins), so a host can override
   * a built-in with a custom implementation.
   *
   * @param provider - The provider to register
   * @returns This registry, for chaining
   */
  register(provider: AnchorProvider): this {
    this.providers.set(provider.name, provider);
    return this;
  }

  /**
   * Resolves a provider by name.
   *
   * @param name - The configured provider name
   * @returns The registered provider
   * @throws If no provider is registered under `name`
   */
  resolve(name: string): AnchorProvider {
    const provider = this.providers.get(name);
    if (provider === undefined) {
      const known = [...this.providers.keys()].sort().join(', ');
      throw new Error(`unknown anchor provider "${name}" (registered: ${known || 'none'})`);
    }
    return provider;
  }

  /** True when a provider is registered under `name`. */
  has(name: string): boolean {
    return this.providers.has(name);
  }
}
