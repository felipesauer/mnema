/**
 * The adapter behind `mnema usage`: which host session it attributes to a run, and
 * the three answers it can give.
 *
 * THE THREE ARE NOT THREE SIZES OF ONE ANSWER, which is why each has a case of its
 * own. One session in the window is a number; two are a refusal that NAMES both; none
 * is a word. A reading that collapsed the last two into "0 tokens" would be telling a
 * person their agent worked for free, and would do it in exactly the shape of a
 * successful answer.
 *
 * EVERY FIXTURE IS A HOST STORE THIS FILE BUILT, under a `HOME` of its own. Nothing
 * here reads the real `~/.claude`: it holds other people's conversations, it is not
 * reproducible, and a test that depended on it would be a test that passes on one
 * machine.
 *
 * THE LINES ARE THE HOST'S OWN SHAPE (A13). The fields are the ones measured in a real
 * transcript — `type`, `cwd`, `sessionId`, `timestamp`, and `message.{id,model,usage}`
 * with the four `*_tokens` names — because a fixture with an invented field would leave
 * this suite green over a format the host does not write.
 */

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runRunStart } from './run-start.js';
import { runUsage, type UsageDone } from './usage.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-usage-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A project, and the environment that discovers it — the host store is under `home`. */
function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  const env = { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') };
  runInit({ cwd: repo, env });
  return { repo, env };
}

/** The four counts one fabricated assistant message claims. */
interface Claim {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
}

/**
 * One line of a transcript, in the host's own shape.
 *
 * `blocks` is how many lines this message is written across — the host writes one per
 * content block and repeats the same `usage` on each, which is the shape that makes a
 * per-line sum double-count.
 */
function assistantLines(where: {
  cwd: string;
  session: string;
  at: string;
  model: string;
  message: string;
  claim: Claim;
  blocks?: number;
  text?: string;
}): string[] {
  const line = JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    userType: 'external',
    cwd: where.cwd,
    sessionId: where.session,
    version: '2.1.224',
    type: 'assistant',
    timestamp: where.at,
    requestId: `req_${where.message}`,
    message: {
      id: where.message,
      type: 'message',
      role: 'assistant',
      model: where.model,
      content: [{ type: 'text', text: where.text ?? 'what the assistant said' }],
      usage: {
        input_tokens: where.claim.input,
        output_tokens: where.claim.output,
        cache_read_input_tokens: where.claim.cacheRead,
        cache_creation_input_tokens: where.claim.cacheCreation,
        service_tier: 'standard',
      },
    },
  });
  return Array.from({ length: where.blocks ?? 1 }, () => line);
}

/**
 * Writes one host session's transcript, and pins when the host last touched it.
 *
 * The modification time is set deliberately: it is what the reading uses to decide how
 * far a session reaches, so a fixture that left it at "now" could not express a session
 * that ended before a run began.
 */
