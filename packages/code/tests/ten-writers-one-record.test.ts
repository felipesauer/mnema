/**
 * TEN WRITERS, ONE RECORD — the short battery of concurrency the suite runs on every push.
 *
 * WHY IT EXISTS. Two concurrent `mnema decision` runs once corrupted the chain in 15 of 20
 * rounds (the header of `chain/src/chain/tail-lock.ts` tells it), and the lock that closed it has
 * been touched since: a write that took the lock twice — once to append, once to sign — could be
 * refused on the second take with its fact already on the chain, and say "not appended". Nothing
 * in the suite wrote one record from more than one process at a time, so the next change to the
 * lock could reopen either defect and every case would stay green.
 *
 * WHAT IT DOES. Ten servers of the built binary — ten processes, each announcing an agent of its
 * own, the way ten agents in one project each start one — record ten decisions each, one after
 * the other, all ten servers at once. Then three readings, each independent of the processes
 * that wrote:
 *
 *   - `mnema verify` exits 0 over the record;
 *   - the second reader (`packages/chain/verifier/`) says VERIFIED, with every event signed;
 *   - every call that answered success has its decision on the chain, once, and every call that
 *     answered a refusal has nothing there. A refusal is allowed — ten writers on a loaded runner
 *     can keep the tail past its budget — but a refusal that lies is not.
 *
 * WHY SERVERS AND NOT TEN COMMAND LINES. The lock is the same one either way, so either finds the
 * defects above. A hundred command lines start a hundred programs, and on a four-core runner that
 * starved the case beside it in its job past its ceiling (730 ms alone, 6.1 s beside them);
 * ten servers start ten.
 *
 * WHAT IT DOES NOT DO: measure. How many refuse, and how fast, depends on the machine; the
 * numbers belong in a report, and this case holds only what must be true on any machine.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogUpcasters } from '@mnema/chain';
import { orderedEvents } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages', 'code', 'dist', 'cli.js');
const READER = join(REPO, 'packages', 'chain', 'verifier', 'mnema_verify.py');

const WRITERS = 10;
const WRITES = 10;

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
function env(): Record<string, string> {
  return { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' };
}

/** What one call answered: the title it asked for, and whether the server said it landed. */
interface Answer {
  readonly title: string;
  readonly landed: boolean;
  readonly said: string;
}

/** A server started in the project, as a host starts it, for an agent named `agent-<n>`. */
async function server(n: number): Promise<Client> {
  const client = new Client({ name: `agent-${n}`, version: '1.0.0' }, { capabilities: {} });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [CLI, 'mcp'],
      cwd: repo,
      env: env(),
      stderr: 'ignore',
    }),
  );
  return client;
}

/** One writer: its ten decisions in turn, and what each answered. */
async function writer(client: Client, n: number): Promise<Answer[]> {
  const answers: Answer[] = [];
  for (let i = 0; i < WRITES; i += 1) {
    const title = `writer ${n} decision ${i}`;
    const result = await client.callTool({
      name: 'record_decision',
      arguments: { title, rationale: 'measured' },
    });
    const text = JSON.stringify(result.content);
    answers.push({ title, landed: result.isError !== true, said: text });
  }
  return answers;
}

describe('ten writers of one record at once', () => {
  it('leave a record both readers verify, and every reply says what reached it', {
    timeout: 120_000,
  }, async () => {
    const init = spawnSync(process.execPath, [CLI, 'init'], {
      cwd: repo,
      encoding: 'utf-8',
      env: env(),
    });
    expect(init.status, init.stderr).toBe(0);

    const clients = await Promise.all(Array.from({ length: WRITERS }, (_, n) => server(n)));
    let answers: Answer[];
    try {
      answers = (await Promise.all(clients.map((client, n) => writer(client, n)))).flat();
    } finally {
      await Promise.all(clients.map((client) => client.close()));
    }
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
