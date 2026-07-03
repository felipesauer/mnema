import { spawnSync } from 'node:child_process';

import type { AnchorProvider, AnchorReceipt, AnchorVerifyResult } from './anchor-provider.js';

/** The registered name of the git-signed provider. */
export const GIT_SIGNED_PROVIDER = 'git-signed';

/** Default ref the anchor commits are written to (outside branch history). */
const DEFAULT_ANCHOR_REF = 'refs/mnema/anchors';

/** Result of one git subcommand. */
export interface GitResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a git command in `cwd`. Injectable so tests avoid a real repo/key. */
export type GitCommandRunner = (args: readonly string[], cwd: string) => GitResult;

const defaultGitRunner: GitCommandRunner = (args, cwd) => {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf-8', timeout: 15_000 });
  // git absent from PATH (or unspawnable): spawnSync sets `error` and leaves
  // status null. Report it as 127 ("command not found") with a clear stderr
  // so the provider degrades to cannot-verify — git is optional, its absence
  // is never mistaken for a broken/tampered anchor.
  if (result.error !== undefined) {
    return { status: 127, stdout: '', stderr: `git unavailable: ${result.error.message}` };
  }
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
};

/** The prefix of an anchor commit's subject; the head hash follows it. */
const ANCHOR_SUBJECT = 'mnema-anchor: ';

/**
 * Anchors the head into a SIGNED git commit written to a dedicated ref
 * (default `refs/mnema/anchors`), optionally pushed to a remote (ADR-37: git
 * as transport, not the guarantee). The commit is built with `commit-tree`
 * over the empty tree, so it NEVER touches the working tree, index, HEAD, or
 * branch history. The receipt is the anchor commit's SHA.
 *
 * Signing uses `git commit-tree -S` (the repo's configured GPG/SSH key). A
 * missing signing key is a clear error, not a crash. A failed push is
 * fail-open: the commit is made locally and the anchor is reported `pending`
 * so a later retry can push it.
 *
 * All git invocations use argv (no shell), consistent with git-commit-service.
 */
export class GitSignedAnchorProvider implements AnchorProvider {
  readonly name = GIT_SIGNED_PROVIDER;

  /**
   * @param projectRoot - Absolute repo path git runs in
   * @param ref - The ref anchor commits are written to
   * @param remote - Optional remote to push the ref to (local-only if unset)
   * @param run - Injectable git runner (tests supply a fake)
   */
  constructor(
    private readonly projectRoot: string,
    private readonly ref: string = DEFAULT_ANCHOR_REF,
    private readonly remote: string | null = null,
    private readonly run: GitCommandRunner = defaultGitRunner,
  ) {}

  private git(...args: string[]): GitResult {
    return this.run(args, this.projectRoot);
  }

  async stamp(head: string): Promise<AnchorReceipt> {
    // The empty tree is a well-known constant, but derive it from the repo
    // (hash-object) so it is correct under any object-format (sha1/sha256).
    const emptyTree = this.git('hash-object', '-t', 'tree', '/dev/null');
    if (emptyTree.status !== 0) {
      throw new Error(
        `git-signed anchor: cannot resolve the empty tree: ${emptyTree.stderr.trim()}`,
      );
    }
    const parentRef = this.git('rev-parse', '--verify', '--quiet', this.ref);
    const parentArgs =
      parentRef.status === 0 && parentRef.stdout.trim().length > 0
        ? ['-p', parentRef.stdout.trim()]
        : [];

    // A SIGNED commit over the empty tree. -S signs with the configured key;
    // an absent key surfaces here as a non-zero status with a clear message.
    const commit = this.git(
      'commit-tree',
      emptyTree.stdout.trim(),
      ...parentArgs,
      '-S',
      '-m',
      `${ANCHOR_SUBJECT}${head}`,
    );
    if (commit.status !== 0) {
      const stderr = commit.stderr.trim();
      // A signing failure is a clear error (not a crash) so the caller/log
      // can tell the user to configure a signing key.
      throw new Error(
        /sign|gpg|key/i.test(stderr)
          ? `git-signed anchor: signing failed — configure a git signing key (${stderr})`
          : `git-signed anchor: commit-tree failed: ${stderr || 'unknown error'}`,
      );
    }
    const sha = commit.stdout.trim();

    // Point the anchor ref at the new commit (chained via the parent above).
    const update = this.git('update-ref', this.ref, sha);
    if (update.status !== 0) {
      throw new Error(`git-signed anchor: update-ref failed: ${update.stderr.trim()}`);
    }

    // Push is best-effort: a failure is FAIL-OPEN — the commit exists
    // locally, so report pending and let a retry push it later.
    if (this.remote !== null) {
      const push = this.git('push', this.remote, `${this.ref}:${this.ref}`);
      if (push.status !== 0) {
        return { provider: this.name, head, blob: sha, status: 'pending' };
      }
    }
    return { provider: this.name, head, blob: sha, status: 'anchored' };
  }

  async verify(head: string, receipt: AnchorReceipt): Promise<AnchorVerifyResult> {
    if (receipt.provider !== this.name) {
      return { state: 'broken', detail: `receipt is for provider "${receipt.provider}"` };
    }
    const sha = receipt.blob;
    // The commit must exist and be a commit object.
    const type = this.git('cat-file', '-t', sha);
    // git unavailable (127) is cannot-verify, NOT broken — git is optional,
    // so a checkout without git can't attest the anchor but must not report
    // it as tampered.
    if (type.status === 127) {
      return { state: 'cannot-verify', detail: `cannot verify: ${type.stderr.trim()}` };
    }
    if (type.status !== 0 || type.stdout.trim() !== 'commit') {
      return { state: 'broken', detail: `anchor commit ${sha.slice(0, 12)} not found` };
    }
    // Its subject must carry exactly this head — a mismatch is tampering.
    const subject = this.git('log', '-1', '--format=%s', sha);
    if (subject.stdout.trim() !== `${ANCHOR_SUBJECT}${head}`) {
      return { state: 'broken', detail: 'anchor commit does not cover this head' };
    }
    // The signature must verify. `verify-commit` exits non-zero for a bad or
    // absent signature. An unknown signer key (cannot check) is reported as
    // cannot-verify, distinct from a broken signature.
    const verify = this.git('verify-commit', sha);
    if (verify.status === 0) {
      return { state: 'anchored', detail: `signed anchor commit ${sha.slice(0, 12)}` };
    }
    if (/no signature/i.test(verify.stderr)) {
      return { state: 'broken', detail: 'anchor commit is not signed' };
    }
    return {
      state: 'cannot-verify',
      detail: `cannot verify the signature of ${sha.slice(0, 12)} (signer key not trusted here)`,
    };
  }
}