function writeTranscript(
  store: string,
  session: string,
  lines: readonly string[],
  lastWritten: Date,
): string {
  // The directory name is the host's flattened path. It is deliberately NOT what the
  // reading keys on — this fixture writes a name no rule would compose, and the read
  // still finds the session, because what it reads is the `cwd` on the line.
  const directory = join(store, 'a-directory-name-nothing-composes');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${session}.jsonl`);
  writeFileSync(path, `${lines.join('\n')}\n`);
  utimesSync(path, lastWritten, lastWritten);
  return path;
}

/** Where the host keeps transcripts under a sandbox home. */
function storeIn(env: DiscoveryEnv): string {
  return join(env.home, '.claude', 'projects');
}

/** Opens a run and answers with its id and the instant it started at. */
function openRun(
  repo: string,
  env: DiscoveryEnv,
  agent: string,
): { id: string; startedMs: number } {
  const started = runRunStart({ cwd: repo, env }, { agent });
  expect(started.ok, JSON.stringify(started)).toBe(true);
  if (!started.ok) throw new Error('unreachable');
  const listing = read(repo, env, 0);
  const run = listing.runs.find((each) => each.run === started.id);
  expect(run, `no run ${started.id} in ${JSON.stringify(listing.runs)}`).toBeDefined();
  return { id: started.id, startedMs: Date.parse(run?.startedAt as string) };
}

/** The listing, with the clock pinned `afterMs` past `from`. */
function read(repo: string, env: DiscoveryEnv, atMs: number): UsageDone {
  const listing = runUsage({
    cwd: repo,
    env,
    // The real environment is kept out: a developer with `CLAUDE_CONFIG_DIR` set would
    // otherwise run this suite against their own machine's store.
    processEnv: {},
    clock: () => new Date(atMs === 0 ? Date.now() : atMs).toISOString(),
  });
  expect(listing.ok, JSON.stringify(listing)).toBe(true);
  if (!listing.ok) throw new Error('unreachable');
  return listing;
}

describe('mnema usage', () => {
  it('attributes the one host session in the window, and sums it once per message', () => {
    const { repo, env } = setup();
    const { id, startedMs } = openRun(repo, env, 'agent-alpha');
    const store = storeIn(env);
    const iso = (offsetMs: number) => new Date(startedMs + offsetMs).toISOString();

    // The session that did the work: two messages, and the FIRST of them written
    // across three content blocks the way the host writes a turn that used tools.
    writeTranscript(
      store,
      'session-in-the-window',
      [
        ...assistantLines({
          cwd: repo,
          session: 'session-in-the-window',
          at: iso(1_000),
          model: 'claude-opus-5',
          message: 'msg_one',
          claim: { input: 11, output: 22, cacheRead: 33, cacheCreation: 44 },
          blocks: 3,
        }),
        ...assistantLines({
          cwd: repo,
          session: 'session-in-the-window',
          at: iso(2_000),
          model: 'claude-haiku-4-5',
          message: 'msg_two',
          claim: { input: 100, output: 200, cacheRead: 300, cacheCreation: 400 },
        }),
      ],
      new Date(startedMs + 30_000),
    );
    // A session of this project that begins AFTER the window closes. It survives the
    // cheap prune (the host wrote it after the run started) and must still not be
    // attributed — which is what makes this case about overlap and not about pruning.
    writeTranscript(
      store,
      'session-after-the-window',
      assistantLines({
        cwd: repo,
        session: 'session-after-the-window',
        at: iso(3_600_000),
        model: 'claude-opus-5',
        message: 'msg_later',
        claim: { input: 7, output: 7, cacheRead: 7, cacheCreation: 7 },
      }),
      new Date(startedMs + 7_200_000),
    );

    const listing = read(repo, env, startedMs + 60_000);
    expect(listing.sessionsInStore).toBe(2);
    const spend = listing.runs.find((each) => each.run === id);
    expect(spend?.sessions).toEqual(['session-in-the-window']);
    // Summed ONCE per message id, not once per line: three blocks carrying the same
    // `usage` are one message that was bought once. A per-line sum would report 33/66.
    expect(spend?.numbers).toMatchObject({
      input: 111,
      output: 222,
      cacheRead: 333,
      cacheCreation: 444,
      messages: 2,
      passedOver: 0,
    });
    expect(spend?.numbers?.models).toEqual(['claude-opus-5', 'claude-haiku-4-5']);
  });

  it('names both sessions and attributes nothing when two overlap the window', () => {
    const { repo, env } = setup();
    const { id, startedMs } = openRun(repo, env, 'agent-alpha');
    const store = storeIn(env);
    for (const [session, offset] of [
      ['session-one', 1_000],
      ['session-two', 2_000],
    ] as const) {
      writeTranscript(
        store,
        session,
        assistantLines({
          cwd: repo,
          session,
          at: new Date(startedMs + offset).toISOString(),
          model: 'claude-opus-5',
          message: `msg_${session}`,
          claim: { input: 1, output: 2, cacheRead: 3, cacheCreation: 4 },
        }),
        new Date(startedMs + 30_000),
      );
    }

    const spend = read(repo, env, startedMs + 60_000).runs.find((each) => each.run === id);
    // Both halves, and the second alone would be green on a verb that never attributes
    // anything at all.
    expect(spend?.sessions).toEqual(['session-one', 'session-two']);
    expect(spend?.numbers).toBeUndefined();
  });

  it('says nothing rather than zero when no transcript meets the window', () => {
    const { repo, env } = setup();
    const { id, startedMs } = openRun(repo, env, 'agent-alpha');
    // A session of this project, entirely after the window.
    writeTranscript(
      storeIn(env),
      'session-after-the-window',
      assistantLines({
        cwd: repo,
        session: 'session-after-the-window',
        at: new Date(startedMs + 3_600_000).toISOString(),
        model: 'claude-opus-5',
        message: 'msg_later',
        claim: { input: 9, output: 9, cacheRead: 9, cacheCreation: 9 },
      }),
      new Date(startedMs + 7_200_000),
    );

    const spend = read(repo, env, startedMs + 60_000).runs.find((each) => each.run === id);
    // The discriminant is the ABSENCE of numbers, not a count of zero: `numbers` is
    // undefined, and there is no session to name.
    expect(spend?.sessions).toEqual([]);
    expect(spend?.numbers).toBeUndefined();
  });

  it('passes over a line it cannot read and a message with no usage, and counts them', () => {
    const { repo, env } = setup();
    const { id, startedMs } = openRun(repo, env, 'agent-alpha');
    const at = new Date(startedMs + 1_000).toISOString();
    writeTranscript(
      storeIn(env),
      'session-with-rubbish',
      [
        ...assistantLines({
          cwd: repo,
          session: 'session-with-rubbish',
          at,
          model: 'claude-opus-5',
          message: 'msg_good',
          claim: { input: 5, output: 6, cacheRead: 7, cacheCreation: 8 },
        }),
        '{this is not JSON',
        // An assistant message the host wrote with no `usage` on it. It is announced as
        // one, so it is in the class this counts — unlike a user turn, which is not.
        JSON.stringify({
          type: 'assistant',
          cwd: repo,
          sessionId: 'session-with-rubbish',
          timestamp: at,
          message: { id: 'msg_bare', type: 'message', role: 'assistant', model: 'claude-opus-5' },
        }),
        // A user turn: not in the class, and counting it would put noise on every line.
        JSON.stringify({
          type: 'user',
          cwd: repo,
          sessionId: 'session-with-rubbish',
          timestamp: at,
          message: { role: 'user', content: 'a question' },
        }),
      ],
      new Date(startedMs + 30_000),
    );

    const spend = read(repo, env, startedMs + 60_000).runs.find((each) => each.run === id);
    // The session still answers — an unreadable line does not take the reading down —
    // and what was not understood is a number rather than a silence.
    expect(spend?.numbers).toMatchObject({ input: 5, output: 6, messages: 1, passedOver: 2 });
  });

  it('looks where `CLAUDE_CONFIG_DIR` says, when the host was moved', () => {
    // A2: the environment variable is a public input, and this is the link — it does
    // not assert what the reading does with the store, only that it reaches the one the
    // host was told to use. Without it, a machine that moved its configuration would
    // report `no transcript` for every run, which looks exactly like an honest answer.
    const { repo, env } = setup();
    const { id, startedMs } = openRun(repo, env, 'agent-alpha');
    const moved = join(sandbox, 'elsewhere');
    writeTranscript(
      join(moved, 'projects'),
      'session-in-the-moved-store',
      assistantLines({
        cwd: repo,
        session: 'session-in-the-moved-store',
        at: new Date(startedMs + 1_000).toISOString(),
        model: 'claude-opus-5',
        message: 'msg_moved',
        claim: { input: 1, output: 1, cacheRead: 1, cacheCreation: 1 },
      }),
      new Date(startedMs + 30_000),
    );

    const blind = runUsage({
      cwd: repo,
      env,
      processEnv: {},
      clock: () => new Date().toISOString(),
    });
    expect(blind.ok && blind.runs.find((each) => each.run === id)?.sessions).toEqual([]);

    const told = runUsage({
      cwd: repo,
      env,
      processEnv: { CLAUDE_CONFIG_DIR: moved },
      clock: () => new Date(startedMs + 60_000).toISOString(),
    });
    expect(told.ok && told.runs.find((each) => each.run === id)?.sessions).toEqual([
      'session-in-the-moved-store',
    ]);
  });

  it('refuses outside a project rather than accounting for another one', () => {
    const nowhere = join(sandbox, 'nowhere');
    mkdirSync(nowhere, { recursive: true });
    const refused = runUsage({
      cwd: nowhere,
      env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') },
      processEnv: {},
    });
    expect(refused).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });
});
