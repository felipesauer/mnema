/**
 * A PROJECT CAN INHERIT ANOTHER REPOSITORY'S DECISIONS, AT ONE COMMIT: through the binary.
 *
 * The origin is a local git repository built in the sandbox with the product's own commands, so no
 * network is touched. What is asserted is what a person at a terminal sees: `inherit set` shows
 * what would be inherited and writes nothing until `--write`; the brief then carries the origin's
 * decision in a section of its own, naming the repository and the commit; and an update shows what
 * changed between the two commits before it moves the pointer.
 */

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CatalogEvent,
  canonicalStringify,
  entryHash,
  memoryCaptured,
  READER_VERSION,
  writtenAsBuilt,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POINTER_FILE } from '../src/inherited-record.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-inherits-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function mnema(dir: string, home: string, ...argv: string[]) {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: dir,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home },
  });
  return { status: ran.status, out: ran.stdout, err: ran.stderr };
}

function git(dir: string, ...args: string[]): string {
  const ran = spawnSync(
    'git',
    [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    {
      cwd: dir,
      encoding: 'utf-8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: join(sandbox, 'git-home'),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
      },
    },
  );
  if (ran.status !== 0) throw new Error(`setup: git ${args.join(' ')}: ${ran.stderr}`);
  return ran.stdout.trim();
}

/** Records a decision in `dir` as `home` and accepts it. */
function decide(dir: string, home: string, title: string): void {
  const recorded = mnema(dir, home, 'decision', 'record', title, 'because we said so');
  const id = /^Recorded decision .*?\(([^)]+)\)/m.exec(recorded.out)?.[1];
  expect(recorded.status, recorded.err).toBe(0);
  const accepted = mnema(dir, home, 'decision', 'move', 'accept', id as string, '--note', 'agreed');
  expect(accepted.status, accepted.err).toBe(0);
}

/** Every stored line of every tail of the record at `dir`, read off the files themselves. */
function linesOf(dir: string): string[] {
  const tails = join(dir, '.mnema', 'tails');
  return readdirSync(tails, { recursive: true, encoding: 'utf-8' })
    .filter((name) => /\d+\.jsonl$/.test(name))
    .flatMap((name) => readFileSync(join(tails, name), 'utf-8').split('\n'))
    .filter((line) => line.length > 0);
}

function commit(dir: string): string {
  git(dir, 'add', '.mnema');
  git(dir, 'commit', '-q', '-m', 'record');
  return git(dir, 'rev-parse', 'HEAD');
}

