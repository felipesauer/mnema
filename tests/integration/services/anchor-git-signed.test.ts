import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  type GitCommandRunner,
  type GitResult,
  GitSignedAnchorProvider,
} from '@/services/anchor/git-signed-anchor-provider.js';
import { isSafeAnchorRemote } from '@/utils/anchor-remote.js';

const head = 'a'.repeat(64);
const OK = (stdout = ''): GitResult => ({ status: 0, stdout, stderr: '' });
const FAIL = (stderr: string): GitResult => ({ status: 1, stdout: '', stderr });

/**
 * A fake git that models exactly the subcommands the provider uses:
 * hash-object (empty tree), rev-parse (ref tip), commit-tree (-S signs),
 * update-ref, push, cat-file, log, verify-commit. Commits are stored in a
 * map so verify can read back what stamp wrote — no real repo or signing key.
 */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

interface FakeCommit {
  subject: string;
  tree: string;
  parent: string | null;
}

function fakeGit(opts: { signing?: 'ok' | 'no-key'; push?: 'ok' | 'fail' | 'none' }): {
  run: GitCommandRunner;
  commits: Map<string, FakeCommit>;
  pushed: string[];
  refTip: () => string | null;
} {
  const commits = new Map<string, FakeCommit>();
  const pushed: string[] = [];
  let refTip: string | null = null;
  const signing = opts.signing ?? 'ok';

  /** Is `sha` reachable from the ref tip via the parent chain? */
  const isAncestor = (sha: string): boolean => {
    let cur = refTip;
    while (cur !== null) {
      if (cur === sha) return true;
      cur = commits.get(cur)?.parent ?? null;
    }
    return false;
  };

  const run: GitCommandRunner = (args) => {
    const [cmd] = args;
    if (cmd === 'hash-object') return OK(EMPTY_TREE);
    if (cmd === 'rev-parse') return refTip === null ? FAIL('') : OK(refTip);
    if (cmd === 'commit-tree') {
      if (signing === 'no-key') return FAIL('error: gpg failed to sign the data');
      const subject = args[args.indexOf('-m') + 1] as string;
      const parentIdx = args.indexOf('-p');
      const parent = parentIdx >= 0 ? (args[parentIdx + 1] as string) : null;
      const tree = args[1] as string; // commit-tree <tree> ...
      const sha = createHash('sha1').update(`${subject}|${parent}|${tree}`).digest('hex');
      commits.set(sha, { subject, tree, parent });
      return OK(sha);
    }
    if (cmd === 'update-ref') {
      // Positionals only — the provider passes `--end-of-options` before them.
      const positional = args.slice(1).filter((a) => a !== '--end-of-options');
      refTip = positional[1] as string;
      return OK();
    }
    if (cmd === 'push') {
      if (opts.push === 'fail') return FAIL('remote rejected');
      const positional = args.slice(1).filter((a) => a !== '--end-of-options');
      pushed.push(positional[0] as string); // the remote
      return OK();
    }
    if (cmd === 'cat-file') {
      const sha = args[2] as string;
      return commits.has(sha) ? OK('commit') : FAIL('not found');
    }
    if (cmd === 'log') {
      const fmt = args.find((a) => a.startsWith('--format='));
      const sha = args[args.length - 1] as string;
      const c = commits.get(sha);
      if (c === undefined) return OK('');
      if (fmt === '--format=%T') return OK(c.tree);
      return OK(c.subject); // %s
    }
    if (cmd === 'merge-base') {
      // merge-base --is-ancestor <sha> <ref>
      const sha = args[2] as string;
      return isAncestor(sha) ? OK() : FAIL('');
    }
    if (cmd === 'verify-commit') {
      const sha = args[1] as string;
      if (!commits.has(sha)) return FAIL('not found');
      return signing === 'ok' ? OK() : FAIL('gpg: no signature');
    }
    return FAIL(`unexpected git ${args.join(' ')}`);
  };
  return { run, commits, pushed, refTip: () => refTip };
}

