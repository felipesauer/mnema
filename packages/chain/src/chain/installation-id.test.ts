/**
 * One key, one installation id per chain — even when two processes of that key reach for it at once.
 *
 * The id picks the tail a machine writes (`<fingerprint>-<installationId>`), so two ids minted for
 * one key in one chain are one machine writing two tails, and the one nothing opens again is an
 * orphan. Two ways produced it, each a race a few milliseconds wide:
 *
 *   - two fresh processes that both found the file absent both minted, and the second write won;
 *   - a process that read the file between another one's create and its write found it EMPTY,
 *     read that as absent, and minted over it.
 *
 * WHY THESE CASES ARE NOT A RACE, for the reason `tail-lock.test.ts` gives: two processes spawned
 * to hit a window are a probe with a probability. What the race PRODUCES is a state, and each case
 * plants it and asks the product what it does with it — a mint arriving after another process
 * created the file, and a file created and not yet written. Rounds and rates, with a barrier
 * releasing two processes at one instant, are a measurement, not a case.
 *
 * A LINK TO NOTHING IN THE ID'S PLACE is a state of its own, and not a race: nobody created it
 * a moment ago and nobody will ever fill it, and the loop went round it forever. So the cases
 * about it — and about the two other states that reach the same branch of the loop — run the
 * call in a thread of their own and stop it at a ceiling. A call that never returns holds the
 * thread its case's timer would have to run on, so the case's own timeout cannot end it and the
 * suite would hang instead of failing; stopped from here, a call that does not come back is a
 * red case that says so.
 */

import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateKeyPair } from './keys.js';
import {
  INSTALLATION_ID_POLL_MS,
  INSTALLATION_ID_WAIT_MS,
  linkToNothingAt,
  loadOrCreateInstallationId,
  mintInstallationId,
  UnwrittenInstallationIdError,
} from './keystore.js';
import { type ChainLayout, installationIdPath } from './layout.js';