describe('inheriting, as a person types it', () => {
  it('shows, then points, then prints the decision under the origin’s name, and updates only on request', () => {
    const source = join(sandbox, 'decisions');
    const project = join(sandbox, 'service');
    const homeS = join(sandbox, 'home-s');
    const homeP = join(sandbox, 'home-p');
    for (const dir of [source, project, homeS, homeP]) mkdirSync(dir, { recursive: true });
    git(source, 'init', '-q', '-b', 'main');
    expect(mnema(source, homeS, 'init').status).toBe(0);
    decide(source, homeS, 'Postgres in every new service');
    const first = commit(source);
    expect(mnema(project, homeP, 'init').status).toBe(0);

    const recordBefore = linesOf(project);
    const shown = mnema(project, homeP, 'inherit', 'set', source);
    expect(shown.status, shown.err).toBe(0);
    expect(shown.out).toContain('+ Postgres in every new service');
    expect(shown.out).toContain('Nothing written');
    expect(existsSync(join(project, '.mnema', POINTER_FILE))).toBe(false);

    const set = mnema(project, homeP, 'inherit', 'set', source, '--write');
    expect(set.status, set.err).toBe(0);
    expect(JSON.parse(readFileSync(join(project, '.mnema', POINTER_FILE), 'utf-8'))).toEqual({
      origin: source,
      commit: first,
    });

    const brief = mnema(project, homeP, 'brief');
    expect(brief.status, brief.err).toBe(0);
    const [own, inherited] = brief.out.split('## Inherited decisions');
    expect(own).not.toContain('Postgres');
    expect(inherited).toContain('Postgres in every new service');
    expect(inherited).toContain(source);
    expect(inherited).toContain(first);

    decide(source, homeS, 'Redis for queues');
    const second = commit(source);
    expect(mnema(project, homeP, 'brief').out).not.toContain('Redis');
    const update = mnema(project, homeP, 'inherit', 'update');
    expect(update.status, update.err).toBe(0);
    expect(update.out).toContain('+ Redis for queues');
    expect(update.out).toContain(`${first} -> ${second}`);
    expect(JSON.parse(readFileSync(join(project, '.mnema', POINTER_FILE), 'utf-8')).commit).toBe(
      first,
    );
    expect(mnema(project, homeP, 'inherit', 'update', '--write').status).toBe(0);
    expect(mnema(project, homeP, 'brief').out).toContain('Redis for queues');

    // Pointing at another record, and moving the pointer, signed nothing into this project's own.
    expect(linesOf(project)).toEqual(recordBefore);
    // The project's own verify counts its own record: the inherited one is not in it.
    const verified = mnema(project, homeP, 'verify');
    expect(verified.status, verified.err).toBe(0);
  }, 90_000);

  it('says it plainly when the origin is gone and nothing was copied, and the brief still prints', () => {
    const project = join(sandbox, 'service');
    const homeP = join(sandbox, 'home-p');
    for (const dir of [project, homeP]) mkdirSync(dir, { recursive: true });
    expect(mnema(project, homeP, 'init').status).toBe(0);
    const refused = mnema(project, homeP, 'inherit', 'set', join(sandbox, 'nowhere'), '--write');
    expect(refused.status).not.toBe(0);
    expect(refused.err).toContain('could not be reached');
    expect(existsSync(join(project, '.mnema', POINTER_FILE))).toBe(false);
  }, 60_000);
});

/**
 * Appends to the origin's tail a line carrying `kind` and `v`, chained to the last one: what a
 * newer writer leaves for this reader. Nothing else is wrong with it where the reading stops: a
 * line no contract reads is refused at the parse, before any signature is looked at.
 */
function appendAhead(dir: string, kind: string, v: number): void {
  const tails = join(dir, '.mnema', 'tails');
  const segments = readdirSync(tails, { recursive: true, encoding: 'utf-8' })
    .filter((name) => /\d+\.jsonl$/.test(name))
    .sort();
  const segment = join(tails, segments.at(-1) as string);
  const stored = readFileSync(segment, 'utf-8').split('\n').filter(Boolean);
  const last = JSON.parse(stored.at(-1) as string) as {
    event: { who: string; signerFp: string };
    link: { tail: string; seq: number; hash: string };
  };
  const built = memoryCaptured(
    {
      who: last.event.who,
      signerFp: last.event.signerFp,
      at: '2026-10-15T00:00:09.000Z',
      subject: 'm-ahead',
    },
    { content: 'Written by a newer writer.' },
  );
  const event = { ...built, kind, v } as unknown as CatalogEvent;
  const seq = last.link.seq + 1;
  const prev = last.link.hash;
  const hash = entryHash({ event: writtenAsBuilt(event), tail: last.link.tail, seq, prev });
  appendFileSync(
    segment,
    `${canonicalStringify({ event: event as never, link: { tail: last.link.tail, seq, prev, hash } })}\n`,
  );
}

