import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  type GitCommandRunner,
  type GitResult,
  GitSignedAnchorProvider,
} from '@/services/anchor/git-signed-anchor-provider.js';

const head = 'a'.repeat(64);
const OK = (stdout = ''): GitResult => ({ status: 0, stdout, stderr: '' });
const FAIL = (stderr: string): GitResult => ({ status: 1, stdout: '', stderr });

/**
 * A fake git that models exactly the subcommands the provider uses:
 * hash-object (empty tree), rev-parse (ref tip), commit-tree (-S signs),
 * update-ref, push, cat-file, log, verify-commit. Commits are stored in a
 * map so verify can read back what stamp wrote — no real repo or signing key.
 */
function fakeGit(opts: { signing?: 'ok' | 'no-key'; push?: 'ok' | 'fail' | 'none' }): {
  run: GitCommandRunner;
  commits: Map<string, string>;
  pushed: string[];
} {
  const commits = new Map<string, string>(); // sha -> subject
  const pushed: string[] = [];
  let refTip: string | null = null;
  const signing = opts.signing ?? 'ok';

  const run: GitCommandRunner = (args) => {
    const [cmd] = args;
    if (cmd === 'hash-object') return OK('4b825dc642cb6eb9a060e54bf8d69288fbee4904'); // empty tree
    if (cmd === 'rev-parse') return refTip === null ? FAIL('') : OK(refTip);
    if (cmd === 'commit-tree') {
      if (signing === 'no-key') return FAIL('error: gpg failed to sign the data');
      const subject = args[args.indexOf('-m') + 1] as string;
      const sha = createHash('sha1').update(subject).digest('hex');
      commits.set(sha, subject);
      return OK(sha);
    }
    if (cmd === 'update-ref') {
      refTip = args[2] as string;
      return OK();
    }
    if (cmd === 'push') {
      if (opts.push === 'fail') return FAIL('remote rejected');
      pushed.push(args[2] as string);
      return OK();
    }
    if (cmd === 'cat-file') {
      const sha = args[2] as string;
      return commits.has(sha) ? OK('commit') : FAIL('not found');
    }
    if (cmd === 'log') {
      const sha = args[args.length - 1] as string;
      return OK(commits.get(sha) ?? '');
    }
    if (cmd === 'verify-commit') {
      const sha = args[1] as string;
      if (!commits.has(sha)) return FAIL('not found');
      return signing === 'ok' ? OK() : FAIL('gpg: no signature');
    }
    return FAIL(`unexpected git ${args.join(' ')}`);
  };
  return { run, commits, pushed };
}

describe('GitSignedAnchorProvider', () => {
  it('stamps a signed anchor commit that verifies against the same head', async () => {
    const git = fakeGit({ signing: 'ok' });
    const provider = new GitSignedAnchorProvider('/repo', undefined, null, git.run);

    const receipt = await provider.stamp(head);
    expect(receipt.status).toBe('anchored');
    expect(receipt.blob).toBeTruthy();
    // The committed subject carries the head.
    expect(git.commits.get(receipt.blob)).toBe(`mnema-anchor: ${head}`);

    expect((await provider.verify(head, receipt)).state).toBe('anchored');
  });

  it('verify() is broken when the head does not match the anchor commit', async () => {
    const git = fakeGit({ signing: 'ok' });
    const provider = new GitSignedAnchorProvider('/repo', undefined, null, git.run);
    const receipt = await provider.stamp(head);

    const other = await provider.verify('b'.repeat(64), receipt);
    expect(other.state).toBe('broken');
    expect(other.detail).toMatch(/does not cover this head/i);
  });

  it('verify() is broken when the anchor commit is absent (deleted/forged sha)', async () => {
    const git = fakeGit({ signing: 'ok' });
    const provider = new GitSignedAnchorProvider('/repo', undefined, null, git.run);
    const forged = {
      provider: 'git-signed',
      head,
      blob: 'deadbeef'.repeat(5),
      status: 'anchored' as const,
    };
    expect((await provider.verify(head, forged)).state).toBe('broken');
  });

  it('pushes to the remote when configured, reporting anchored', async () => {
    const git = fakeGit({ signing: 'ok', push: 'ok' });
    const provider = new GitSignedAnchorProvider('/repo', 'refs/mnema/anchors', 'origin', git.run);
    const receipt = await provider.stamp(head);
    expect(receipt.status).toBe('anchored');
    expect(git.pushed).toHaveLength(1);
  });

  it('is fail-open when the push fails: commit made locally, status pending', async () => {
    const git = fakeGit({ signing: 'ok', push: 'fail' });
    const provider = new GitSignedAnchorProvider('/repo', 'refs/mnema/anchors', 'origin', git.run);
    const receipt = await provider.stamp(head);
    // The local commit exists; only the push failed → pending for retry.
    expect(receipt.status).toBe('pending');
    expect(git.commits.get(receipt.blob)).toBe(`mnema-anchor: ${head}`);
  });

  it('raises a clear error (not a crash) when no signing key is configured', async () => {
    const git = fakeGit({ signing: 'no-key' });
    const provider = new GitSignedAnchorProvider('/repo', undefined, null, git.run);
    await expect(provider.stamp(head)).rejects.toThrow(/signing key/i);
  });

  it('verify() reports broken for a signed-but-unsigned commit', async () => {
    // Stamp with a working key, then verify under a runner that reports the
    // commit as unsigned — models a signature stripped after the fact.
    const git = fakeGit({ signing: 'ok' });
    const provider = new GitSignedAnchorProvider('/repo', undefined, null, git.run);
    const receipt = await provider.stamp(head);

    const stripped = fakeGit({ signing: 'no-key' });
    // Seed the stripped runner's commit map with the same commit.
    stripped.commits.set(receipt.blob, `mnema-anchor: ${head}`);
    const provider2 = new GitSignedAnchorProvider('/repo', undefined, null, stripped.run);
    expect((await provider2.verify(head, receipt)).state).toBe('broken');
  });

  it('verify() is cannot-verify (not broken) when git is unavailable', async () => {
    // A runner that simulates git absent from PATH (status 127) — git is
    // optional, so its absence must not be reported as a tampered anchor.
    const gitAbsent: GitCommandRunner = () => ({
      status: 127,
      stdout: '',
      stderr: 'git unavailable: spawn git ENOENT',
    });
    const provider = new GitSignedAnchorProvider('/repo', undefined, null, gitAbsent);
    const receipt = { provider: 'git-signed', head, blob: 'somesha', status: 'anchored' as const };
    const result = await provider.verify(head, receipt);
    expect(result.state).toBe('cannot-verify');
    expect(result.detail).toMatch(/git unavailable/i);
  });
});
