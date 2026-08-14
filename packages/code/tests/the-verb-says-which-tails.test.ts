/**
 * `mnema tail list` at the surface: the id comes out WHOLE, the verb beside it takes
 * that id, the answer names where it looked, and nothing on disk moves.
 *
 * THE ID IS THE WHOLE POINT OF THE READING. `tail prune` takes a tail id and until
 * this verb existed nothing in the product printed one — its own help said *"as
 * `verify` spells it"*, and `verify` spells a COUNT (`1 tail(s)`). So the case here
 * takes the id OFF THE PRINTED LINE and hands it to `prune`, which has to accept it.
 * A case comparing the line to a string the test composed would pass over an id
 * truncated for the column and prove nothing about the only use the list has.
 *
 * AND IT IS A READ, PROVED BY BYTES. The whole sandbox — chain, cache, keys — is
 * hashed before and after, the mould `guard.test.ts` uses for the other verb that
 * must write nothing. It is worth the strongest form here because the tempting
 * column (which of these tails is THIS machine's) is one only a writer knows, and a
 * writer opened to answer a read leaves an ownership proof behind: the digest is
 * what would catch that, and no lighter measurement would.
 */

import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { catalogUpcasters, openChainForWriting } from '@mnema/chain';
import { PROJECT_DIR, resolveTrees } from '@mnema/core';
import { createTask } from '@mnema/core/write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';

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

/**
 * A content digest of every file under `dir`, so a read that must write nothing can
 * be proven byte-identical — the shape `guard.test.ts` established.
 */
