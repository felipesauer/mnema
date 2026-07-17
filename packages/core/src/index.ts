/**
 * @mnema/core — the service layer, storage, workflow engine and
 * integrity chain that own the `.mnema/` store.
 *
 * The root export is the "everything wired" convenience; the curated
 * subpaths (`@mnema/core/backlog`, `/knowledge`, `/audit`, …) are the
 * tree-shakeable granular surface.
 */

export { type Config, ConfigSchema } from './config/config-schema.js';
export {
  createServiceContainer,
  type ServiceContainer,
  type ServiceContainerOptions,
} from './services/service-container.js';
export { VERSION } from './utils/version.js';
