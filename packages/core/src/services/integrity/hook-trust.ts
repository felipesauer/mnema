import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Config } from '../../config/config-schema.js';
import { userKnowledgeDir } from '../knowledge/user-knowledge.js';

/**
 * Canonical fingerprint of a hooks block. JSON with sorted keys so the
 * hash depends only on the hook contents (commands + args + which events),
 * not on key ordering or formatting in the source file. An empty block
 * (no hooks configured) has a stable fingerprint too, but callers short-
 * circuit before hashing when nothing is configured.
 */
export function fingerprintHooks(hooks: Config['hooks']): string {
  // Serialise each event's hook list explicitly (event keys in sorted
  // order) so the fingerprint depends only on the hook contents, not on
  // key ordering in the source file. NOTE: JSON.stringify's array-replacer
  // form must NOT be used here — it filters keys by name at every nesting
  // level, which would strip the nested command/args and collapse distinct
  // blocks to the same hash.
  const canonical = JSON.stringify(
    Object.keys(hooks)
      .sort()
      .map((event) => [event, hooks[event as keyof Config['hooks']]]),
  );
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * True when at least one hook is configured for any event. The trust
 * check only matters when there is something to run.
 */
export function hasAnyHook(hooks: Config['hooks']): boolean {
  return Object.values(hooks).some((list) => list.length > 0);
}

/**
 * Decides whether a project's configured hooks are trusted to execute.
 *
 * A block is trusted iff a human has approved *these exact hooks* via
 * `mnema hooks approve`, recorded as a fingerprint in an approvals file
 * kept outside the repository. Any later edit to the `hooks` block — the
 * exact move an attacking agent makes — changes the fingerprint, so the
 * stored approval no longer matches and the hooks become inert.
 *
 * The approvals file lives under the user-level knowledge dir
 * (`~/.config/mnema`, out of the agent's in-repo write reach). Storing it
 * there — rather than in the repo — is what an attacking agent cannot
 * forge by editing tracked files.
 */
export class HookTrustService {
  /**
   * @param userDir - The user-level knowledge dir (`~/.config/mnema`),
   *   resolved by the caller via {@link userKnowledgeDir} so tests can
   *   isolate it. Approvals live under `<userDir>/approvals`.
   */
  constructor(
    private readonly projectKey: string,
    private readonly userDir: string = userKnowledgeDir(),
  ) {}

  private approvalFile(): string {
    return path.join(this.userDir, 'approvals', `${this.projectKey}.hooks`);
  }

  /** The approved fingerprint, or null when nothing has been approved. */
  private approvedFingerprint(): string | null {
    const file = this.approvalFile();
    if (!existsSync(file)) return null;
    return readFileSync(file, 'utf-8').trim() || null;
  }

  /**
   * True when the given hooks block matches the stored approval. An empty
   * block is trivially trusted (nothing runs); a non-empty block requires
   * an exact fingerprint match.
   */
  isTrusted(hooks: Config['hooks']): boolean {
    if (!hasAnyHook(hooks)) return true;
    const approved = this.approvedFingerprint();
    return approved !== null && approved === fingerprintHooks(hooks);
  }

  /**
   * Records the given hooks block as approved by writing its fingerprint
   * to the out-of-repo approvals file. Invoked only by the human-driven
   * `mnema hooks approve` command — never by a mutation path.
   *
   * The directory is created `0700` and the file written `0600` so the
   * approval is owner-only. NOTE: this is an OS-user boundary, not a
   * cryptographic one — the guarantee holds against an agent constrained
   * to the repository, but a process running as the *same* user could
   * still write here. Sandboxing the agent away from `~/.config/mnema`
   * strengthens it further.
   *
   * @returns The fingerprint that was stored.
   */
  approve(hooks: Config['hooks']): string {
    const fingerprint = fingerprintHooks(hooks);
    const file = this.approvalFile();
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, `${fingerprint}\n`, { encoding: 'utf-8', mode: 0o600 });
    return fingerprint;
  }
}
