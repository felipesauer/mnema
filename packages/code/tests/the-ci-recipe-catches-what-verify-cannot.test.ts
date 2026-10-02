/**
 * THE CI RECIPE THE PAGE PUBLISHES CATCHES WHAT `verify` CANNOT — run, from the page's own bytes.
 *
 * WHERE THIS COMES FROM. A record that is honest in every byte can still be a lie about its own
 * past, and four of them were measured walking past `mnema verify` on a clean clone: the newest
 * events cut together with the checkpoint that covered them (an aligned cut), every tail deleted
 * together with every key, the record erased and founded again, and a key holder rewriting the
 * middle of its own tail and signing it again. Three of the four exit 0 even under
 * `--require=signed`, and the second reader says VERIFIED over them too. Nothing inside the
 * directory remembers what it replaced — what does is git, which kept the commit the change
 * started from. So `packages/code/README.md` publishes a gate that asks it.
 *
 * WHAT IS RUN. The block between the page's two markers, unedited, by `bash`, in a sandbox git
 * repository whose record the built binary made — `mnema` on the PATH is `dist/cli.js`, `HOME` is
 * the sandbox's, and `BASE` is the commit before the change, which is all the page says to set.
 * Each case asserts what `verify --require=signed` alone says over the same commit too, so a case
 * the bare gate already catches is not counted as one only the recipe does.
 *
 * WHAT IT DOES NOT SAY. Whether the base commit is the RIGHT one is the CI's to get right (a
 * shallow clone has none). A history rewritten on the remote itself — a force-push of the base —
 * moves the base with it; that is a protection the git host gives (a protected branch), not this.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  catalogUpcasters,
  checkpointHash,
  keyPairFromPrivatePem,
  parseEntry,
  sealEntry,
  serializeCheckpoint,
  serializeEntry,
  signCheckpoint,
} from '@mnema/chain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';
import { ROOT, read } from './support/published-examples.js';

const PAGE = 'packages/code/README.md';
const BEGIN = '<!-- BEGIN ci-recipe -->';
const END = '<!-- END ci-recipe -->';
const BINARY = join(ROOT, 'packages/code/dist/cli.js');

/** The recipe's shell, fence removed and nothing else touched; throws when a marker is gone. */
function publishedRecipe(): string {
  const page = read(PAGE);
  const from = page.indexOf(BEGIN);
  const to = page.indexOf(END);
  if (from < 0 || to < 0) throw new Error(`${PAGE} no longer marks the CI recipe`);
  const fence = /```sh\n([\s\S]*?)```/.exec(page.slice(from + BEGIN.length, to));
  if (fence === null) throw new Error(`${PAGE} marks the CI recipe but publishes no sh block`);
  return fence[1] as string;
}

let sandbox: string;
let home: string;
let bin: string;
let base: string;
let baseCommit: string;

function env(): NodeJS.ProcessEnv {
  return {
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
  };
}

/** `git <args>` in `dir`, as every git a test writes a repository with runs. */
function git(dir: string, ...args: string[]): string {
  const ran = spawnSync(
    'git',
    [
      '-c',
      'user.name=mnema test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'init.defaultBranch=main',
      ...args,
    ],
    {
      cwd: dir,
      encoding: 'utf-8',
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: home,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
      },
    },
  );
  if (ran.status !== 0) throw new Error(`git ${args.join(' ')}: ${ran.stderr}`);
  return ran.stdout;
}

function mnema(dir: string, ...args: string[]): { status: number; out: string } {
  const ran = spawnSync(process.execPath, [BINARY, ...args], {
    cwd: dir,
    encoding: 'utf-8',
    env: env(),
  });
  return { status: ran.status ?? -1, out: `${ran.stdout}${ran.stderr}` };
}

function commitAll(dir: string, message: string): void {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', message);
}

/** The one public tail of the record in `dir`. */
function tailDir(dir: string): string {
  const tails = join(dir, '.mnema', 'tails');
  return join(tails, readdirSync(tails)[0] as string);
}

