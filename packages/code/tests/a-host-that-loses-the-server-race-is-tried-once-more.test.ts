/**
 * THE CODEX CONTRACT TRIES ONCE MORE, AND SAYS SO. Codex freezes the list of tools about a second
 * and a half into a turn and does not wait for an MCP server beyond that, so on a loaded runner a
 * session now and then starts without the plugin's server in it. That is Codex's race, not the
 * product's: the contract opens the session again, once, and writes into the job's summary that it
 * did. It never repeats in silence and never more than once, and a server that does not come up
 * on the second try leaves the case red.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openWithOneRetry, sayInTheJobSummary } from './host-contract/support/one-retry.js';

interface Session {
  readonly listed: boolean;
}

/** An attempt that returns, in order, the sessions it is given, and counts how often it was asked. */
function attempts(...sessions: Session[]) {
  let asked = 0;
  return {
    asked: () => asked,
    attempt: async (): Promise<Session> => {
      const session = sessions[asked];
      asked += 1;
      if (session === undefined) throw new Error('asked for a session it was not given');
      return session;
    },
  };
}

const listed = (session: Session): boolean => session.listed;

describe('a host that loses the server race is tried once more, and says so', () => {
  it('a server that is there on the first try is not repeated and nothing is said', async () => {
    const said: string[] = [];
    const run = attempts({ listed: true });
    const session = await openWithOneRetry(run.attempt, listed, true, (line) => said.push(line));
    expect(session.listed).toBe(true);
    expect(run.asked()).toBe(1);
    expect(said).toEqual([]);
  });

  it('a server that is missing and then there is repeated once, with the repetition said', async () => {
    const said: string[] = [];
    const run = attempts({ listed: false }, { listed: true });
    const session = await openWithOneRetry(run.attempt, listed, true, (line) => said.push(line));
    expect(session.listed).toBe(true);
    expect(run.asked()).toBe(2);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('repeated once');
  });

  it('a server that never comes up is attempted twice and no more, and the second session is the one returned', async () => {
    const said: string[] = [];
    const run = attempts({ listed: false }, { listed: false }, { listed: true });
    const session = await openWithOneRetry(run.attempt, listed, true, (line) => said.push(line));
    expect(session.listed).toBe(false);
    expect(run.asked()).toBe(2);
    expect(said).toHaveLength(1);
  });

  it('a session that is not to have the server is never repeated for lacking it', async () => {
    const said: string[] = [];
    const run = attempts({ listed: false });
    await openWithOneRetry(run.attempt, listed, false, (line) => said.push(line));
    expect(run.asked()).toBe(1);
    expect(said).toEqual([]);
  });
});

describe('the line for the job summary', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    delete process.env['GITHUB_STEP_SUMMARY'];
  });

  it('is appended to the summary file the job names, after what is already there', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mnema-summary-'));
    dirs.push(dir);
    const file = join(dir, 'summary.md');
    process.env['GITHUB_STEP_SUMMARY'] = file;
    sayInTheJobSummary('first');
    sayInTheJobSummary('second');
    expect(readFileSync(file, 'utf-8')).toBe('first\nsecond\n');
  });
});
