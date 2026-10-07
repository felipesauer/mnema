/**
 * A CLEAN `mnema verify` IS ONE LINE, AND `--verbose` IS WHERE THE REST OF WHAT IT KNOWS GOES.
 *
 * A freshly founded project used to be answered with three things: the verdict, a census note about
 * the backup key `init` makes (which says the key signs nothing until it is restored), and a line
 * saying the private tree holds no record. Both are true and neither is news — they were the loudest
 * part of the first verdict a newcomer reads, over a record with nothing wrong in it.
 *
 * WHAT MOVES AND WHAT NEVER DOES. Only what is informational goes behind the flag: the backup-key
 * census note and the private tree's "no record here". A break, an issue, a note that says a tail
 * may have lost its newest line, a tree that cannot be read, and the exit code are the same with the
 * flag and without it — the flag adds lines and never removes a warning, so the cases that must stay
 * loud are here beside the ones that go quiet.
 *
 * Every fixture is built by the product (`mnema init`, `mnema task`), then edited on disk the way an
 * adversary would.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listTails, orderedSegments } from '@mnema/chain';
import { resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';

let sandbox: string;
let repo: string;
let originalCwd: string;
let originalXdg: string | undefined;
let originalHome: string | undefined;

interface Said {
  readonly out: readonly string[];
  readonly err: readonly string[];
  readonly failed: boolean;
}

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

async function verify(...args: readonly string[]): Promise<Said> {
  const c = capture();
  await run(['verify', ...args], c.io);
  return { out: c.out, err: c.err, failed: c.failed() };
}

async function found(): Promise<void> {
  await run(['init'], capture().io);
}

async function record(title: string, ...scope: readonly string[]): Promise<void> {
  const c = capture();
  await run(['task', 'create', title, ...scope], c.io);
  if (c.failed()) throw new Error(`setup: "${title}" failed: ${c.err.join(' / ')}`);
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-short-verify-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  originalCwd = process.cwd();
  originalXdg = process.env.XDG_DATA_HOME;
  originalHome = process.env.HOME;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  process.env.HOME = join(sandbox, 'home');
  delete process.env.MNEMA_RUN;
  process.chdir(repo);
});

afterEach(() => {
  delete process.env.MNEMA_RUN;
  process.chdir(originalCwd);
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('a clean verify says the verdict and stops', () => {
  it('prints one line, the committed tree’s verdict with its level', async () => {
    await found();
    await record('write the runbook');

    const said = await verify();
    expect(said.out).toHaveLength(1);
    expect(said.out[0]).toMatch(/^public: local integrity verified \(T1\/T2\/T4\); /);
    expect(said.err).toEqual([]);
    expect(said.failed).toBe(false);
  });

  it('keeps the backup key’s census note and the empty private tree behind --verbose', async () => {
    await found();
    await record('write the runbook');

    const said = await verify('--verbose');
    expect(said.out.some((line) => line.startsWith('  census [backup-key] public '))).toBe(true);
    expect(said.out.some((line) => line.startsWith('private: no record here'))).toBe(true);
    expect(said.err).toEqual([]);
    expect(said.failed).toBe(false);
  });

  it('puts the verdict first, with or without --verbose', async () => {
    await found();
    await record('write the runbook');

    const clean = await verify();
    const verbose = await verify('--verbose');
    expect(verbose.out[0]).toBe(clean.out[0]);
  });
});

describe('--verbose never carries what is not informational', () => {
  async function breakThePublicTree(): Promise<void> {
    await found();
    await record('write the runbook');
    const resolved = resolveTrees(repo, { home: join(sandbox, 'home') });
    const root = resolved.projectPublic as string;
    const tail = listTails({ root })[0] as string;
    const segment = orderedSegments({ root }, tail)[0] as string;
    const stored = readFileSync(segment, 'utf-8').split('\n').filter(Boolean);
    const first = JSON.parse(stored[0] as string) as { event: { at: string } };
    first.event.at = '1999-01-01T00:00:00.000Z';
    stored[0] = JSON.stringify(first);
    writeFileSync(segment, `${stored.join('\n')}\n`, 'utf-8');
  }

  it('says a break, its evidence and the failing exit the same with and without the flag', async () => {
    await breakThePublicTree();

    const clean = await verify();
    const verbose = await verify('--verbose');
    expect(clean.out[0]).toContain('local integrity FAILED');
    expect(clean.err.join('\n')).toContain('issue [T1] public ');
    expect(clean.failed).toBe(true);
    expect(verbose.out[0]).toBe(clean.out[0]);
    expect(verbose.err).toEqual(clean.err);
    expect(verbose.failed).toBe(true);
  });
});
