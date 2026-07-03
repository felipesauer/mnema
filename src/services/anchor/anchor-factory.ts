import type { Config } from '../../config/config-schema.js';
import type { AnchorRepository } from '../../storage/sqlite/repositories/anchor-repository.js';
import { AnchorRegistry } from './anchor-registry.js';
import { AnchorScheduler } from './anchor-scheduler.js';
import { NoneAnchorProvider } from './none-anchor-provider.js';

/**
 * Builds the anchor registry with every known provider registered. The
 * concrete network-backed providers (git-signed, opentimestamps, rfc3161)
 * register here as they land; `none` is always present as the default.
 *
 * @param config - The project config (per-provider options live under
 *   `audit.anchor`)
 * @param projectRoot - Absolute project root (git-signed needs the repo)
 * @returns A registry ready to resolve the configured provider
 */
export function buildAnchorRegistry(_config: Config, _projectRoot: string): AnchorRegistry {
  const registry = new AnchorRegistry();
  registry.register(new NoneAnchorProvider());
  // git-signed / opentimestamps / rfc3161 register here as they land.
  return registry;
}

/**
 * Resolves the configured anchor provider and wires a scheduler around it.
 * The scheduler is inert for `none`, so a local-first project pays nothing.
 *
 * @param config - The project config
 * @param projectRoot - Absolute project root
 * @param anchors - The anchor-state repository
 * @returns A scheduler bound to the configured provider
 */
export function buildAnchorScheduler(
  config: Config,
  projectRoot: string,
  anchors: AnchorRepository,
): AnchorScheduler {
  const registry = buildAnchorRegistry(config, projectRoot);
  const provider = registry.resolve(config.audit.anchor.provider);
  return new AnchorScheduler(anchors, provider);
}