let root: string;
let layout: ChainLayout;
/** A real key's fingerprint — the only kind the product ever files an id under. */
let fingerprint: string;
let path: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-installation-id-'));
  layout = { root };
  fingerprint = generateKeyPair().fingerprint;
  path = installationIdPath(layout, fingerprint);
  mkdirSync(dirname(path), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** An id as the product mints one: sixteen random bytes, as hex. */
const anId = (): string => randomBytes(16).toString('hex');

describe('two processes of one key get one installation id', () => {
  it('mints once, and reads the same id back after', () => {
    const minted = loadOrCreateInstallationId(layout, fingerprint);
    expect(minted).toMatch(/^[0-9a-f]{32}$/);
    expect(readFileSync(path, 'utf-8')).toBe(`${minted}\n`);
    expect(loadOrCreateInstallationId(layout, fingerprint)).toBe(minted);
  });

  it('a mint that finds the id already created adopts it, and never writes over it', () => {
    // The state the first race leaves: another process minted and wrote a moment ago, and this
    // one — which found nothing when it looked — is minting now.
    const theirs = loadOrCreateInstallationId(layout, fingerprint);
    expect(mintInstallationId(path)).toBeUndefined();
    expect(readFileSync(path, 'utf-8')).toBe(`${theirs}\n`);
    expect(loadOrCreateInstallationId(layout, fingerprint)).toBe(theirs);
  });

  it('an id another process has created and not yet written is waited for, never minted over', async () => {
    // The state the second race leaves: the file exists and is empty, and the process that made
    // it writes its id a moment later — here a thread, since this one is blocked reading.
    writeFileSync(path, '', { mode: 0o600 });
    const theirs = anId();
    const writer = new Worker(
      "const { writeFileSync } = require('node:fs');" +
        "const { workerData } = require('node:worker_threads');" +
        "setTimeout(() => writeFileSync(workerData.path, workerData.id + '\\n'), 150);",
      { eval: true, workerData: { path, id: theirs } },
    );
    const ours = loadOrCreateInstallationId(layout, fingerprint);
    await once(writer, 'exit');
    expect(ours).toBe(theirs);
    expect(readFileSync(path, 'utf-8')).toBe(`${theirs}\n`);
  });

  it('an id that stays empty is refused, and the file is left for a person to look at', {
    timeout: 10_000,
  }, () => {
    // Created and never written: what a process stopped between its create and its write
    // leaves. Minting over it would be the fork; the refusal names the file instead.
    writeFileSync(path, '', { mode: 0o600 });
    const started = Date.now();
    let refusal: unknown;
    try {
      loadOrCreateInstallationId(layout, fingerprint);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(UnwrittenInstallationIdError);
    expect((refusal as UnwrittenInstallationIdError).code).toBe('UNWRITTEN_INSTALLATION_ID');
    expect((refusal as Error).message).toContain(path);
    expect(Date.now() - started).toBeGreaterThanOrEqual(INSTALLATION_ID_WAIT_MS);
    expect(readFileSync(path, 'utf-8')).toBe('');
  });
});

/**
 * The built module the thread loads. A thread started from here cannot load this TypeScript, and
 * what it loads is what ships — so these cases read the build, as every case that runs the binary
 * does, and `pnpm build` comes before them.
 */
const BUILT = new URL('../../dist/chain/keystore.js', import.meta.url).href;

/**
 * How long the thread gets before it is stopped: four budgets, so a refusal that waits one out is
 * never taken for a call that does not return.
 */
const CEILING_MS = 4 * INSTALLATION_ID_WAIT_MS;

/**
 * What the thread's filesystem answers differently at the id's place — the two states that reach
 * the loop's second look and that no real filesystem holds still long enough to plant.
 */
interface Plant {
  /** The first read finds nothing, as it would have a moment before another process created it. */
  readonly firstReadFindsNothing?: boolean;
  /** Every create finds the name taken, as a filesystem that answers the two differently would. */
  readonly everyCreateFindsTheNameTaken?: boolean;
}

/** What the call did in its thread, how long the call itself took, and how often it looked. */
interface Answer {
  readonly returned?: string;
  readonly refused?: {
    readonly name: string;
    readonly code: string;
    readonly message: string;
    readonly path?: string;
    readonly target?: string;
  };
  readonly ms: number;
  /** Reads of the id's place. */
  readonly reads: number;
  /** Exclusive creates at the id's place. */
  readonly creates: number;
}

/**
 * The thread: it counts (and, when asked, answers differently) the reads and exclusive creates at
 * the id's place, loads the built module, times the one call, and posts what came of it.
 */
const THREAD = `
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const { built, root, fingerprint, path } = workerData;
const { firstReadFindsNothing, everyCreateFindsTheNameTaken } = workerData;
let reads = 0;
let creates = 0;
const failure = (code, words) =>
  Object.assign(new Error(code + ': ' + words + " '" + path + "'"), { code });
const read = fs.readFileSync;
const open = fs.openSync;
fs.readFileSync = function (at, ...rest) {
  if (at === path) {
    reads += 1;
    if (firstReadFindsNothing && reads === 1) {
      throw failure('ENOENT', 'no such file or directory, open');
    }
  }
  return read.call(this, at, ...rest);
};
fs.openSync = function (at, flags, ...rest) {
  if (at === path && flags === 'wx') {
    creates += 1;
    if (everyCreateFindsTheNameTaken) throw failure('EEXIST', 'file already exists, open');
  }
  return open.call(this, at, flags, ...rest);
};
syncBuiltinESMExports();
import(built).then(
  ({ loadOrCreateInstallationId }) => {
    const started = performance.now();
    let answer;
    try {
      answer = { returned: loadOrCreateInstallationId({ root }, fingerprint) };
    } catch (error) {
      const { name, code, message, path: at, target } = error;
      answer = { refused: { name, code, message, path: at, target } };
    }
    parentPort.postMessage({ ...answer, ms: performance.now() - started, reads, creates });
  },
  (error) => parentPort.postMessage({ unloadable: String(error) }),
);
`;

/**
 * Runs `loadOrCreateInstallationId` for this case's key and tree in a thread of its own, and
 * stops the thread at {@link CEILING_MS}: a call that has not come back by then fails the case,
 * by name, instead of holding the suite.
 */
async function inAThreadOfItsOwn(plant: Plant = {}): Promise<Answer> {
  const thread = new Worker(THREAD, {
    eval: true,
    workerData: { built: BUILT, root, fingerprint, path, ...plant },
  });
  let ceiling: NodeJS.Timeout | undefined;
  try {
    const first = await Promise.race([
      once(thread, 'message').then(
        ([message]) => message as Answer | { readonly unloadable: string },
      ),
      new Promise<undefined>((resolve) => {
        ceiling = setTimeout(resolve, CEILING_MS);
      }),
    ]);
    if (first === undefined) {
      throw new Error(`loadOrCreateInstallationId did not return in ${CEILING_MS} ms`);
    }
    if ('unloadable' in first) {
      throw new Error(`${BUILT} did not load, and \`pnpm build\` comes first: ${first.unloadable}`);
    }
    return first;
  } finally {
    clearTimeout(ceiling);
    await thread.terminate();
  }
}

/** Everything under the case's tree, by path — what a refusal must leave as it found it. */
const everythingUnder = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf-8' }).sort();

/** The two shapes a link to nothing takes: its target's directory missing, or only the target. */
const LINKS_TO_NOTHING: readonly { readonly shape: string; readonly plant: () => string }[] = [
  {
    shape: 'into a directory that is not there',
    plant: () => join(root, 'not-there', 'inst'),
  },
  {
    shape: 'to a file missing from a directory that is there',
    plant: () => {
      mkdirSync(join(root, 'elsewhere'));
      return join(root, 'elsewhere', 'inst');
    },
  },
];

describe('where the read finds no id and the create finds the name taken, it settles or refuses', () => {
  for (const { shape, plant } of LINKS_TO_NOTHING) {
    it(`a link to nothing ${shape} is refused at once, saying where it points, and left as it was`, {
      // Waits for a thread of its own; a call that goes round forever is stopped at the ceiling.
      timeout: CEILING_MS + 5_000,
    }, async () => {
      const target = plant();
      symlinkSync(target, path);
      const before = everythingUnder(root);

      const answer = await inAThreadOfItsOwn();

      expect(answer.returned).toBeUndefined();
      expect(answer.refused).toMatchObject({
        name: 'DanglingInstallationIdError',
        code: 'DANGLING_INSTALLATION_ID',
        path,
        target,
      });
      const words = answer.refused?.message ?? '';
      expect(words).toContain(path);
      expect(words).toContain(target);
      expect(words).toContain('refuses the write');
      expect(words).toContain('Remove the link, and the next write mints a new id.');
      // The empty file's words are false here, and a refusal never says that nothing was written.
      expect(words).not.toMatch(/stayed empty|nothing was/i);
      // At once: the first create that met the link was the last, well inside the budget.
      expect(answer.creates).toBe(1);
      expect(answer.ms).toBeLessThan(INSTALLATION_ID_WAIT_MS);
      // The link stays a link to nothing, and nothing was born beside it.
      expect(lstatSync(path).isSymbolicLink()).toBe(true);
      expect(readlinkSync(path)).toBe(target);
      expect(existsSync(target)).toBe(false);
      expect(everythingUnder(root)).toEqual(before);
    });
  }

  it('a create that finds the file the read missed adopts the id in it', {
    // Waits for a thread of its own; a call that goes round forever is stopped at the ceiling.
    timeout: CEILING_MS + 5_000,
  }, async () => {
    // The race the loop's second look is for: another process created the file and wrote its id
    // between this one's read and its create. The link check must not take it for a link.
    const theirs = anId();
    writeFileSync(path, `${theirs}\n`, { mode: 0o600 });

    const answer = await inAThreadOfItsOwn({ firstReadFindsNothing: true });

    expect(answer.refused).toBeUndefined();
    expect(answer.returned).toBe(theirs);
    expect(answer.reads).toBe(2);
    expect(answer.creates).toBe(1);
    expect(answer.ms).toBeLessThan(INSTALLATION_ID_WAIT_MS);
    expect(readFileSync(path, 'utf-8')).toBe(`${theirs}\n`);
  });

  it('a name the create keeps finding taken, where no read finds an id, is refused once the budget runs out', {
    // Waits out one budget in a thread of its own; going round forever is stopped at the ceiling.
    timeout: CEILING_MS + 5_000,
  }, async () => {
    const before = everythingUnder(root);

    const answer = await inAThreadOfItsOwn({ everyCreateFindsTheNameTaken: true });

    expect(answer.returned).toBeUndefined();
    expect(answer.refused).toMatchObject({
      name: 'UnsettledInstallationIdError',
      code: 'UNSETTLED_INSTALLATION_ID',
      path,
    });
    const words = answer.refused?.message ?? '';
    expect(words).toContain(path);
    expect(words).toContain('refuses the write');
    expect(words).not.toMatch(/stayed empty|symbolic link|nothing was/i);
    expect(answer.ms).toBeGreaterThanOrEqual(INSTALLATION_ID_WAIT_MS);
    // It looked again, and slept between looks: one create per poll at most, where a loop that
    // goes straight back creates tens of thousands of times in the same budget.
    expect(answer.creates).toBeGreaterThan(1);
    expect(answer.creates).toBeLessThanOrEqual(
      (2 * INSTALLATION_ID_WAIT_MS) / INSTALLATION_ID_POLL_MS,
    );
    expect(everythingUnder(root)).toEqual(before);
  });
});

describe('what took the name, asked only of a create that found it taken', () => {
  it('names a link to nothing by where it points, and nothing else', () => {
    const toNothing = join(root, 'to-nothing');
    symlinkSync(join(root, 'not-there'), toNothing);
    const aFile = join(root, 'a-file');
    writeFileSync(aFile, `${anId()}\n`);
    const toAFile = join(root, 'to-a-file');
    symlinkSync(aFile, toAFile);

    expect(linkToNothingAt(toNothing)).toBe(join(root, 'not-there'));
    // A link that leads somewhere is read through by the next read, and is not this.
    expect(linkToNothingAt(toAFile)).toBeUndefined();
    expect(linkToNothingAt(aFile)).toBeUndefined();
    expect(linkToNothingAt(join(root, 'nothing-here'))).toBeUndefined();
  });
});
