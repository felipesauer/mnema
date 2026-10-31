/**
 * `mnema tail prune` REFUSES TO AUTHORIZE THE CUT OF A TAIL THE RECORD STILL NEEDS FOR A KEY
 * (ADR-151 and ADR-154).
 *
 * An identity lives only in the tail that wrote it: `identity.founded` and each `key.enrolled`
 * are entries of the founder's or the enroller's tail, and the waiver carries none of it. Cut the
 * founder's tail of a two-key identity and `verify` fails (T2/T4) in both readers; cut the tail of
 * a founder whose enrolled key never wrote and `verify` stays green while that key is left with no
 * identity. The verb refuses both, names every key and says which of the two happens to it, and
 * cuts only when `--lose-keys` names exactly those keys.
 *
 * WHAT IS RUN. The built binary, a `HOME` of its own per machine (A founds, C is enrolled by A, B
 * founds an identity of its own), the cut done by `rm -r` of the tail directory. The cases:
 *   - K1: A's tail, C wrote: refused; the printed command accepted; after the cut both readers
 *     refuse the record, so the words "breaks" in the refusal were true.
 *   - K3, the control: C's tail holds no founding or enrollment: cut without the option, and both
 *     readers verify.
 *   - K4: C enrolled and never wrote: the refusal says "stranded" for every key, not "breaks", and
 *     `verify` after the cut is green (the case the green verdict hides).
 *   - `tail list` marks the tail that holds keys and not the one that holds none.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT } from './support/published-examples.js';

const BINARY = join(ROOT, 'packages/code/dist/cli.js');
const VERIFIER = join(ROOT, 'packages/chain/verifier/mnema_verify.py');

let sandbox: string;

interface Ran {
  status: number;
  out: string;
  err: string;
}

/** `mnema <args>` in `repo`, as the machine whose HOME is `<world>/<machine>`. */
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

function secondVerdict(world: string): string {
  const run = spawnSync(
    'python3',
    ['-I', VERIFIER, '--json', 'record', join(world, 'repo', '.mnema')],
    { encoding: 'utf-8' },
  );
  if (run.error !== undefined) throw new Error(`python3 could not be run: ${run.error.message}`);
  return (JSON.parse(run.stdout) as { verdict: string }).verdict;
}

function tailsOf(world: string): string[] {
  return readdirSync(join(world, 'repo', '.mnema', 'tails'));
}

/** The lines of every segment of a tail, as text. */
function textOf(world: string, tail: string): string {
  const dir = join(world, 'repo', '.mnema', 'tails', tail);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl') && name !== 'checkpoints.jsonl')
    .map((name) => readFileSync(join(dir, name), 'utf-8'))
    .join('');
}

/** Every file under `.mnema/tails`, with its bytes: what "nothing was written" is held against. */
function bytesUnderTails(world: string): Map<string, string> {
  const held = new Map<string, string>();
  for (const tail of tailsOf(world)) {
    const dir = join(world, 'repo', '.mnema', 'tails', tail);
    for (const name of readdirSync(dir))
      held.set(`${tail}/${name}`, readFileSync(join(dir, name), 'utf-8'));
  }
  return held;
}

/**
 * A world: A founded an identity (its tail `founder`) and B founded another; C asked to join A and
 * was enrolled by A. With `cWrites`, C has written once (its tail `joined`).
 */
