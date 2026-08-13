/**
 * `mnema tail prune` — the verb that authorizes a cut and cuts nothing.
 *
 * The fact existed before the verb did: a `tail.pruned` written while the tail is
 * still on disk, with its head hash, its event count and the anchor it served all
 * read off the record and checked against it at write time. Nothing on any surface
 * could write one, so the census note that the fact exists to explain could never be
 * reached from a command. This file is the other end of that: the verb, and the two
 * halves of what it promises.
 *
 * THE FIRST HALF IS THAT IT PRODUCES WHAT THE VERIFIER READS. A waiver written here,
 * then the files removed by the person who authorized it, and `mnema verify` — the
 * same binary, untouched by this delivery — stops listing the three readings of an
 * orphaned key and NAMES the account instead. Proving it against the surface this
 * delivery did not write is the point: repeating my own numbers back would prove that
 * two functions in this repository agree.
 *
 * THE SECOND HALF IS THAT IT REMOVES NOTHING, and it is asserted byte for byte. It
 * is not a shortcut to be finished later. On a real project with the chain committed
 * — which is how a record travels — deleting a tail's directory left `git status`
 * reporting the deletions and `git show HEAD:<the segment>` printing all twenty-two
 * lines back. A command that ran `rm` would give a sense of completion over work that
 * had barely begun, and the output says so in the same breath as the record.
 *
 * EVERY FIXTURE IS THE PRODUCT'S. The project is `mnema init`; the foreign tail is a
 * second machine writing its own chain and its files copied in, which is what an
 * offline merge IS. Nothing here assembles an event by hand.
 */

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
import { catalogUpcasters, openChainForWriting } from '@mnema/chain';
import { createTask } from '@mnema/core/write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';

let sandbox: string;
let repo: string;
const before = { cwd: process.cwd(), home: process.env.HOME, xdg: process.env.XDG_DATA_HOME };

/** What one invocation said on each stream, and whether it asked for a non-zero exit. */
interface Said {
  readonly out: string[];
  readonly err: string[];
  readonly text: string;
  readonly failed: boolean;
}

/** Runs `mnema <argv>` through the entry the binary uses, with the streams captured. */
async function mnema(...argv: readonly string[]): Promise<Said> {
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
  return { out, err, text: [...out, ...err].join('\n'), failed };
}

/** The project's committed tree. */
function publicRoot(): string {
  return join(repo, '.mnema');
}

/** Where a tail's files are, as the layout spells it. */
function tailDirectory(tail: string): string {
  return join(publicRoot(), 'tails', tail);
}

/**
 * A second machine's tail, merged into the project's committed tree the way an
 * offline copy is: its files, and the public half of the key that signed them.
 *
 * It is the shape the verb exists for. A waiver may never name the tail it is written
 * to, so the only tail this machine can authorize a cut of is somebody else's — which
 * is also the case the fact was designed around: one person asking to be taken out of
 * a record, another authorizing it.
 */
function mergeAForeignTail(): { tail: string; anchor: string } {
  const elsewhere = mkdtempSync(join(sandbox, 'other-machine-'));
  const writer = openChainForWriting(elsewhere, { keyRoot: elsewhere });
  const created = createTask(
    { writer, layout: { root: elsewhere }, upcasters: catalogUpcasters() },
    { title: 'work the other machine did' },
  );
  expect(created.ok, JSON.stringify(created)).toBe(true);
  writer.checkpoint();

  for (const tail of readdirSync(join(elsewhere, 'tails'))) {
    cpSync(join(elsewhere, 'tails', tail), join(publicRoot(), 'tails', tail), { recursive: true });
  }
  for (const key of readdirSync(join(elsewhere, 'keys'))) {
    if (!key.endsWith('.pub')) continue;
    cpSync(join(elsewhere, 'keys', key), join(publicRoot(), 'keys', key));
  }
  return { tail: writer.tail, anchor: writer.anchor };
}

/** Every file under a directory, by relative path, with its bytes. */
function bytesUnder(directory: string): Map<string, string> {
  const held = new Map<string, string>();
  const walk = (at: string, prefix: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(at, entry.name), name);
      else held.set(name, readFileSync(join(at, entry.name), 'utf-8'));
    }
  };
  walk(directory, '');
  return held;
}

/** This machine's own tail in the committed tree — the one a waiver may never name. */
function ownTail(): string {
  const tails = readdirSync(join(publicRoot(), 'tails'));
  expect(tails.length, `expected exactly one tail before the merge: ${tails.join(', ')}`).toBe(1);
  return tails[0] as string;
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-cut-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  process.chdir(repo);
  const founded = await mnema('init');
  expect(founded.failed, founded.text).toBe(false);
});

