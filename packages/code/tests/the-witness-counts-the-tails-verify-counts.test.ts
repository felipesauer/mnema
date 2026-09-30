/**
 * `mnema witness` counts the tails `mnema verify` counts — over the one record where the two
 * used to disagree: a record holding an EMPTY tail.
 *
 * WHAT THE EMPTY TAIL IS. A tail directory with its ownership proof and no event — what an
 * older writer left when a key's first write was refused, and what records committed then
 * still carry (they stay as they are). The verifier counts every directory under `tails/`, and
 * folds the empty one into the witness level as a tail nothing attests; the listing walked the
 * tails that HOLD events, so it listed one fewer — and the one it left out was the one lowering
 * the level. Now both walk `listTails`, the verifier's enumeration.
 *
 * THE FIXTURE IS THE PRODUCT'S OWN BYTES. The other machine is the product's writer
 * (`mergeAForeignTail`), and what is kept of its tail is the one file an older writer minted at
 * birth, `tailproof.json`, signed by that key — exactly the residue, with nothing written by
 * hand.
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { mergeAForeignTail } from './support/a-tail-from-another-machine.js';

let sandbox: string;
let repo: string;
let originalCwd: string;
let originalXdg: string | undefined;
let originalHome: string | undefined;

/** What one invocation wrote, and whether it asked for a non-zero exit. */
interface Said {
  readonly out: string[];
  readonly err: string[];
  readonly failed: boolean;
}

/** Runs `mnema <argv>` the way the binary does, and reads both channels. */
async function mnema(...argv: string[]): Promise<Said> {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
  };
  await run(argv, io);
  return { out, err, failed };
}

/** The project's committed tree. */
function publicRoot(): string {
  return resolveTrees(repo, { home: join(sandbox, 'home') }).projectPublic as string;
}

/**
 * Merges another machine's tail and keeps of it only what an older writer left at open: the
 * ownership proof. Answers with the tail's id.
 */
function anEmptyTail(into = publicRoot()): string {
  const tail = mergeAForeignTail(into, join(sandbox, 'other-machine'));
  const dir = join(into, 'tails', tail);
  for (const file of readdirSync(dir)) {
    if (file !== 'tailproof.json') rmSync(join(dir, file), { recursive: true, force: true });
  }
  expect(readdirSync(dir)).toEqual(['tailproof.json']);
  return tail;
}

/** The number `verify` says, off its own line for the committed tree. */
function tailsVerified(said: Said): number {
  const line = said.out.find((one) => one.startsWith('public:')) ?? '';
  const count = /; (\d+) tail\(s\);/.exec(line)?.[1];
  if (count === undefined) throw new Error(`no tail count in: ${said.out.join(' / ')}`);
  return Number(count);
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-witness-tails-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  originalCwd = process.cwd();
  originalXdg = process.env.XDG_DATA_HOME;
  originalHome = process.env.HOME;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  process.env.HOME = join(sandbox, 'home');
  delete process.env.MNEMA_RUN;
  process.chdir(repo);
  const initiated = await mnema('init');
  expect(initiated.failed, initiated.err.join(' / ')).toBe(false);
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

describe('witness and verify count the same tails', () => {
  it('agree over a record with no empty tail — the control', async () => {
    const verified = await mnema('verify');
    const listed = await mnema('witness');
    expect(tailsVerified(verified)).toBe(1);
    expect(listed.out[0]).toBe('1 tail(s):');
  });

  it('agree over a record holding an empty tail, and the listing shows it', async () => {
    const empty = anEmptyTail();
    const verified = await mnema('verify');
    const listed = await mnema('witness');
    expect(tailsVerified(verified)).toBe(2);
    expect(listed.out[0]).toBe(`${tailsVerified(verified)} tail(s):`);
    const row = listed.out.find((line) => line.includes(empty));
    expect(row, listed.out.join(' / ')).toBeDefined();
    expect(row).toContain('no checkpoint');
    expect(row).toContain('the tail has no checkpoint to witness');
  });

  it('says the same number as JSON, with the reading the verifier derives for it', async () => {
    const empty = anEmptyTail();
    const listed = await mnema('witness', '--json');
    const json = JSON.parse(listed.out.join('\n')) as {
      lines: { tail: string; checkpoint: string | null; reading: { status: string } }[];
    };
    expect(json.lines).toHaveLength(tailsVerified(await mnema('verify')));
    const line = json.lines.find((one) => one.tail === empty);
    expect(line?.checkpoint).toBeNull();
    expect(line?.reading.status).toBe('not-covered');
  });

  it('changes no verdict: `verify` says what it said, and stamping still asks for nothing', async () => {
    // What was aligned is the COUNT. The verdict over the record is the verifier's and it is
    // untouched — the empty tail was already folded into it — and an act over the tails walks
    // past the empty one without asking anybody anything about it.
    anEmptyTail();
    const verified = await mnema('verify');
    expect(verified.out.join(' / ')).toContain('all events are signature-covered');
    const upgraded = await mnema('witness', 'upgrade');
    expect(upgraded.failed, upgraded.err.join(' / ')).toBe(false);
    expect(upgraded.out.join(' / ')).toContain('skipped — the tail has no checkpoint to witness');
  });

  it('still refuses to stamp a tree whose only tail is empty — nothing is recorded there', async () => {
    // The listing counts the empty tail now; the refusal is about there being nothing to
    // witness, and a tree holding only an ownership proof holds nothing. Asked of this machine's
    // global tree, from outside any project, so that no other tail is beside it.
    const elsewhere = join(sandbox, 'elsewhere');
    mkdirSync(elsewhere, { recursive: true });
    process.chdir(elsewhere);
    anEmptyTail(resolveTrees(elsewhere, { home: join(sandbox, 'home') }).global);
    const listed = await mnema('witness', '--global');
    expect(listed.out[0], listed.out.join(' / ')).toBe('1 tail(s):');
    const stamped = await mnema('witness', 'stamp', '--global');
    expect(stamped.failed).toBe(true);
    expect(stamped.err.join(' / ')).toContain('Refused (NO_TAIL)');
  });
});
