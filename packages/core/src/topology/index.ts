/**
 * Topology: the three trees a person writes to and reads from, and how a write
 * finds the right one.
 *
 * A person has one identity (one key root) referenced by up to three trees —
 * project-public, project-private, and global-private. This module resolves
 * which of them exist from a working directory ({@link resolveTrees}), and
 * routes a write to one of them by scope, ensuring a project tree owns its own
 * git hygiene ({@link openTreeForWriting}). Reading the union across trees is the
 * projection layer's `orderedEventsAcross`. Finding which single tree an entity
 * lives in — so a transition follows it and never splits its history — is
 * {@link locateEntityScope}.
 */

export { locateEntityScope } from './locate.js';
export {
  listProjects,
  PROJECTS_FILE,
  projectsIndexPath,
  type RegisteredProject,
  registerProject,
} from './registry.js';
export {
  appDataDir,
  type DiscoveryEnv,
  PROJECT_DIR,
  type ResolvedTrees,
  resolveTrees,
} from './resolve.js';
export {
  chainRootForScope,
  type OpenTreeOptions,
  type Origin,
  openTreeForWriting,
  resolveScope,
  type Scope,
  TreeUnavailableError,
} from './routing.js';
