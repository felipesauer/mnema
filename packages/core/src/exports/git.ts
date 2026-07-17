/** Curated git-facing surface of @mnema/core. */

export { DriftService } from '../services/drift-service.js';
export { GitObserverService } from '../services/git/git-observer-service.js';
export type { CommandRunner } from '../services/git/github-pr-service.js';
export { GitHubPrService } from '../services/git/github-pr-service.js';
export { CommitVerifier } from '../services/integrity/commit-verifier.js';
export { FileCollisionService } from '../services/lint/file-collision-service.js';
