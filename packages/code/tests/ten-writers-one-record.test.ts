/**
 * TEN WRITERS, ONE RECORD — the short battery of concurrency the suite runs on every push.
 *
 * WHY IT EXISTS. Two concurrent `mnema decision` runs once corrupted the chain in 15 of 20
 * rounds (the header of `chain/src/chain/tail-lock.ts` tells it), and the lock that closed it has
 * been touched since: a write that took the lock twice — once to append, once to sign — could be
 * refused on the second take with its fact already on the chain, and say "not appended". Nothing
 * in the suite ran the built binary from more than one process at a time, so the next change to
 * the lock could reopen either defect and every case would stay green.
 *
 * WHAT IT DOES. Ten processes of the built binary, each recording ten decisions one after the
 * other, all ten at once, into one project. Then three readings, each of them independent of the
 * process that wrote:
 *
 *   - `mnema verify` exits 0 over the record;
 *   - the second reader (`packages/chain/verifier/`) says VERIFIED, with every event signed;
 *   - every write that answered success has its decision on the chain, once, and every write
 *     that answered a refusal has nothing there. A refusal is allowed — ten writers on a loaded
 *     runner can keep the tail past its budget — but a refusal that lies is not.
 *
 * WHAT IT DOES NOT DO: measure. How many refuse, and how fast, depends on the machine; the
 * numbers belong in a report, and this case holds only what must be true on any machine.
 */

import { execFile, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { catalogUpcasters } from '@mnema/chain';
import { orderedEvents } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages', 'code', 'dist', 'cli.js');
const READER = join(REPO, 'packages', 'chain', 'verifier', 'mnema_verify.py');

const WRITERS = 10;
const WRITES = 10;

const run = promisify(execFile);

let sandbox: string;
let repo: string;
let home: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-ten-writers-'));
  repo = join(sandbox, 'repo');
  home = join(sandbox, 'home');
  for (const dir of [repo, home]) mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** The environment every process of this case runs in: this sandbox's home and nothing else. */
function env(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' };
}

/** One writer: its ten decisions in turn, and what each answered. */
async function writer(n: number): Promise<{ title: string; landed: boolean; said: string }[]> {
  const answers: { title: string; landed: boolean; said: string }[] = [];
  for (let i = 0; i < WRITES; i += 1) {
    const title = `writer ${n} decision ${i}`;
    const argv = [CLI, 'decision', 'record', title, 'measured', '--which', `agent-${n}`];
    try {
      await run(process.execPath, argv, { cwd: repo, env: env() });
      answers.push({ title, landed: true, said: '' });
    } catch (error) {
      const failed = error as { stderr?: string; stdout?: string };
      answers.push({ title, landed: false, said: `${failed.stderr ?? ''}${failed.stdout ?? ''}` });
    }
  }
  return answers;
}

describe('ten writers of one record at once', () => {
  it('leave a record both readers verify, and every reply says what reached it', {
    timeout: 180_000,
  }, async () => {
    const init = spawnSync(process.execPath, [CLI, 'init'], {
      cwd: repo,
      encoding: 'utf-8',
      env: env(),
    });
    expect(init.status, init.stderr).toBe(0);

    const answers = (
      await Promise.all(Array.from({ length: WRITERS }, (_, n) => writer(n)))
    ).flat();
    expect(answers).toHaveLength(WRITERS * WRITES);

    const verified = spawnSync(process.execPath, [CLI, 'verify'], {
      cwd: repo,
      encoding: 'utf-8',
      env: env(),
    });
    expect(verified.status, `${verified.stdout}${verified.stderr}`).toBe(0);

    const record = join(repo, '.mnema');
    const second = spawnSync('python3', [READER, 'record', record, '--require', 'signed'], {
      encoding: 'utf-8',
    });
    if (second.error !== undefined) {
      throw new Error(
        `python3 could not be run, and this suite requires it: ${second.error.message}`,
      );
    }
    expect(second.status, `${second.stdout}${second.stderr}`).toBe(0);

    const titles = orderedEvents({ root: record }, catalogUpcasters()).flatMap((event) =>
      event.kind === 'decision.recorded' ? [String(event.payload.title)] : [],
    );
    // THE AUDIT. A success is on the chain exactly once; a refusal is not on it at all.
    const lies = answers.filter(
      (answer) =>
        titles.filter((title) => title === answer.title).length !== (answer.landed ? 1 : 0),
    );
    expect(lies.map((one) => `${one.title}: ${one.landed ? 'ok' : one.said}`)).toEqual([]);
    expect(titles).toHaveLength(answers.filter((answer) => answer.landed).length);
  });
});
