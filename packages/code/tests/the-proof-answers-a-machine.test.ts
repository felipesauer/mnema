/**
 * THE PROOF LAYER ANSWERS A MACHINE — and says what it does not answer.
 *
 * MEASURED against the built binary before this existed: of the reads this product
 * serves, `verify` and `witness` were the only two that REFUSED `--json`, both with
 * `mnema <verb> does not take "--json".` and exit 1. Every other read takes it
 * (`brief` is the one that does not, and it does not because markdown for an agent IS
 * its output format). So the one layer with no machine-readable answer was the PROOF —
 * the layer whose whole value is that a stranger can check it.
 *
 * THE RESSALVA IS OBLIGATORY AND IT IS A FIELD. The verdict this makes legible is
 * knowingly insufficient: a tail removed together with its committed key is not
 * reported at all, and a removed tail whose key remains comes out as a census note with
 * exit 0. Making an incomplete verdict machine-readable is better than prose, and the
 * delivery has to SAY it is incomplete — in the document a machine parses, not in a
 * README it will not open. So the JSON carries `notAnswered`, read from the chain's own
 * constant, which is the one site the README says the same thing from.
 *
 * WHAT EACH CASE IS FOR:
 *   - THE DECIDING FIELD DIFFERS between a healthy record and a forged one, and it has
 *     a NAME. A case that only checked "the JSON parses" would pass over a document
 *     that said nothing.
 *   - THE CONTRAST: the prose reading of the same record does not change. `--json`
 *     changes the SHAPE of the answer and never the answer, so the exit code and the
 *     level have to agree across the two shapes — which is also what stops the adapter
 *     from becoming a second opinion about what the proof said.
 *   - `notAnswered` is the chain's constant and not a sentence written here, so a
 *     delivery that removed the declaration cannot leave this green.
 *   - `witness --json` answers per tail, and the prose reading names the same tails.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  entryHash,
  listTails,
  NOT_ANSWERED_BY_ANY_REQUIREMENT,
  orderedSegments,
} from '@mnema/chain';
import { resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';

let sandbox: string;
let repo: string;
let originalCwd: string;
let originalXdg: string | undefined;
let originalHome: string | undefined;

/** What one invocation said on each channel, and whether it asked for a non-zero exit. */
interface Said {
  readonly out: string;
  readonly err: string;
  readonly failed: boolean;
}

/** Runs one verb the way the binary does, and reads both channels. */
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
  await run([...argv], io);
  return { out: out.join('\n'), err: err.join('\n'), failed };
}

/** The one tail's only segment file, and the checkpoints beside it. */
function storedFiles(): { segment: string; checkpoints: string } {
  const root = resolveTrees(repo, {
    xdgDataHome: join(sandbox, 'data'),
    home: join(sandbox, 'home'),
  }).projectPublic as string;
  const tail = listTails({ root })[0] as string;
  const segment = orderedSegments({ root }, tail)[0] as string;
  return { segment, checkpoints: join(dirname(segment), 'checkpoints.jsonl') };
}

/**
 * Rewrites a fact and RECOMPUTES the hash links with the product's own function — the
 * attacker who knows the format — then empties the checkpoints. The record is then
 * internally consistent and nothing contradicts it, which is why the default passes it.
 */
function forge(needle: string, replacement: string): void {
  const { segment, checkpoints } = storedFiles();
  const out: string[] = [];
  let prev: string | null = null;
  for (const raw of readFileSync(segment, 'utf-8').split('\n').filter(Boolean)) {
    const entry = JSON.parse(raw) as {
      event: unknown;
      link: { tail: string; seq: number; prev: string | null; hash: string };
    };
    entry.event = JSON.parse(JSON.stringify(entry.event).split(needle).join(replacement));
    entry.link.prev = prev;
    entry.link.hash = entryHash({
      event: { value: entry.event } as Parameters<typeof entryHash>[0]['event'],
      tail: entry.link.tail,
      seq: entry.link.seq,
      prev,
    });
    prev = entry.link.hash;
    out.push(JSON.stringify(entry));
  }
  writeFileSync(segment, `${out.join('\n')}\n`, 'utf-8');
  writeFileSync(checkpoints, '', 'utf-8');
}

/** Founds a project and records one task — signed as it is written. */
async function record(title: string): Promise<void> {
  const founded = await mnema('init');
  if (founded.failed) throw new Error(`setup: init failed: ${founded.err}`);
  const written = await mnema('task', title);
  if (written.failed) throw new Error(`setup: task failed: ${written.err}`);
}