function lines(file: string): string[] {
  return readFileSync(file, 'utf-8').split('\n').filter(Boolean);
}

/** The newest events and the checkpoint that covered them, cut together. */
function alignedCut(dir: string): void {
  const tail = tailDir(dir);
  const checkpoints = join(tail, 'checkpoints.jsonl');
  const kept = lines(checkpoints);
  const dropped = JSON.parse(kept.pop() as string) as { fromSeq: number };
  writeFileSync(checkpoints, `${kept.join('\n')}\n`);
  const segment = join(tail, '000001.jsonl');
  const events = lines(segment).filter(
    (line) => (JSON.parse(line) as { link: { seq: number } }).link.seq < dropped.fromSeq,
  );
  writeFileSync(segment, `${events.join('\n')}\n`);
}

/** Every tail deleted, and every key with it. */
function tailsAndKeysDeleted(dir: string): void {
  rmSync(join(dir, '.mnema', 'tails'), { recursive: true });
  for (const key of readdirSync(join(dir, '.mnema', 'keys'))) {
    if (key.endsWith('.pub')) rmSync(join(dir, '.mnema', 'keys', key));
  }
}

/** The record erased and founded again by the same machine, with a different decision in it. */
function refounded(dir: string): void {
  rmSync(join(dir, '.mnema'), { recursive: true });
  expect(mnema(dir, 'init').status).toBe(0);
  expect(
    mnema(dir, 'decision', 'record', 'Use MongoDB for storage', 'nobody will check').status,
  ).toBe(0);
}

/** The key holder rewrites a decision in the middle of its own tail and signs every range again. */
function rewrittenBySigner(dir: string): void {
  const tail = tailDir(dir);
  const segment = join(tail, '000001.jsonl');
  const upcasters = catalogUpcasters();
  const entries = lines(segment).map((line) => parseEntry(line, upcasters));
  const fingerprint = (tail.split('/').pop() as string).split('-')[0] as string;
  const keyFile = join(home, '.mnema', 'identity', 'keys', `${fingerprint}.key`);
  const keyPair = keyPairFromPrivatePem(readFileSync(keyFile, 'utf-8'));
  let prev: string | null = null;
  let rewritten = 0;
  const sealed = entries.map((entry) => {
    let event = entry.event;
    if (event.kind === 'decision.recorded' && event.payload.title === 'Use Postgres for storage') {
      event = { ...event, payload: { ...event.payload, title: 'Use MongoDB for storage' } };
      rewritten += 1;
    }
    const next = sealEntry({ event, tail: entry.link.tail, seq: entry.link.seq, prev });
    prev = next.link.hash;
    return next;
  });
  expect(rewritten).toBe(1);
  writeFileSync(segment, sealed.map((entry) => `${serializeEntry(entry)}\n`).join(''));
  const checkpoints = join(tail, 'checkpoints.jsonl');
  let previous: string | null = null;
  const signed = lines(checkpoints).map((line) => {
    const stored = JSON.parse(line) as { tail: string; fromSeq: number; toSeq: number };
    const checkpoint = signCheckpoint({
      tail: stored.tail,
      fromSeq: stored.fromSeq,
      events: sealed.slice(stored.fromSeq, stored.toSeq + 1).map((entry) => entry.written),
      prev: previous,
      keyPair,
    });
    previous = checkpointHash(checkpoint);
    return `${serializeCheckpoint(checkpoint)}\n`;
  });
  writeFileSync(checkpoints, signed.join(''));
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-ci-recipe-'));
  home = join(sandbox, 'home');
  bin = join(sandbox, 'bin');
  base = join(sandbox, 'base');
  mkdirSync(home);
  mkdirSync(bin);
  mkdirSync(base);
  writeFileSync(join(bin, 'mnema'), `#!/bin/sh\nexec "${process.execPath}" "${BINARY}" "$@"\n`);
  chmodSync(join(bin, 'mnema'), 0o755);
  git(base, 'init', '-q');
  expect(mnema(base, 'init').status).toBe(0);
  for (const [title, why] of [
    ['Use Postgres for storage', 'the team knows it'],
    ['Store timestamps in UTC', 'three services send three zones'],
    ['Mint ids as uuidv7', 'they sort by time'],
  ] as const) {
    expect(mnema(base, 'decision', 'record', title, why).status).toBe(0);
  }
  commitAll(base, 'the record as it was');
  baseCommit = git(base, 'rev-parse', 'HEAD').trim();
}, 60_000);

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A copy of the base repository, changed by `change` and committed. */
function changed(name: string, change: (dir: string) => void): string {
  const dir = join(sandbox, name);
  cpSync(base, dir, { recursive: true });
  change(dir);
  commitAll(dir, name);
  return dir;
}

