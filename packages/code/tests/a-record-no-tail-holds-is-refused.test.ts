/**
 * A RECORD IN WHICH NO TAIL HOLDS ANYTHING IS REFUSED, BY NAME — at the binary a person runs.
 *
 * Measured before this, on a record of one tail with that tail's directory deleted: `mnema verify`
 * said `verified (T1 only); 0 tail(s); no events yet`, named each committed key in the census, and
 * exited 0, while the second reader beside FORMAT.md said BROKEN, exit 3, over the same bytes. Both
 * refuse it now, with exit 1 (FORMAT.md section 4), and the census still names the keys.
 *
 * WHAT EACH CASE IS FOR:
 *   - the deleted tail fails the bare `verify`, and says why by name, not by a tail it cannot name;
 *   - the shapes that are NOT this stay green: a fresh `init` (it founds with events before it
 *     returns), a clone on another machine (the committed tree is all it gets), and a machine
 *     enrolled that has not written yet beside a tail that has — the case a reader that refused
 *     every committed key with no tail would break;
 *   - an `init` that failed half way leaves `.mnema/` with nothing in it: refused until a first
 *     public write founds the record, and a second `init` does not.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/** The built binary — what a person runs. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** The words both readers refuse it by. */
const NO_TAIL = 'no tail in this record holds an event or a checkpoint';

let sandbox: string;
let repo: string;
let home: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-no-tail-holds-'));
  repo = join(sandbox, 'repo');
  home = join(sandbox, 'home');
  for (const dir of [repo, home]) mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  chmodSync(home, 0o755);
  rmSync(sandbox, { recursive: true, force: true });
});

/** `mnema <argv>` in `dir`, as the key under `as`. */
function mnemaIn(
  dir: string,
  as: string,
  ...argv: string[]
): { status: number | null; stdout: string; stderr: string } {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: dir,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: as },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

function mnema(...argv: string[]): ReturnType<typeof mnemaIn> {
  return mnemaIn(repo, home, ...argv);
}

function did(...argv: string[]): string {
  const ran = mnema(...argv);
  expect(ran.status, `${argv.join(' ')}: ${ran.stderr}`).toBe(0);
  return ran.stdout;
}

/** A project founded here, with two decisions in its one tail. Answers its identity. */
function aRecord(): string {
  const anchor = /identity: (mnid:[0-9a-f]{64})/.exec(did('init'))?.[1];
  expect(anchor).toBeDefined();
  did('decision', 'record', 'Use the standard library', 'Because it is there');
  did('decision', 'record', 'Keep the record in the repository', 'Because it travels');
  return anchor as string;
}

const tails = (): string[] => readdirSync(join(repo, '.mnema', 'tails'));

describe('mnema verify over a record in which no tail holds anything', () => {
  it('exits 1 with its one tail deleted, names it as the record, and still names the keys', () => {
    aRecord();
    expect(tails()).toHaveLength(1);
    rmSync(join(repo, '.mnema', 'tails', tails()[0] as string), { recursive: true });

    const said = mnema('verify');
    expect(said.status).toBe(1);
    expect(said.stdout).toContain('public: local integrity FAILED');
    const issue = said.stderr.split('\n').find((line) => line.includes(NO_TAIL));
    expect(issue, said.stderr).toBeDefined();
    expect(issue).toContain('issue [T1] public the record:');
    expect(issue).toContain('there are no tails');
    // Section 6.5 still runs: the key that wrote the deleted tail is named.
    expect(said.stdout).toContain('census [key-without-tail] public');
  });

  it('exits 0 on a project init has just founded', () => {
    did('init');
    const said = mnema('verify');
    expect(said.status, said.stderr).toBe(0);
    expect(said.stderr).not.toContain(NO_TAIL);
  });

  it('exits 0 on a clone of it read on another machine', () => {
    aRecord();
    const clone = join(sandbox, 'clone');
    const elsewhere = join(sandbox, 'elsewhere');
    mkdirSync(clone);
    mkdirSync(elsewhere);
    cpSync(join(repo, '.mnema'), join(clone, '.mnema'), { recursive: true });
    const said = mnemaIn(clone, elsewhere, 'verify');
    expect(said.status, said.stderr).toBe(0);
  });

  it('exits 0 with a machine enrolled that has not written yet, beside the tail that has', () => {
    const anchor = aRecord();
    const other = join(sandbox, 'other-machine');
    mkdirSync(other);
    const asked = mnemaIn(sandbox, other, 'key', 'request', '--anchor', anchor);
    expect(asked.status, asked.stderr).toBe(0);
    const request = asked.stdout.split('\n').find((line) => line.startsWith('mnema-key-request:'));
    did('key', 'enroll', request as string);

    const said = mnema('verify');
    expect(said.status, said.stderr).toBe(0);
    expect(said.stdout).toContain('census [key-without-tail] public');
    expect(said.stderr).not.toContain(NO_TAIL);
  });

  it('exits 1 after an init that failed half way, until a first public write founds the record', () => {
    // A home this run cannot write to: init makes `.mnema/` and fails making the key.
    chmodSync(home, 0o555);
    const failed = mnema('init');
    chmodSync(home, 0o755);
    expect(failed.status).toBe(1);
    expect(existsSync(join(repo, '.mnema'))).toBe(true);

    const refused = mnema('verify');
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain(NO_TAIL);

    // A second init says there is nothing to found, and founds nothing.
    const again = mnema('init');
    expect(again.stdout).toContain('nothing to found');
    expect(mnema('verify').status).toBe(1);

    did('decision', 'record', 'The first public fact', 'It founds the record');
    const founded = mnema('verify');
    expect(founded.status, founded.stderr).toBe(0);
  });
});
