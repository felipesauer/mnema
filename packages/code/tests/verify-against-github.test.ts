/**
 * `mnema key github` and `mnema verify --against-github`, driven through the command line in
 * a sandbox, with the platform `fetch` replaced: no case here goes to the network, and the
 * first one proves a bare `verify` does not even try.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, publicKeyPath, verify } from '@mnema/chain';
import { orderedEvents, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runKeyGithub } from '../src/commands/key-github.js';
import { rawEd25519Of } from '../src/commands/verify-github.js';
import { type CliIo, run } from '../src/program.js';

let sandbox: string;
let repo: string;
let originalCwd: string;
let originalHome: string | undefined;

function capture(): { io: CliIo; out: string[]; err: string[]; failed: () => boolean } {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  return {
    io: {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      fail: () => {
        failed = true;
      },
    },
    out,
    err,
    failed: () => failed,
  };
}

async function cli(args: string[]) {
  const c = capture();
  await run(args, c.io);
  return c;
}

function recordRoot(): string {
  return resolveTrees(repo, { home: join(sandbox, 'home') }).projectPublic as string;
}

/** The OpenSSH line github.com would publish for the key this machine signs the record with. */
function publishedLine(): string {
  const root = recordRoot();
  const fingerprint = (verify(root).tails[0]?.tail ?? '').split('-')[0] as string;
  const raw = rawEd25519Of(readFileSync(publicKeyPath({ root }, fingerprint), 'utf-8'));
  if (raw === undefined) throw new Error('setup: no committed key');
  const type = Buffer.from('ssh-ed25519');
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  return `ssh-ed25519 ${Buffer.concat([u32(type.length), type, u32(32), Buffer.from(raw, 'hex')]).toString('base64')}`;
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-against-github-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  process.env.HOME = join(sandbox, 'home');
  delete process.env.MNEMA_RUN;
  process.chdir(repo);
  const init = await cli(['init']);
  if (init.failed()) throw new Error(`setup: init failed: ${init.err.join(' / ')}`);
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('mnema verify --against-github', () => {
  it('goes nowhere without the flag, and says the verdict it always said', async () => {
    // Linked, so that a comparison run by mistake WOULD ask github.com.
    await cli(['key', 'github', 'octocat']);
    const fetch = vi.fn(async () => {
      throw new Error('a bare verify reached the network');
    });
    vi.stubGlobal('fetch', fetch);
    const bare = await cli(['verify']);
    expect(fetch).not.toHaveBeenCalled();
    expect(bare.failed()).toBe(false);
    expect(bare.out.join('\n')).not.toMatch(/github/);
  });

  it('says an identity with no linked account is not covered, and passes', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const v = await cli(['verify', '--against-github']);
    expect(v.failed()).toBe(false);
    expect(v.out.join('\n')).toMatch(
      /github: mnid:[0-9a-f]{64} — not covered: no GitHub account is linked to this identity/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('covers an identity whose key the linked account publishes, and says what that does not prove', async () => {
    const linked = await cli(['key', 'github', 'octocat']);
    expect(linked.failed()).toBe(false);
    expect(linked.out[0]).toMatch(/^Linked mnid:[0-9a-f]{64} to github\.com\/octocat$/);
    const line = publishedLine();
    const fetch = vi.fn(async (_url: string) => new Response(`${line}\n`, { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    const v = await cli(['verify', '--against-github']);
    expect(v.failed()).toBe(false);
    expect(fetch.mock.calls.map((call) => call[0])).toEqual(['https://github.com/octocat.keys']);
    const said = v.out.join('\n');
    expect(said).toMatch(
      /github: mnid:[0-9a-f]{64} is github\.com\/octocat — every key it signed with \(1\) is one that account publishes/,
    );
    expect(said).toMatch(/not that the key was that account’s when it signed/);
  });

  it('keeps the verdict and the exit when github.com cannot be reached', async () => {
    await cli(['key', 'github', 'octocat']);
    const bare = await cli(['verify']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const v = await cli(['verify', '--against-github']);
    expect(v.failed()).toBe(false);
    expect(v.out.slice(0, bare.out.length)).toEqual(bare.out);
    expect(v.out.join('\n')).toMatch(
      /github: mnid:[0-9a-f]{64} — could not reach github\.com for github\.com\/octocat: fetch failed/,
    );
  });

  it('carries the comparison in --json, beside the verdict', async () => {
    await cli(['key', 'github', 'octocat']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    const v = await cli(['verify', '--against-github', '--json']);
    const reading = JSON.parse(v.out.join('\n')) as {
      record: { ok: boolean };
      github: { authors: { finding: unknown }[] };
    };
    expect(reading.record.ok).toBe(true);
    expect(reading.github.authors.map((a) => a.finding)).toEqual([
      { kind: 'no-such-account', account: 'octocat' },
    ]);
  });

  it('refuses to be combined with --workspace', async () => {
    const v = await cli(['verify', '--workspace', repo, '--against-github']);
    expect(v.failed()).toBe(true);
    expect(v.err.join('\n')).toMatch(/--against-github/);
  });
});

describe('mnema key github', () => {
  it('refuses a name GitHub would not have issued, and records nothing', () => {
    const before = orderedEventsOf(recordRoot()).length;
    const refused = runKeyGithub(
      { cwd: repo, env: { home: join(sandbox, 'home') } },
      { account: 'octo/cat' },
    );
    expect(refused).toMatchObject({ ok: false, reason: 'REFUSED', code: 'NOT_A_GITHUB_ACCOUNT' });
    expect(orderedEventsOf(recordRoot()).length).toBe(before);
  });
});

/** Every event of a tree — the count a refusal must not move. */
function orderedEventsOf(root: string): unknown[] {
  return orderedEvents({ root }, catalogUpcasters());
}