function recipe(dir: string): { status: number; out: string } {
  const ran = spawnSync('bash', ['-c', publishedRecipe()], {
    cwd: dir,
    encoding: 'utf-8',
    env: { ...env(), BASE: baseCommit },
  });
  return { status: ran.status ?? -1, out: `${ran.stdout}${ran.stderr}` };
}

describe('the CI recipe the page publishes', () => {
  it('passes a record that only grew', () => {
    const dir = changed('honest', (at) => {
      expect(
        mnema(at, 'decision', 'record', 'Cache nothing', 'the record is the cache').status,
      ).toBe(0);
    });
    const said = recipe(dir);
    expect(said.status, said.out).toBe(0);
  });

  it.each([
    ['the newest events cut with their checkpoint', alignedCut, 0, ': rewritten — '],
    ['every tail deleted with every key', tailsAndKeysDeleted, 1, ': gone — '],
    ['the record erased and founded again', refounded, 0, ': gone — '],
    [
      'the middle rewritten and signed again by the key holder',
      rewrittenBySigner,
      0,
      ': rewritten — ',
    ],
  ] as const)('catches %s', (name, change, signedExit, says) => {
    const dir = changed(name.replace(/\W+/g, '-'), change);
    // What the gate alone says over the same commit: the case is only the recipe's when it
    // passes there.
    expect(mnema(dir, 'verify', '--require=signed').status, name).toBe(signedExit);
    const said = recipe(dir);
    expect(said.status, said.out).not.toBe(0);
    expect(said.out).toContain(says);
  });

  it('fails, saying why, when the base is not in the clone — a comparison that was not made is not a pass', () => {
    const said = mnema(base, 'verify', '--since', 'no-such-revision');
    expect(said.status).not.toBe(0);
    expect(said.out).toContain('since no-such-revision: not compared — no commit by that name');
  });

  it('carries what it compared in --json, and leaves a verdict it was not asked for unchanged', () => {
    const asked = mnema(base, 'verify', '--json', '--since', baseCommit);
    expect(asked.status, asked.out).toBe(0);
    const since = (
      JSON.parse(asked.out) as { since: { kind: string; findings: unknown[]; held: number } }
    ).since;
    expect(since.kind).toBe('read');
    expect(since.findings).toEqual([]);
    expect(since.held).toBeGreaterThan(0);
    // Without the flag the reading has no such field, and the exit is the bare one.
    const bare = mnema(base, 'verify', '--json');
    expect(bare.status).toBe(0);
    expect('since' in (JSON.parse(bare.out) as object)).toBe(false);
  });

  it('refuses --since beside --workspace rather than ruling on one of them silently', () => {
    const said = mnema(base, 'verify', '--since', baseCommit, '--workspace', base);
    expect(said.status).not.toBe(0);
    expect(said.out).toContain('`--since` rules on the project you stand in');
  });

  it('reads the block from the page, or reports that it could not', () => {
    expect(publishedRecipe()).toContain('mnema verify --require=signed');
  });
});