function build(name: string, cWrites: boolean): { world: string; founder: string; joined: string } {
  const world = join(sandbox, name);
  mkdirSync(join(world, 'repo'), { recursive: true });
  for (const machine of ['A', 'B', 'C']) mkdirSync(join(world, machine));
  written(world, 'A', 'init', '--all-hosts');
  written(world, 'A', 'decision', 'record', 'A decides', 'A reason');
  const founder = tailsOf(world)[0] as string;
  written(world, 'B', 'decision', 'record', 'B decides', 'B reason');
  const status = written(world, 'A', 'status', '--json');
  const anchor = /mnid:[0-9a-f]{64}/.exec(status.out)?.[0] as string;
  const request = written(world, 'C', 'key', 'request', '--anchor', anchor);
  const line = /^mnema-key-request:\S+$/m.exec(request.out)?.[0] as string;
  written(world, 'A', 'key', 'enroll', line);
  let joined = '';
  if (cWrites) {
    const before = new Set(tailsOf(world));
    written(world, 'C', 'decision', 'record', 'C decides', 'C reason');
    joined = tailsOf(world).find((tail) => !before.has(tail)) as string;
  }
  return { world, founder, joined };
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-keys-in-a-tail-'));
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the founder tail of a two-key identity, C having written', () => {
  let world: string;
  let founder: string;
  let joined: string;
  let refused: Ran;
  let untouched: boolean;

  beforeAll(() => {
    const built = build('two-keys', true);
    world = built.world;
    founder = built.founder;
    joined = built.joined;
    const before = bytesUnderTails(world);
    refused = mnema(world, 'C', 'tail', 'prune', founder, '--reason', 'A asked out');
    untouched = JSON.stringify([...bytesUnderTails(world)]) === JSON.stringify([...before]);
  }, 120_000);

  it('is refused, names every key and says which one breaks and which are stranded', () => {
    expect(refused.status).toBe(1);
    expect(refused.err).toContain('Refused (KEYS_WOULD_BE_LOST)');
    expect(refused.err).toContain('(founded) is stranded');
    expect(refused.err).toContain('(enrolled) breaks');
    expect(refused.err).toContain('--lose-keys ');
  });

  it('writes nothing when it refuses', () => {
    expect(untouched).toBe(true);
  });

  it('lists the tail as one that holds keys, and the joined tail as one that holds none', () => {
    const listed = mnema(world, 'C', 'tail', 'list').out.split('\n');
    const row = (tail: string) => listed.find((line) => line.trim().startsWith(tail)) as string;
    expect(row(founder)).toContain('holds 3 key(s) the record needs');
    expect(row(joined)).not.toContain('holds');
  });

  it('accepts the command it printed, starts the reason with the keys, and the cut then breaks both readers', () => {
    const named = /--lose-keys (\S+)/.exec(refused.err)?.[1] as string;
    expect(named.split(',')).toHaveLength(3);
    const done = mnema(
      world,
      'C',
      'tail',
      'prune',
      founder,
      '--reason',
      'A asked out',
      '--lose-keys',
      named,
    );
    expect(done.status, done.err).toBe(0);

    const waiver = tailsOf(world)
      .map((tail) => textOf(world, tail))
      .join('')
      .split('\n')
      .find((line) => line.includes('"tail.pruned"')) as string;
    const reason = (JSON.parse(waiver) as { event: { payload: { reason: string } } }).event.payload
      .reason;
    expect(reason.startsWith('Keys lost: ')).toBe(true);
    for (const fp of named.split(',')) expect(reason).toContain(fp);
    expect(reason.endsWith('A asked out')).toBe(true);

    rmSync(join(world, 'repo', '.mnema', 'tails', founder), { recursive: true });
    const verified = mnema(world, 'B', 'verify', '--require=signed');
    expect(verified.status).toBe(1);
    expect(verified.err + verified.out).toContain('T2/T4');
    expect(secondVerdict(world)).toBe('REFUSED');
  });
});

describe('the control: the tail of a key that was only enrolled', () => {
  it('is cut with no option, and both readers verify the record after the cut', () => {
    const built = build('control', true);
    const done = mnema(built.world, 'A', 'tail', 'prune', built.joined, '--reason', 'C asked out');
    expect(done.status, done.err).toBe(0);
    rmSync(join(built.world, 'repo', '.mnema', 'tails', built.joined), { recursive: true });
    const verified = mnema(built.world, 'B', 'verify', '--require=signed');
    expect(verified.status, verified.err).toBe(0);
    expect(secondVerdict(built.world)).toBe('VERIFIED');
  });
});

describe('the founder tail when the enrolled key never wrote', () => {
  it('is refused with every key stranded, and the verify that follows a forced cut stays green', () => {
    const built = build('never-wrote', false);
    const refused = mnema(
      built.world,
      'B',
      'tail',
      'prune',
      built.founder,
      '--reason',
      'A asked out',
    );
    expect(refused.status).toBe(1);
    expect(refused.err).toContain('Refused (KEYS_WOULD_BE_LOST)');
    expect(refused.err).not.toContain(') breaks');
    expect(refused.err.match(/is stranded/g)).toHaveLength(3);

    const named = /--lose-keys (\S+)/.exec(refused.err)?.[1] as string;
    const done = mnema(
      built.world,
      'B',
      'tail',
      'prune',
      built.founder,
      '--reason',
      'A asked out',
      '--lose-keys',
      named,
    );
    expect(done.status, done.err).toBe(0);
    rmSync(join(built.world, 'repo', '.mnema', 'tails', built.founder), { recursive: true });
    // The green verdict is the reason the refusal exists: the keys are lost all the same.
    expect(mnema(built.world, 'B', 'verify', '--require=signed').status).toBe(0);
    const writeByA = mnema(built.world, 'A', 'decision', 'record', 'A after', 'the cut');
    expect(writeByA.status).toBe(1);
    expect(writeByA.err).toContain('STALE_ANCHOR');
  });

  it('refuses a list that leaves out a key', () => {
    const built = build('short-list', false);
    const first = mnema(built.world, 'B', 'tail', 'prune', built.founder, '--reason', 'r');
    const named = (/--lose-keys (\S+)/.exec(first.err)?.[1] ?? '').split(',');
    const short = mnema(
      built.world,
      'B',
      'tail',
      'prune',
      built.founder,
      '--reason',
      'r',
      '--lose-keys',
      named.slice(1).join(','),
    );
    expect(short.status).toBe(1);
    expect(short.err).toContain('KEYS_WOULD_BE_LOST');
  });
});