afterEach(() => {
  process.chdir(before.cwd);
  if (before.home === undefined) delete process.env.HOME;
  else process.env.HOME = before.home;
  if (before.xdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = before.xdg;
  delete process.env.MNEMA_RUN;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the record names the cut, and the verb is what writes it', () => {
  it('writes the waiver, and the verify that follows the cut names the account', async () => {
    const foreign = mergeAForeignTail();

    // The census BEFORE, over the same project: the foreign tail is present, so there
    // is nothing to account for and the note it will later carry does not exist.
    const beforehand = await mnema('verify');
    expect(beforehand.failed, beforehand.text).toBe(false);
    expect(beforehand.text).not.toContain('the record names the cut');

    const authorized = await mnema(
      'tail',
      'prune',
      foreign.tail,
      '--reason',
      'the person asked to be taken out of the record',
    );
    expect(authorized.failed, authorized.text).toBe(false);
    expect(authorized.out[0]).toBe(`Authorized the cut of tail ${foreign.tail}`);
    // Everything the waiver claims came off the disk: the count is the foreign tail's
    // own (a founding, a task's two events, and its checkpoint is not an event), and
    // the anchor is the one that tail served — not this machine's.
    expect(authorized.text).toContain(`3 event(s) through `);
    expect(authorized.text).toContain(`the tail of ${foreign.anchor}`);
    expect(authorized.text).not.toContain(`authorized by ${foreign.anchor}`);

    // THE CUT, by the person who authorized it — this verb never does it.
    rmSync(tailDirectory(foreign.tail), { recursive: true, force: true });

    // And the surface this delivery did not touch: the note that used to list three
    // readings of an orphaned key now names who authorized it, how many events, and
    // through which head.
    const after = await mnema('verify');
    expect(after.failed, after.text).toBe(false);
    const note = after.text
      .split('\n')
      .find((line) => line.includes('census [key-without-tail]') && line.includes(foreign.tail));
    expect(note, `no account for the cut tail in:\n${after.text}`).toBeDefined();
    expect(note).toContain('the record names the cut');
    expect(note).toContain('3 event(s)');
    // The verdict is untouched by a census note: it is information, never a failure.
    expect(after.text).toContain('local integrity verified (T1/T2/T4)');
  });

  it('leaves every byte of the tail where it was — it authorizes, it does not cut', async () => {
    const foreign = mergeAForeignTail();
    const held = bytesUnder(tailDirectory(foreign.tail));
    expect(held.size, 'the fixture merged no files').toBeGreaterThan(0);

    const authorized = await mnema(
      'tail',
      'prune',
      foreign.tail,
      '--reason',
      'the person asked to be taken out of the record',
    );
    expect(authorized.failed, authorized.text).toBe(false);

    // THE ASSERTION THIS SLICE IS ABOUT. Not "the directory exists" — every file, with
    // the bytes it had. A verb that truncated, resealed or rewrote a segment would pass
    // an existence check and fail this one.
    expect(existsSync(tailDirectory(foreign.tail))).toBe(true);
    expect(bytesUnder(tailDirectory(foreign.tail))).toEqual(held);

    // And the output says where they are, so whoever authorized the cut can carry it
    // out — the path is the one thing the record itself never carries.
    expect(authorized.text).toContain(`still on disk at ${tailDirectory(foreign.tail)}`);
    expect(authorized.text).toContain('nothing was removed');
  });

  it('says how far a cut reaches, in the same breath as the record', async () => {
    const foreign = mergeAForeignTail();
    const authorized = await mnema(
      'tail',
      'prune',
      foreign.tail,
      '--reason',
      'the person asked to be taken out of the record',
    );

    // The measurement, not a caution: deleting a committed tail leaves the content in
    // the git history, on the remote and in every clone. The person who needs to hear
    // it is the one cutting right now, believing they have finished.
    expect(authorized.text).toContain('Git history, any remote and every clone still hold');
    expect(authorized.text).toContain('git filter-repo');
    expect(authorized.text).toContain("outside this command's reach");
    // It does not promise forgetting, and it does not soften itself by reading the
    // repository: one sentence, true in the worst case, every time.
    expect(authorized.text.toLowerCase()).not.toContain('forgotten');
  });
});

describe('what it refuses, in words a person reads', () => {
  it("refuses this machine's own tail, because the waiver would go with it", async () => {
    const mine = ownTail();
    const refused = await mnema('tail', 'prune', mine, '--reason', 'cut myself');

    expect(refused.failed).toBe(true);
    expect(refused.err.join('\n')).toContain('Refused (TAIL_IS_OWN)');
    expect(refused.err.join('\n')).toContain('outlive');
    // A refusal is a line, never a stack: the message is the core's own wording, and
    // nothing about a throw reaches the reader.
    expect(refused.text).not.toContain('    at ');
    // And nothing was written: the tail it named is still exactly as long as it was.
    expect(existsSync(tailDirectory(mine))).toBe(true);
  });

  it("refuses a tail no tree here holds, and says so in the surface's own voice", async () => {
    const refused = await mnema(
      'tail',
      'prune',
      `${'a'.repeat(64)}-nowhere`,
      '--reason',
      'a tail from another world',
    );

    expect(refused.failed).toBe(true);
    expect(refused.err.join('\n')).toContain(
      `No tail ${'a'.repeat(64)}-nowhere holds events in any tree here.`,
    );
    expect(refused.text).not.toContain('    at ');
  });

  it('is refused by the parser when no reason is given', async () => {
    const foreign = mergeAForeignTail();
    const refused = await mnema('tail', 'prune', foreign.tail);

    // A cut with no recorded reason is the one an audit cannot read later, so the
    // parser demands it — the same shape `key revoke` uses, reported in the product's
    // own voice rather than commander's.
    expect(refused.failed).toBe(true);
    expect(refused.err.join('\n')).toContain('--reason');
    // Nothing reached the record: the tail is untouched and no waiver was written.
    expect(existsSync(tailDirectory(foreign.tail))).toBe(true);
    const said = await mnema('search', '--kind', 'task');
    expect(said.failed, said.text).toBe(false);
  });
});