/** The verdict as JSON, parsed — a throw naming the output when it is not JSON at all. */
async function verdict(...argv: readonly string[]): Promise<{
  readonly said: Said;
  readonly json: {
    record: { level: string };
    requirement: string;
    requirementMet: boolean;
    notAnswered: readonly string[];
  };
}> {
  const said = await mnema('verify', '--json', ...argv);
  try {
    return { said, json: JSON.parse(said.out) };
  } catch {
    throw new Error(`verify --json did not answer with JSON: ${said.out.slice(0, 200)}`);
  }
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-proof-json-'));
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

describe('the proof answers a machine', () => {
  it('differs in the field that decides, between a healthy record and a forged one', async () => {
    await record('the fact as it was written');
    const healthy = await verdict();
    expect(healthy.json.record.level).toBe('fully-signed');
    expect(healthy.json.requirementMet).toBe(true);
    expect(healthy.said.failed).toBe(false);

    forge('as it was written', 'as somebody rewrote it');
    const forged = await verdict();
    // THE FIELD THAT DECIDES, BY NAME. The forgery is internally consistent, so the
    // default still exits 0 — and the level says what was actually proven, which is
    // the value a CI step can branch on instead of reading a sentence.
    expect(forged.json.record.level).toBe('hash-chain-only');
    expect(forged.json.requirementMet).toBe(true);
    expect(forged.said.failed).toBe(false);

    // And at the minimum the README names, the same document says no, and the exit
    // follows it. Two fields, one answer.
    const strict = await verdict('--require', 'signed');
    expect(strict.json.requirement).toBe('signed');
    expect(strict.json.requirementMet).toBe(false);
    expect(strict.said.failed).toBe(true);
  });

  it('changes the shape of the answer and never the answer', async () => {
    // THE CONTRAST, and the half that stops the adapter from becoming a second opinion:
    // the prose reading of the same record says the same level and exits the same way.
    await record('the fact as it was written');
    forge('as it was written', 'as somebody rewrote it');

    const prose = await mnema('verify');
    const json = await verdict();
    expect(prose.failed).toBe(json.said.failed);
    expect(prose.out).toContain('T1 only');
    expect(json.json.record.level).toBe('hash-chain-only');
    // The prose carries no JSON and the JSON carries no prose: a machine parsing one
    // document must not find sentences beside it.
    expect(prose.out.startsWith('{')).toBe(false);
    expect(json.said.err).toBe('');

    const proseStrict = await mnema('verify', '--require', 'signed');
    const jsonStrict = await verdict('--require', 'signed');
    expect(proseStrict.failed).toBe(true);
    expect(jsonStrict.said.failed).toBe(true);
  });

  it('says what NO requirement answers, from the one site that declares it', async () => {
    await record('a fact');
    const said = await verdict();
    // The chain's own constant, not a sentence written here — so the field cannot drift
    // from the declaration.
    expect(said.json.notAnswered).toEqual([...NOT_ANSWERED_BY_ANY_REQUIREMENT]);
    // AND THE DECLARATION ITSELF IS HELD, which the line above cannot do: it compares
    // the constant with itself, so emptying one entry moved BOTH sides and left the
    // whole suite green — measured, as row M8.4 of this delivery's battery. There are
    // TWO measured holes, and each has to still be the same hole the README describes,
    // because "one site the README says the same thing from" is the reason the constant
    // exists. The phrase per row is that hole's DISCRIMINANT and nothing else.
    expect(said.json.notAnswered).toHaveLength(2);
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf-8');
    for (const discriminant of [
      // the tail taken out together with its key — reported nowhere
      'indistinguishable from a fresh one',
      // the tail taken out with its key left behind — reported, and not a break
      'informational, not a break',
    ]) {
      expect(readme, discriminant).toContain(discriminant);
      expect(
        said.json.notAnswered.filter((one) => one.includes(discriminant)),
        discriminant,
      ).toHaveLength(1);
    }
    // And it is there at EVERY requirement, because choosing one does not shrink the
    // list — it changes which forgery goes green.
    for (const level of ['chained', 'signed', 'witnessed']) {
      const at = await mnema('verify', '--json', '--require', level);
      expect(JSON.parse(at.out).notAnswered, level).toEqual([...NOT_ANSWERED_BY_ANY_REQUIREMENT]);
    }
  });

  it('answers per tail for the witness, and names the tails the prose names', async () => {
    await record('a fact');
    const said = await mnema('witness', '--json');
    const listing = JSON.parse(said.out) as {
      trees: readonly string[];
      lines: readonly { scope: string; tail: string; reading: { status: string } }[];
    };
    expect(said.failed).toBe(false);
    expect(listing.trees).toContain('public');
    expect(listing.lines.length).toBeGreaterThan(0);
    for (const line of listing.lines) {
      expect(line.reading.status).toBe('not-covered');
      // The tail the machine is given is the tail the person is given.
      const prose = await mnema('witness');
      expect(prose.out).toContain(line.tail.slice(0, 12));
    }
  });
});
