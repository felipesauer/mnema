/**
 * `mnema tail relink` ON THE BUILT BINARY, READ BY BOTH READERS (FORMAT.md section 6.11, ADR-155,
 * ADR-157).
 *
 * WHAT IS RUN. Two repositories `mnema init` began apart, by one person (one `HOME`), each with a
 * decision recorded; the tails of one copied into the other, as a merge of two branches that each
 * ran `init` leaves them: two records in one directory, which both readers refuse
 * (`another-record`). Every state is built by the binary itself, in a sandbox with a `HOME` of its
 * own, and read by `mnema verify` and by the second reader (`mnema_verify.py`).
 *
 * WHAT IT HOLDS:
 *   - before the relink, a write there is refused `STALE_ANCHOR` in words that name the two records
 *     and `mnema tail relink`, and the anchor file is left where it is (it used to say to delete it,
 *     after which the write was refused `ANOTHER_RECORD`);
 *   - the verb relinks the other record's tail by its own key: both readers verify the directory as
 *     one record, and a write goes on in it;
 *   - from the checkout whose own tail is the one relinked, the relink and the writes after it go to
 *     a new tail, and the relinked tail is left byte for byte as it was;
 *   - a tail written by a second person, whose key no membership of the record took in, is not
 *     relinked: the refusal names ADR-157's rule, and nothing of the tails changes;
 *   - a tail whose key this machine does not hold is not relinked;
 *   - the tail that holds a relink is not cut while the tail it relinked is on disk.
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';
import { ROOT } from './support/published-examples.js';

const BINARY = join(ROOT, 'packages/code/dist/cli.js');
const VERIFIER = join(ROOT, 'packages/chain/verifier/mnema_verify.py');

let sandbox: string;

function env(machine: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: join(sandbox, machine),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
    GIT_AUTHOR_NAME: 'a',
    GIT_AUTHOR_EMAIL: 'a@example.invalid',
    GIT_COMMITTER_NAME: 'a',
    GIT_COMMITTER_EMAIL: 'a@example.invalid',
  };
}

/** `mnema <args>` in `dir`, as the machine whose HOME is `machine`. */
function mnema(machine: string, dir: string, ...args: string[]) {
  const ran = spawnSync(process.execPath, [BINARY, ...args], {
    cwd: dir,
    encoding: 'utf-8',
    env: env(machine),
  });
  return { status: ran.status ?? -1, out: ran.stdout, err: ran.stderr };
}

/** The second reader's verdict over the record of the repository at `repo`. */
function secondVerdict(repo: string): string {
  const run = spawnSync('python3', ['-I', VERIFIER, '--json', 'record', join(repo, '.mnema')], {
    encoding: 'utf-8',
  });
  if (run.error !== undefined) throw new Error(`python3 could not be run: ${run.error.message}`);
  return (JSON.parse(run.stdout) as { verdict: string }).verdict;
}

/** A repository `machine` ran `mnema init` in, with one decision recorded: its one tail. */
function anInit(machine: string, name: string): { repo: string; tail: string } {
  const repo = join(sandbox, name);
  mkdirSync(repo, { recursive: true });
  const git = spawnSync('git', ['init', '-q', '.'], { cwd: repo, env: env(machine) });
  expect(git.status).toBe(0);
  const init = mnema(machine, repo, 'init', '--all-hosts');
  expect(init.status, init.err).toBe(0);
  const recorded = mnema(
    machine,
    repo,
    'decision',
    'record',
    `Use X in ${name}`,
    `Because ${name}.`,
  );
  expect(recorded.status, recorded.err).toBe(0);
  const [tail] = readdirSync(join(repo, '.mnema', 'tails'));
  return { repo, tail: tail as string };
}

/** A copy of `into` with the tails and public keys of `from` copied in: the merge of two inits. */
function joined(into: string, from: string, name: string): string {
  const repo = join(sandbox, name);
  cpSync(into, repo, { recursive: true });
  for (const tail of readdirSync(join(from, '.mnema', 'tails'))) {
    cpSync(join(from, '.mnema', 'tails', tail), join(repo, '.mnema', 'tails', tail), {
      recursive: true,
    });
  }
  for (const key of readdirSync(join(from, '.mnema', 'keys'))) {
    if (key.endsWith('.pub')) {
      cpSync(join(from, '.mnema', 'keys', key), join(repo, '.mnema', 'keys', key));
    }
  }
  return repo;
}

/** Every file of the tails of the repository at `repo`, by path, with its bytes. */
function tailBytes(repo: string): Map<string, string> {
  const held = new Map<string, string>();
  const tails = join(repo, '.mnema', 'tails');
  for (const tail of readdirSync(tails)) {
    for (const file of readdirSync(join(tails, tail))) {
      held.set(`${tail}/${file}`, readFileSync(join(tails, tail, file), 'utf-8'));
    }
  }
  return held;
}

