import type { Config } from '../../config/config-schema.js';
import type { AnchorRepository } from '../../storage/sqlite/repositories/anchor-repository.js';
import { AnchorRegistry } from './anchor-registry.js';
import { AnchorScheduler } from './anchor-scheduler.js';
import { GIT_SIGNED_PROVIDER, GitSignedAnchorProvider } from './git-signed-anchor-provider.js';
import { NoneAnchorProvider } from './none-anchor-provider.js';

/**
 * Builds the anchor registry with every known provider registered. A concrete
 * provider (today `git-signed`) registers here only when the project selects
 * it; `none` is always present as the default. A new provider is one file plus
 * one opt-in registration branch here.
 *
 * @param config - The project config (per-provider options live under
 *   `audit.anchor`)
 * @param projectRoot - Absolute project root (git-signed needs the repo)
 * @returns A registry ready to resolve the configured provider
 */
export function buildAnchorRegistry(config: Config, projectRoot: string): AnchorRegistry {
  const registry = new AnchorRegistry();
  // `none` is always available and is the default — anchoring, and the git
  // it would use, are strictly OPT-IN. A network/git-backed provider is
  // registered ONLY when the project explicitly selects it, so the default
  // path never depends on git being present at all.
  registry.register(new NoneAnchorProvider());
  if (config.audit.anchor.provider === GIT_SIGNED_PROVIDER) {
    registry.register(
      new GitSignedAnchorProvider(
        projectRoot,
        config.audit.anchor.ref,
        config.audit.anchor.remote ?? null,
      ),
    );
  }
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
  return new AnchorScheduler(anchors, provider, config.audit.anchor.interval);
}
