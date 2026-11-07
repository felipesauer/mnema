/**
 * A key whose founding or enrolment lived in a tail that was cut is told what happened when its
 * next write founds an identity beside the others, and a write that is refused says nothing of a
 * tail it wrote.
 *
 * WHAT IS RUN. The built binary, a `HOME` of its own per machine: A founds, B founds another
 * identity, C is enrolled by A and never writes, and A's tail is cut with `--lose-keys` and removed
 * from the disk (the case the tail prune tests call K4). Then:
 *   - C writes: its key finds no identity, founds one beside B's, and the sentence says the key
 *     was lost with the cut, not that a person new to the record arrived, and points to nobody's
 *     `key request --anchor`;
 *   - the control: a key that was never in a cut still gets the sentence for a person new to the
 *     record;
 *   - A writes: the checkout's recorded identity no longer counts its key, the write is refused
 *     `STALE_ANCHOR`, and nothing on that run says a write went to a new tail, because none did.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT } from './support/published-examples.js';

const BINARY = join(ROOT, 'packages/code/dist/cli.js');

let sandbox: string;

interface Ran {
  status: number;
  out: string;
  err: string;
}

function mnema(world: string, machine: string, ...args: string[]): Ran {
  const ran = spawnSync(process.execPath, [BINARY, ...args], {
    cwd: join(world, 'repo'),
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: join(world, machine) },
  });
  return { status: ran.status ?? -1, out: ran.stdout, err: ran.stderr };
}

function written(world: string, machine: string, ...args: string[]): Ran {
  const ran = mnema(world, machine, ...args);
  if (ran.status !== 0) throw new Error(`mnema ${args.join(' ')}: ${ran.err}`);
  return ran;
}

/** A founded and wrote, B founded another identity, C was enrolled by A and never wrote. */
function build(name: string): { world: string; founder: string } {
  const world = join(sandbox, name);
  mkdirSync(join(world, 'repo'), { recursive: true });
  for (const machine of ['A', 'B', 'C']) mkdirSync(join(world, machine));
  written(world, 'A', 'init', '--all-hosts');
  written(world, 'A', 'decision', 'record', 'A decides', 'A reason');
  const founder = readdirSync(join(world, 'repo', '.mnema', 'tails'))[0] as string;
  written(world, 'B', 'decision', 'record', 'B decides', 'B reason');
  const anchor = /mnid:[0-9a-f]{64}/.exec(written(world, 'A', 'status', '--json').out)?.[0];
  const request = written(world, 'C', 'key', 'request', '--anchor', anchor as string);
  written(world, 'A', 'key', 'enroll', /^mnema-key-request:\S+$/m.exec(request.out)?.[0] as string);
  return { world, founder };
}

/** Cuts the tail the way the tail prune tests do: authorized with the keys named, then removed. */
function cut(world: string, founder: string): void {
  const refused = mnema(world, 'B', 'tail', 'prune', founder, '--reason', 'A asked out');
  const named = /--lose-keys (\S+)/.exec(refused.err)?.[1] as string;
  written(world, 'B', 'tail', 'prune', founder, '--reason', 'A asked out', '--lose-keys', named);
  rmSync(join(world, 'repo', '.mnema', 'tails', founder), { recursive: true });
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-cut-key-'));
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('an enrolled key whose enrolment was cut with its tail', () => {
  let c: Ran;
  let a: Ran;

  beforeAll(() => {
    const { world, founder } = build('cut');
    cut(world, founder);
    c = mnema(world, 'C', 'decision', 'record', 'C decides', 'C reason');
    a = mnema(world, 'A', 'decision', 'record', 'A after', 'the cut');
  }, 120_000);

  it('is told its place was lost with the cut, and is not told it is a person new to the record', () => {
    expect(c.status, c.err).toBe(0);
    expect(c.err).toContain('This key founded an identity of its own in the public tree');
    expect(c.err).toContain('cut');
    expect(c.err).toContain('lost');
    expect(c.err).not.toContain('there is nothing to do');
    expect(c.err).not.toContain('everyone after the first arrives');
  });

  it('is not sent to ask another identity to enroll it', () => {
    expect(c.err).not.toContain('key request --anchor');
  });

  it('refuses the founder with STALE_ANCHOR and says no write went to a new tail', () => {
    expect(a.status).toBe(1);
    expect(a.err).toContain('Refused (STALE_ANCHOR)');
    expect(a.err).not.toContain('wrote to a new tail');
  });
});

describe('the control: a key that was never in a cut', () => {
  it('still hears the sentence for a person new to the record', () => {
    const { world } = build('control');
    const c = mnema(world, 'C', 'decision', 'record', 'C decides', 'C reason');
    expect(c.status, c.err).toBe(0);
    // C was enrolled and adopts the identity: no founding, no sentence. B arrives as new.
    const fresh = join(world, 'D');
    mkdirSync(fresh);
    const d = mnema(world, 'D', 'decision', 'record', 'D decides', 'D reason');
    expect(d.err).toContain('This key founded an identity of its own');
    expect(d.err).toContain('there is nothing to do');
  }, 120_000);
});