let a: { repo: string; tail: string };
let b: { repo: string; tail: string };

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-relink-'));
  a = anInit('person', 'pa');
  b = anInit('person', 'pb');
}, 120_000);

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('one person’s two inits, merged', () => {
  it('refuse a write STALE_ANCHOR naming the two records and the relink, and keep the anchor', () => {
    const repo = joined(b.repo, a.repo, 'merged-refused');
    const anchors = readdirSync(join(repo, '.mnema', 'keys')).filter((f) => f.endsWith('.anchor'));
    const wrote = mnema('person', repo, 'decision', 'record', 'After', 'Into two records.');
    expect(wrote.status).toBe(1);
    expect(wrote.err).toContain('Refused (STALE_ANCHOR): this directory holds tails of 2 records');
    expect(wrote.err).toContain('`mnema tail relink <tail> --reason "<why>"`');
    expect(wrote.err).not.toContain('delete ');
    expect(anchors).toHaveLength(1);
    expect(existsSync(join(repo, '.mnema', 'keys', anchors[0] as string))).toBe(true);
  }, 60_000);

  it('are one record once the verb relinks the other tail: both readers verify, and writes go on', () => {
    const repo = joined(b.repo, a.repo, 'merged');
    expect(mnema('person', repo, 'verify').status).toBe(1);
    expect(secondVerdict(repo)).toBe('REFUSED');

    const relinked = mnema(
      'person',
      repo,
      'tail',
      'relink',
      a.tail,
      '--reason',
      'Two inits, one project.',
    );
    expect(relinked.status, relinked.err).toBe(0);
    expect(relinked.out).toContain(`Relinked tail ${a.tail} into record `);
    expect(relinked.out).toContain(`written in tail ${b.tail} at seq `);
    expect(relinked.out).toContain('it brings 1 identity.founded');
    expect(relinked.out).toContain('1 decision(s)');

    const verified = mnema('person', repo, 'verify');
    expect(verified.status, verified.out).toBe(0);
    expect(verified.out).toContain('1 tail(s) relinked into this record by their own key');
    expect(secondVerdict(repo)).toBe('VERIFIED');

    const after = mnema(
      'person',
      repo,
      'decision',
      'record',
      'After the relink',
      'One record now.',
    );
    expect(after.status, after.err).toBe(0);
    expect(mnema('person', repo, 'verify').status).toBe(0);
    expect(secondVerdict(repo)).toBe('VERIFIED');

    // The tail that holds the relink is not cut while the tail it relinked is on disk.
    const before = tailBytes(repo);
    const cut = mnema('other', repo, 'tail', 'prune', b.tail, '--reason', 'cut the host');
    expect(cut.status).toBe(1);
    expect(cut.err).toContain('Refused (RELINK_WOULD_BE_UNDONE)');
    expect(cut.err).toContain(a.tail);
    expect(tailBytes(repo)).toEqual(before);
  }, 120_000);

  it('relinked from the checkout whose own tail it is: the writes go to a new tail, the old one frozen', () => {
    const repo = joined(a.repo, b.repo, 'merged-from-a');
    const frozen = tailBytes(repo);
    const relinked = mnema(
      'person',
      repo,
      'tail',
      'relink',
      a.tail,
      '--reason',
      'Two inits, one project.',
      '--which',
      'ci-bot',
    );
    expect(relinked.status, relinked.err).toBe(0);
    expect(relinked.out).toContain(`and left tail ${a.tail} as it is: it names record `);
    // `--which` reaches the fact: the relink line names the agent that executed it.
    const lines = [...tailBytes(repo)]
      .filter(([file]) => file.endsWith('.jsonl') && !file.endsWith('checkpoints.jsonl'))
      .flatMap(([, bytes]) => bytes.split('\n'))
      .filter((line) => line.includes('"kind":"tail.relinked"'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"which":"ci-bot"');
    const after = mnema(
      'person',
      repo,
      'decision',
      'record',
      'After the relink',
      'One record now.',
    );
    expect(after.status, after.err).toBe(0);
    for (const [file, bytes] of frozen) {
      if (file.startsWith(a.tail)) expect(tailBytes(repo).get(file), file).toBe(bytes);
    }
    expect(mnema('person', repo, 'verify').status).toBe(0);
    expect(secondVerdict(repo)).toBe('VERIFIED');
  }, 120_000);
});

describe('a relink the verb does not write', () => {
  it('of a second person’s tail: no membership of the record took that key in (ADR-157)', () => {
    const c = anInit('other', 'pc');
    const repo = joined(b.repo, c.repo, 'merged-two-people');
    const before = tailBytes(repo);
    const relinked = mnema('other', repo, 'tail', 'relink', c.tail, '--reason', 'Join it.');
    expect(relinked.status).toBe(1);
    expect(relinked.err).toContain('Refused (RELINK_WOULD_NOT_COUNT)');
    expect(relinked.err).toContain('(relink-not-a-member)');
    expect(relinked.err).toContain('(ADR-157)');
    expect(relinked.err).toContain('does not exist in this version');
    expect(tailBytes(repo)).toEqual(before);

    // And the person cannot relink it for them: the key is not theirs.
    const forThem = mnema('person', repo, 'tail', 'relink', c.tail, '--reason', 'Join it.');
    expect(forThem.status).toBe(1);
    expect(forThem.err).toContain('Refused (NOT_THE_OWNER)');
    expect(tailBytes(repo)).toEqual(before);
  }, 120_000);
});