function digest(dir: string): string {
  const hash = createHash('sha256');
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        hash.update(`D:${relative(dir, full)}\n`);
        walk(full);
      } else {
        hash.update(`F:${relative(dir, full)}:${statSync(full).size}:`);
        hash.update(readFileSync(full));
        hash.update('\n');
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

/** The project's committed tree. */
function publicRoot(): string {
  return resolveTrees(repo, {
    xdgDataHome: join(sandbox, 'data'),
    home: join(sandbox, 'home'),
  }).projectPublic as string;
}

/**
 * A second machine's tail, merged into the committed tree the way an offline copy
 * is: its files, and the public half of the key that signed them.
 *
 * The tail a waiver names is always somebody else's — the door refuses one naming
 * the tail it is written to — so this is the only fixture a successful `prune` can
 * be driven over.
 */
function mergeAForeignTail(): string {
  const machine = join(sandbox, 'other-machine');
  mkdirSync(machine, { recursive: true });
  const writer = openChainForWriting(machine, { keyRoot: machine });
  const created = createTask(
    { writer, layout: { root: machine }, upcasters: catalogUpcasters() },
    { title: 'work another machine did' },
  );
  expect(created.ok, JSON.stringify(created)).toBe(true);
  writer.checkpoint();
  const into = publicRoot();
  for (const tail of readdirSync(join(machine, 'tails'))) {
    cpSync(join(machine, 'tails', tail), join(into, 'tails', tail), { recursive: true });
  }
  for (const key of readdirSync(join(machine, 'keys'))) {
    if (key.endsWith('.pub')) cpSync(join(machine, 'keys', key), join(into, 'keys', key));
  }
  return writer.tail;
}

/** The listed lines, without the header that counts them. */
function listedRows(said: Said): string[] {
  return said.out.filter((line) => line.startsWith('  '));
}

/** The id a listed row leads with — read off the line, never composed. */
function idOn(row: string): string {
  return row.trim().split(/\s+/)[0] as string;
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-tail-list-'));
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

describe('mnema tail list', () => {
  it('prints an id `tail prune` accepts, taken off the line rather than composed', async () => {
    const foreign = mergeAForeignTail();

    const listed = await mnema('tail', 'list');
    expect(listed.failed, listed.err.join(' / ')).toBe(false);
    expect(listed.out[0]).toBe('2 tail(s):');
    const row = listedRows(listed).find((line) => idOn(line) === foreign) as string;
    expect(row, `no row for ${foreign} in ${listed.out.join(' / ')}`).toBeDefined();

    // THE LINK: the id as it was PRINTED, into the verb the help sends a reader to.
    // A truncated id would be refused here, and only here — every other case in this
    // file would go on passing.
    const authorized = await mnema(
      'tail',
      'prune',
      idOn(row),
      '--reason',
      'the person asked to be taken out of the record',
    );
    expect(authorized.failed, authorized.err.join(' / ')).toBe(false);
    expect(authorized.out.join('\n')).toContain(`Authorized the cut of tail ${foreign}`);

    // And the listing says so afterwards, which is what keeps a second authorization
    // from being written over the first.
    const again = await mnema('tail', 'list');
    const row2 = listedRows(again).find((line) => idOn(line) === foreign) as string;
    expect(row2).toContain('cut authorized');
    expect(listedRows(again).filter((line) => line.includes('cut authorized'))).toHaveLength(1);
  });

  it('says the same events and head `prune` reports when it authorizes the cut', async () => {
    // The two numbers exist on this line so a person can decide BEFORE authorizing.
    // If they disagreed with what the waiver goes on to claim, the list would be
    // deciding on a record that is not the one being cut.
    const foreign = mergeAForeignTail();
    const listed = await mnema('tail', 'list');
    const row = listedRows(listed).find((line) => idOn(line) === foreign) as string;

    const authorized = await mnema('tail', 'prune', foreign, '--reason', 'a machine being wiped');
    const claim = authorized.out
      .map((line) => line.match(/(\d+) event\(s\) through ([0-9a-f]+)/))
      .find((found) => found !== null) as RegExpMatchArray;
    expect(row).toContain(`${claim[1] as string} event(s) through ${claim[2] as string}`);
  });

  it('names every tree it looked in when it finds no tail at all', async () => {
    // A project directory with no record in it — the shape a partial clone leaves,
    // and the one `verify` already words as "no record here". The answer may not be
    // silence: a reader who ran this in the wrong directory needs to be told WHERE
    // empty was measured.
    const bare = join(sandbox, 'bare');
    mkdirSync(join(bare, PROJECT_DIR), { recursive: true });
    process.chdir(bare);
    process.env.XDG_DATA_HOME = join(sandbox, 'other-data');

    const said = await mnema('tail', 'list');
    expect(said.failed, said.err.join(' / ')).toBe(false);
    expect(said.out).toEqual([
      'No tail holds events in any tree here — looked in public, private, global.',
    ]);

    // Outside a project there is one tree left to look in, and the sentence says so
    // rather than naming trees that are not there.
    const nowhere = join(sandbox, 'nowhere');
    mkdirSync(nowhere, { recursive: true });
    process.chdir(nowhere);
    const outside = await mnema('tail', 'list');
    expect(outside.out).toEqual(['No tail holds events in any tree here — looked in global.']);
  });

  it('writes nothing: the sandbox is byte-identical after it', async () => {
    mergeAForeignTail();
    // Read once first, so anything a first read builds (a projection cache) is
    // already there and the digest is measuring THIS invocation.
    await mnema('tail', 'list');

    const before = digest(sandbox);
    const said = await mnema('tail', 'list');
    expect(said.failed, said.err.join(' / ')).toBe(false);
    expect(listedRows(said)).toHaveLength(2);
    expect(digest(sandbox)).toBe(before);
  });

  it('is the verb `tail prune` sends a reader to for the id it takes', async () => {
    // A4: the help asserts where the id is read, and this is what holds the sentence
    // to being true. It USED TO name `verify`, which prints a count and no id — a
    // doc-comment for a behaviour nothing in the product had.
    const help = await mnema('tail', 'prune', '--help');
    const text = help.out.join('\n');
    expect(text).toContain('as `tail list` spells it');
    expect(text).not.toContain('as `verify` spells it');
  });
});
