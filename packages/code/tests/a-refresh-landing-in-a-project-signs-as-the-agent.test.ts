/**
 * A SESSION THAT LANDS IN A PROJECT BY A REFRESH SIGNS AS THE AGENT, ON A MACHINE THAT HOLDS ONLY ITS KEY.
 *
 * A session that opened outside any project and is then told its workspace — the client announced
 * its roots later — lands in the project's trees. Its `who` is decided there, as the opening decides
 * it, and the question has to be asked with the agent in the trees: asked without it, it falls to the
 * person's key, which this machine does not hold. What the session is and what its first write is
 * signed by must be the agent's.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeSession, openSession, refreshWorkspace } from '../src/mcp/session.js';
import { runRecordDecision } from '../src/mcp/tools.js';
import { type CliIo, run } from '../src/program.js';

let sandbox: string;
let home: string;
let repo: string;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;

async function did(...argv: string[]): Promise<string> {
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
  expect(failed, `${argv.join(' ')}: ${err.join('\n')}`).toBe(false);
  return out.join('\n');
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-refresh-agent-'));
  home = join(sandbox, 'home');
  repo = join(sandbox, 'repo');
  mkdirSync(home, { recursive: true });
  mkdirSync(repo, { recursive: true });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  originalXdg = process.env.XDG_DATA_HOME;
  process.env.HOME = home;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_HOME;
  delete process.env.MNEMA_RUN;
  delete process.env.MNEMA_KEY_PASSPHRASE;
  process.chdir(repo);
  await did('init');
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('a session that opened outside any project and is told its workspace', () => {
  it('lands in a project that enrols the agent and signs there as the agent, with no key of the person', async () => {
    const identity = (await did('audit', 'accountability')).match(/mnid:[0-9a-f]{8}/)?.[0];
    const requested = await did(
      'key',
      'request',
      '--agent',
      'claude',
      '--anchor',
      identity as string,
    );
    const line = requested.split('\n').find((one) => one.startsWith('mnema-agent-request:1:'));
    await did('key', 'enroll', '--agent', line as string);
    const fingerprint = requested.match(/\b[0-9a-f]{64}\b/)?.[0];
    const other = join(sandbox, 'other');
    cpSync(repo, other, { recursive: true });

    // A machine that holds the agent's key and the trees, and no key of the person's.
    const only = join(sandbox, 'only-the-agent');
    cpSync(home, only, { recursive: true });
    rmSync(join(only, '.mnema', 'identity'), { recursive: true, force: true });
    process.env.HOME = only;
    const env: DiscoveryEnv = { home: only };

    const session = openSession({
      roots: [],
      clientName: 'evil',
      env,
      agentKey: 'claude',
      log: () => {},
    });
    expect(session.inProject).toBe(false);

    refreshWorkspace(session, [pathToFileURL(other).href]);
    expect(session.inProject).toBe(true);
    expect(session.which).toBe('claude');

    const done = runRecordDecision(session, { title: 'After the landing', rationale: 'because' });
    closeSession(session);
    expect(done.ok, JSON.stringify(done)).toBe(true);

    const trees = resolveTrees(other, env);
    const recorded: CatalogEvent[] = orderedEvents(
      { root: trees.projectPublic as string },
      catalogUpcasters(),
    ).filter((event) => event.kind === 'decision.recorded');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.signerFp).toBe(fingerprint);
    expect(recorded[0]?.which).toBe('claude');
  });
});
