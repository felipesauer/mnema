/**
 * A CLEAN `mnema verify` IS ONE LINE, AND `--verbose` IS WHERE THE REST OF WHAT IT KNOWS GOES.
 *
 * A freshly founded project used to be answered with three things: the verdict, a census note about
 * the backup key `init` makes (which says the key signs nothing until it is restored), and a line
 * saying the private tree holds no record. Both are true and neither is news — they were the loudest
 * part of the first verdict a newcomer reads, over a record with nothing wrong in it.
 *
 * WHAT MOVES AND WHAT NEVER DOES. Only what is informational goes behind the flag: the backup-key
 * census note and the PRIVATE tree's "no record here". A break with its evidence, a global tree that
 * holds nothing, and the exit code are the same with the flag and without it — the flag adds
 * lines and never removes a warning, so the cases that must stay loud are here beside the ones that
 * go quiet.
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
import { type CliIo, run } from '../src/program.js';

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

  it('points the backup-key clause at what the reader can see, which is behind --verbose', async () => {
    // The clause used to say "see census" over an answer that printed no census. A pointer is
    // true only where the thing pointed at is printed: the short answer names the flag, and
    // the flag prints the note. (The second reader never says this clause: it reads a backup
    // from the record and words it as a note of its own, so there is no second line to keep
    // in step — the two differ by construction, and only the product's carries a pointer.)
    await found();
    await record('write the runbook');

    const short = await verify();
    expect(short.out).toHaveLength(1);
    expect(short.out[0]).toContain('backup key(s), which sign nothing until restored');
    expect(short.out[0]).not.toContain('see census');
    expect(short.out[0]).toContain('--verbose');

    const verbose = await verify('--verbose');
    expect(verbose.out.some((line) => line.startsWith('  census [backup-key] public '))).toBe(true);
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

  it('says a global tree that holds nothing without the flag, as it does with it', async () => {
    // Only the PRIVATE tree's empty line waits for --verbose: asked for the global tree, a reader
    // is told it holds nothing in a clean reading too. (The committed tree is never empty here —
    // the project is found by it, and an empty one still gets a verdict.)
    await found();

    const clean = await verify('--global');
    const verbose = await verify('--global', '--verbose');
    const line = (said: Said): string | undefined =>
      said.out.find((one) => one.startsWith('global: no record here'));
    expect(line(clean)).toBeDefined();
    expect(line(verbose)).toBe(line(clean));
  });
});