describe('an origin whose record holds a line this mnema has no contract for', () => {
  // The refusal every other reading of such a record gives (`FORMAT.md` §7.1): the pair, what this
  // reader holds of that kind, and which mnema refuses.
  const refusal = (said: string) =>
    `mnema ${READER_VERSION} does not read ${said}. If a newer mnema wrote the line, read the ` +
    'record with it.';

  it.each([
    ['memory.foretold', 1, '"memory.foretold" at v1: it reads no version of that kind'],
    ['memory.captured', 2, '"memory.captured" at v2: it reads that kind up to v1'],
  ])(
    'refuses %s at v%i by naming it, in `inherit set`, `inherit update` and the brief',
    (kind, v, said) => {
      const source = join(sandbox, 'decisions');
      const project = join(sandbox, 'service');
      const other = join(sandbox, 'other-service');
      const homeS = join(sandbox, 'home-s');
      const homeP = join(sandbox, 'home-p');
      for (const dir of [source, project, other, homeS, homeP]) mkdirSync(dir, { recursive: true });
      git(source, 'init', '-q', '-b', 'main');
      expect(mnema(source, homeS, 'init').status).toBe(0);
      decide(source, homeS, 'Postgres in every new service');
      const clean = commit(source);
      expect(mnema(project, homeP, 'init').status).toBe(0);
      expect(mnema(other, homeP, 'init').status).toBe(0);
      // The control: the same origin, before the line, is read.
      const pointed = mnema(project, homeP, 'inherit', 'set', source, '--write');
      expect(pointed.status, pointed.err).toBe(0);
      expect(pointed.out).toContain('+ Postgres in every new service');

      appendAhead(source, kind, v);
      const ahead = commit(source);

      const set = mnema(other, homeP, 'inherit', 'set', source);
      expect(set.status).not.toBe(0);
      expect(set.err).toContain('The record at that commit is not read, so no pointer is moved.');
      expect(set.err).toContain(refusal(said));

      const update = mnema(project, homeP, 'inherit', 'update');
      expect(update.status).not.toBe(0);
      expect(update.err).toContain(refusal(said));
      expect(JSON.parse(readFileSync(join(project, '.mnema', POINTER_FILE), 'utf-8')).commit).toBe(
        clean,
      );

      // A pointer written by hand at the commit `update` refused; this machine already holds it.
      writeFileSync(
        join(project, '.mnema', POINTER_FILE),
        `${JSON.stringify({ origin: source, commit: ahead })}\n`,
      );
      const brief = mnema(project, homeP, 'brief');
      expect(brief.status, brief.err).toBe(0);
      const section = brief.out.split('## Inherited decisions (not read)')[1] ?? '';
      expect(section).toContain(`the record there did not verify: `);
      expect(section).toContain(refusal(said));
      expect(section).not.toContain('Postgres');
    },
    120_000,
  );

  it('does not name a version when the line is unread for another reason: it was altered', () => {
    const source = join(sandbox, 'decisions');
    const project = join(sandbox, 'service');
    const homeS = join(sandbox, 'home-s');
    const homeP = join(sandbox, 'home-p');
    for (const dir of [source, project, homeS, homeP]) mkdirSync(dir, { recursive: true });
    git(source, 'init', '-q', '-b', 'main');
    expect(mnema(source, homeS, 'init').status).toBe(0);
    decide(source, homeS, 'Postgres in every new service');
    const tails = join(source, '.mnema', 'tails');
    const segment = join(
      tails,
      readdirSync(tails, { recursive: true, encoding: 'utf-8' })
        .filter((name) => /\d+\.jsonl$/.test(name))
        .sort()
        .at(-1) as string,
    );
    const before = readFileSync(segment, 'utf-8');
    writeFileSync(
      segment,
      before.replace('Postgres in every new service', 'MySQL in every new service'),
    );
    expect(readFileSync(segment, 'utf-8')).not.toBe(before);
    commit(source);
    expect(mnema(project, homeP, 'init').status).toBe(0);

    const set = mnema(project, homeP, 'inherit', 'set', source);
    expect(set.status).not.toBe(0);
    expect(set.err).toContain('The record at that commit is not read, so no pointer is moved.');
    expect(set.err).not.toContain('does not read');
    expect(set.err).not.toContain(READER_VERSION);
  }, 90_000);
});