describe('GitSignedAnchorProvider', () => {
  it('stamps a signed anchor commit that verifies against the same head', async () => {
    const git = fakeGit({ signing: 'ok' });
    const provider = new GitSignedAnchorProvider('/repo', undefined, null, git.run);

    const receipt = await provider.stamp(head);
    expect(receipt.status).toBe('anchored');
    expect(receipt.blob).toBeTruthy();
    // The committed subject carries the head, over the empty tree.
    expect(git.commits.get(receipt.blob)?.subject).toBe(`mnema-anchor: ${head}`);
    expect(git.commits.get(receipt.blob)?.tree).toBe(EMPTY_TREE);

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
    expect(git.commits.get(receipt.blob)?.subject).toBe(`mnema-anchor: ${head}`);
  });

  it('raises a clear error (not a crash) when no signing key is configured', async () => {
    const git = fakeGit({ signing: 'no-key' });
    const provider = new GitSignedAnchorProvider('/repo', undefined, null, git.run);
    await expect(provider.stamp(head)).rejects.toThrow(/signing key/i);
  });

  it('verify() reports broken for a signed-then-unsigned commit', async () => {
    // A runner where the commit exists, is reachable and has the empty tree,
    // but verify-commit reports no signature (signature stripped after the
    // fact). It must be broken, not cannot-verify.
    const git = fakeGit({ signing: 'ok' });
    const stampProvider = new GitSignedAnchorProvider('/repo', undefined, null, git.run);
    const receipt = await stampProvider.stamp(head);
    // Now verify with a runner that shares the same commit/ref state but
    // reports the signature as absent.
    const unsigned: GitCommandRunner = (args) =>
      args[0] === 'verify-commit' ? FAIL('gpg: no signature') : git.run(args, '/repo');
    const provider2 = new GitSignedAnchorProvider('/repo', undefined, null, unsigned);
    expect((await provider2.verify(head, receipt)).state).toBe('broken');
  });

  it('verify() is broken when the anchor commit has a non-empty tree (content smuggling)', async () => {
    const git = fakeGit({ signing: 'ok' });
    const provider = new GitSignedAnchorProvider('/repo', undefined, null, git.run);
    const receipt = await provider.stamp(head);
    // Tamper the recorded commit to carry a non-empty tree (a signed commit
    // with arbitrary content but the right subject) — must be rejected.
    const c = git.commits.get(receipt.blob);
    if (c !== undefined) c.tree = 'ffffffffffffffffffffffffffffffffffffffff';
    const r = await provider.verify(head, receipt);
    expect(r.state).toBe('broken');
    expect(r.detail).toMatch(/empty tree/i);
  });

  it('verify() is broken for a signed commit NOT reachable from the anchor ref (dangling/planted)', async () => {
    const git = fakeGit({ signing: 'ok' });
    const provider = new GitSignedAnchorProvider('/repo', undefined, null, git.run);
    const receipt = await provider.stamp(head);
    // Advance the ref to a DIFFERENT commit so the anchor is no longer an
    // ancestor of the ref tip (models a forged/dangling signed commit).
    git.run(['commit-tree', EMPTY_TREE, '-S', '-m', 'unrelated'], '/repo');
    const other = await provider.stamp('c'.repeat(64)); // advances the ref past `receipt`
    // `receipt` is now behind, but is it still an ancestor? stamp chains, so
    // it IS an ancestor. To make it dangling, point the ref elsewhere:
    git.run(['update-ref', 'refs/mnema/anchors', other.blob], '/repo');
    // Re-point ref to a fresh unrelated commit with no link to `receipt`.
    const unrelated = git.run(['commit-tree', EMPTY_TREE, '-S', '-m', 'x'], '/repo');
    git.run(['update-ref', 'refs/mnema/anchors', unrelated.stdout.trim()], '/repo');
    const r = await provider.verify(head, receipt);
    expect(r.state).toBe('broken');
    expect(r.detail).toMatch(/not reachable/i);
  });

  it('refuses an ext:: remote-helper transport and never spawns git push', async () => {
    // `git push 'ext::sh -c <payload>'` runs an arbitrary command; the
    // provider must reject it before it reaches git.
    const git = fakeGit({ signing: 'ok', push: 'ok' });
    const provider = new GitSignedAnchorProvider(
      '/repo',
      'refs/mnema/anchors',
      "ext::sh -c 'touch /tmp/pwned'",
      git.run,
    );
    await expect(provider.stamp(head)).rejects.toThrow(/unsafe push remote/i);
    // The dangerous remote never reached `git push`.
    expect(git.pushed).toHaveLength(0);
  });

  it('accepts a plain remote name and an https URL as push remotes', async () => {
    const named = fakeGit({ signing: 'ok', push: 'ok' });
    const namedProvider = new GitSignedAnchorProvider(
      '/repo',
      'refs/mnema/anchors',
      'origin',
      named.run,
    );
    expect((await namedProvider.stamp(head)).status).toBe('anchored');
    expect(named.pushed).toEqual(['origin']);

    const url = fakeGit({ signing: 'ok', push: 'ok' });
    const urlProvider = new GitSignedAnchorProvider(
      '/repo',
      'refs/mnema/anchors',
      'https://example.com/r.git',
      url.run,
    );
    expect((await urlProvider.stamp(head)).status).toBe('anchored');
    expect(url.pushed).toEqual(['https://example.com/r.git']);
  });

  it('isSafeAnchorRemote accepts names/safe URLs, rejects helper transports and flags', () => {
    expect(isSafeAnchorRemote('origin')).toBe(true);
    expect(isSafeAnchorRemote('upstream-2')).toBe(true);
    expect(isSafeAnchorRemote('https://example.com/r.git')).toBe(true);
    expect(isSafeAnchorRemote('ssh://git@host/r.git')).toBe(true);
    expect(isSafeAnchorRemote('git://host/r.git')).toBe(true);
    expect(isSafeAnchorRemote('file:///srv/r.git')).toBe(true);
    expect(isSafeAnchorRemote("ext::sh -c 'id'")).toBe(false);
    expect(isSafeAnchorRemote('fd::17')).toBe(false);
    expect(isSafeAnchorRemote('--upload-pack=touch /tmp/x')).toBe(false);
    expect(isSafeAnchorRemote('-oProxyCommand=id')).toBe(false);
    expect(isSafeAnchorRemote('http://169.254.169.254/')).toBe(false);
    expect(isSafeAnchorRemote('')).toBe(false);
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
