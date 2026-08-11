/**
 * The record moves under a live session, and the session's reads keep up.
 *
 * A warm projection cache used to be invalidated by ONE thing: a write this
 * process made. That was exact and it was not enough. Three writers on one
 * project is ordinary — a live MCP session, a headless run, a `mnema` command in
 * a terminal — and the rule that came out of measuring a session against the CLI
 * was: reading never healed, and writing healed only the tree it wrote to. An
 * agent that captures memories and observations writes PRIVATE, so nothing it
 * did ever refreshed the PUBLIC tree that answers "what has this team decided".
 * The answer came back with a confident count and no sign it was old.
 *
 * The centre of this file is that measurement, as a test: seven steps, and the
 * count the session reports at each one. Every write from outside comes from a
 * REAL other process — the built CLI, or a second Node process opening the
 * chain — because a same-process write would prove nothing about the defect,
 * which is precisely about the appends this connection cannot observe.
 *
 * The rest pins the signal itself: it costs one replay and not two when nothing
 * moved, it sees a tail that did not exist before, it sees a rotation, and it
 * stays per tree.
 */

import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureTree } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  PROJECT_DIR,
  ProjectionCache,
  type Scope,
} from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeSession, openSession, type Session } from '../src/mcp/session.js';
import { runCaptureMemory, runCreateTask, runSearchTool } from '../src/mcp/tools.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
/** `packages/code`, so a spawned script resolves `@mnema/*` the way this test does. */
const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

let sandbox: string;
let env: DiscoveryEnv;
let project: string;

/**
 * Runs a real `mnema` command in its own process, against the sandbox.
 *
 * This is the other writer the defect is about. It shares the session's home and
 * data directory, so it signs with the same key and appends to the same TAIL —
 * the ordinary case of a person running a command while an agent is connected.
 */
function cli(...args: string[]): string {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd: project,
    env: processEnv(env),
    encoding: 'utf-8',
  });
}

/** The environment a spawned process needs to see the sandbox and nothing else. */
function processEnv(discovery: DiscoveryEnv): NodeJS.ProcessEnv {
  const inherited = { ...process.env };
  // A run pinned in the parent's environment would be asked of a project that
  // has no record of it, and every spawned write would be refused.
  delete inherited.MNEMA_RUN;
  return {
    ...inherited,
    HOME: discovery.home,
    ...(discovery.xdgDataHome !== undefined ? { XDG_DATA_HOME: discovery.xdgDataHome } : {}),
  };
}

/**
 * Appends one memory to a scope from ANOTHER process, through the domain's own
 * write door, with the segment cap lowered to `maxSegmentBytes`.
 *
 * The cap is the only reason this exists rather than another `cli` call: a
 * rotation happens at four megabytes, and a test that wrote four megabytes to
 * watch a file name change would be measuring the disk. Everything else is the
 * real path — `resolveTrees`, `openTreeForWriting`, `captureMemory`.
 */
function writeFromAnotherProcess(scope: Scope, content: string, maxSegmentBytes?: number): void {
  const options = maxSegmentBytes === undefined ? '{}' : `{ maxSegmentBytes: ${maxSegmentBytes} }`;
  const script = `
    const { resolveTrees, chainRootForScope } = await import('@mnema/core');
    const { openTreeForWriting, captureMemory } = await import('@mnema/core/write');
    const { catalogUpcasters } = await import('@mnema/chain');
    const trees = resolveTrees(${JSON.stringify(project)}, {
      home: process.env.HOME,
      xdgDataHome: process.env.XDG_DATA_HOME,
    });
    const writer = openTreeForWriting(trees, ${JSON.stringify(scope)}, ${options});
    const done = captureMemory(
      { writer, layout: { root: chainRootForScope(trees, ${JSON.stringify(scope)}) }, upcasters: catalogUpcasters() },
      { content: ${JSON.stringify(content)} },
    );
    if (!done.ok) throw new Error('outside capture refused: ' + done.code);
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: PACKAGE_DIR,
    env: processEnv(env),
    encoding: 'utf-8',
  });
}

/** Runs a `mnema` command as a SECOND INSTALLATION — its own key, its own tail. */
function cliFromAnotherMachine(...args: string[]): string {
  const elsewhere: DiscoveryEnv = {
    home: join(sandbox, 'other-home'),
    xdgDataHome: join(sandbox, 'other-data'),
  };
  mkdirSync(elsewhere.home, { recursive: true });
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd: project,
    env: processEnv(elsewhere),
    encoding: 'utf-8',
  });
}

/** Opens an agent session on the sandbox project. */
function openHere(): Session {
  return openSession({
    clientName: 'claude-code',
    roots: [pathToFileURL(project).href],
    env,
  });
}

/** What the session's index reports right now — the read that says "what has been going on". */
function seen(session: Session): number {
  const found = runSearchTool(session, {});
  if (!found.ok) throw new Error(`search refused: ${found.code}`);
  return found.value.total;
}

/** The chain root a scope resolves to within a session's trees. */
function rootOf(session: Session, scope: Scope): string {
  return chainRootForScope(session.trees, scope) as string;
}

/** Counts every replay any cache performs while `body` runs. */
function countingRebuilds<T>(body: () => T): { result: T; rebuilds: number } {
  const spy = vi.spyOn(ProjectionCache.prototype, 'rebuild');
  try {
    const result = body();
    return { result, rebuilds: spy.mock.calls.length };
  } finally {
    spy.mockRestore();
  }
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-moved-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home, xdgDataHome: join(sandbox, 'data') };
  project = join(sandbox, 'proj');
  mkdirSync(project, { recursive: true });
  ensureTree({ root: join(project, PROJECT_DIR) });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the seven steps that were measured', () => {
  it('the session reports what is on disk at every step, not what it wrote itself', () => {
    // The ladder, exactly as it was measured against a live session — and every
    // number is now the disk's. What it used to report is in the comment beside
    // each step: five of the seven were wrong, and the two that happened to be
    // right were right by accident, because the session had just written to the
    // tree that held the missing fact.
    const session = openHere();

    expect(seen(session)).toBe(0); // 0. the session opens — was 0

    cli('decision', 'Keep the runbook in the record', 'a wiki page nobody owns goes stale');
    expect(seen(session)).toBe(1); // 1. the CLI writes a PUBLIC decision — was 0

    expect(seen(session)).toBe(1); // 2. it reads again, writing nothing — was 0

    if (!runCaptureMemory(session, { content: 'the runbook moved' }).ok) {
      throw new Error('setup: capture refused');
    }
    expect(seen(session)).toBe(2); // 3. the reader writes PRIVATE — was 1, its own only

    if (!runCreateTask(session, { title: 'write the rollback section' }).ok) {
      throw new Error('setup: create refused');
    }
    expect(seen(session)).toBe(3); // 4. the reader writes PUBLIC — was 3, by accident

    cli('decision', 'Cut the release on Thursdays', 'Friday deploys page the on-call');
    expect(seen(session)).toBe(4); // 5. the CLI writes another PUBLIC decision — was 3

    if (!runCaptureMemory(session, { content: 'Thursday it is' }).ok) {
      throw new Error('setup: capture refused');
    }
    expect(seen(session)).toBe(5); // 6. the reader writes PRIVATE again — was 4

    // And the witness the measurement used: the CLI is a fresh process, so it
    // always reads the chain. The session and the disk now agree — they used to
    // end four against five.
    expect(cli('search')).toContain('5 record(s)');

    closeSession(session);
    // SEVEN STEPS, AND FOUR OF THEM ARE A WHOLE PROCESS: the ladder is only a ladder
    // because the writes come from outside the session, so each `cli(…)` pays node's start
    // over again. 443 ms on a quiet machine and 2018 ms with the suite running at a load of
    // seventeen — the highest any case here reaches without a ceiling of its own, and the
    // ceiling is here to say WHICH case that is when a busier machine crosses five seconds.
  }, 60_000);
});

describe('the warm cache is still warm', () => {
  it('two reads with nothing in between cost one replay, not two', () => {
    // The property the whole registry exists for, and the one a freshness probe
    // could quietly destroy: a probe that answered "changed" on an unchanged
    // chain would replay on every single read and put the cost back.
    const session = openHere();
    cli('decision', 'Something to read', 'so the trees are not empty');
    // Warm all three trees first, so what follows is measuring reuse and not
    // first opens.
    seen(session);

    const { rebuilds } = countingRebuilds(() => {
      seen(session);
      seen(session);
      seen(session);
    });

    expect(rebuilds).toBe(0);
    closeSession(session);
  });

  it('an unchanged chain is read the same way however many times it is asked', () => {
    // The probe is a function of the disk, not of how often it is called: the
    // same tree asked ten times in a row replays once, at the first ask.
    const session = openHere();
    const { rebuilds } = countingRebuilds(() => {
      for (let i = 0; i < 10; i += 1) session.caches.get(rootOf(session, 'public'));
    });
    expect(rebuilds).toBe(1);
    closeSession(session);
  });
});

describe('every way a chain can move is seen', () => {
  it('a tail that did not exist before — another installation writing into the same tree', () => {
    // Not growth of a tail the session knows: a second machine's first write
    // creates a directory that was not there, under its own key. A probe that
    // watched only the tails it had already seen would miss the whole of it.
    const session = openHere();
    cli('decision', 'Ours', 'the tail this session knows');
    expect(seen(session)).toBe(1);

    cliFromAnotherMachine('decision', 'Theirs', 'written by another installation');

    expect(seen(session)).toBe(2);
    closeSession(session);
    // TWO PROCESSES, and the second one founds a whole second installation before it writes
    // — which is the case: a tail nobody had seen. 257 ms quiet, 1135 ms at a load of
    // seventeen.
  }, 60_000);

  it('a rotation — the same tail, a segment file that did not exist before', () => {
    // The one move that does not make a file bigger: the writer seals the
    // segment it was filling and starts the next one. The tail is known, its
    // last segment stopped growing, and the record still moved.
    const session = openHere();
    writeFromAnotherProcess('public', 'the first segment');
    expect(seen(session)).toBe(1);

    // A cap of one byte forces the very next append into a new file.
    writeFromAnotherProcess('public', 'the second segment', 1);

    expect(seen(session)).toBe(2);
    closeSession(session);
  });

  it('a first event in a tree that had none — the empty tree is not a frozen answer', () => {
    // A session opens on a project nobody has written to yet. Its projection of
    // that tree is empty and CORRECT, and the mark it holds has to keep moving
    // when the tree stops being empty.
    const session = openHere();
    expect(seen(session)).toBe(0);

    cli('memory', 'the very first thing anyone wrote here');

    expect(seen(session)).toBe(1);
    closeSession(session);
  });
});

describe('a tree that goes away, or stops being readable, between two reads', () => {
  it('a record that was deleted is reported as gone, not answered from memory', () => {
    // The expensive error, in the direction nobody thinks about: a projection
    // retained past its chain hands the agent a record that no longer exists.
    // The extent of an emptied tree is the extent of an empty one, so the read
    // replays and reports what is there — nothing.
    const session = openHere();
    cli('decision', 'Written and then withdrawn', 'a record that will be removed');
    expect(seen(session)).toBe(1);

    rmSync(join(rootOf(session, 'public'), 'tails'), { recursive: true, force: true });

    expect(seen(session)).toBe(0);
    closeSession(session);
  });

  it('a chain that cannot be read fails the read, and recovers when it can be read again', () => {
    // The other end of the same rule. Serving a projection of a chain nobody can
    // read is the same false answer as serving one of a chain that is gone; it
    // just looks better. So the replay is attempted, the replay is what reports
    // the fault, and it reports it by failing — the same answer a fresh process
    // gives. The entry keeps its older extent through the failure, so the read
    // after the fault clears replays rather than trusting what it held.
    const session = openHere();
    cli('decision', 'Readable for now', 'until the tails go away');
    expect(seen(session)).toBe(1);

    const tails = join(rootOf(session, 'public'), 'tails');
    const stashed = join(sandbox, 'stashed-tails');
    renameSync(tails, stashed);
    writeFileSync(tails, 'not a directory\n', 'utf-8');

    expect(() => seen(session)).toThrow();

    rmSync(tails);
    renameSync(stashed, tails);

    expect(seen(session)).toBe(1);
    closeSession(session);
  });
});

describe('the trees are still read one at a time', () => {
  it('an outside write to public heals public, and private pays nothing for it', () => {
    // Freshness is per tree, exactly as invalidation is. The public tree moved
    // under the session and the private one did not, so the public read replays
    // and the private read is served from what it already had.
    const session = openHere();
    if (!runCaptureMemory(session, { content: 'a private note' }).ok) {
      throw new Error('setup: capture refused');
    }
    // Warm both, so what follows measures reuse rather than first opens.
    session.caches.get(rootOf(session, 'public'));
    session.caches.get(rootOf(session, 'private'));

    cli('decision', 'Decided elsewhere', 'while this session was reading');

    const publicRead = countingRebuilds(() =>
      session.caches.get(rootOf(session, 'public')).listDecisions(),
    );
    expect(publicRead.rebuilds).toBe(1);
    expect(publicRead.result.map((d) => d.title)).toEqual(['Decided elsewhere']);

    const privateRead = countingRebuilds(() =>
      session.caches.get(rootOf(session, 'private')).listMemories(),
    );
    expect(privateRead.rebuilds).toBe(0);
    expect(privateRead.result).toHaveLength(1);

    closeSession(session);
  });
});

describe('no MCP read gets a cache without passing the probe', () => {
  /** The registry's door, and the probe that lives behind it. */
  const DOOR = 'ProjectionCache.open';
  const PROBE = 'chainExtent';

  it('only the registry opens a projection cache on this surface', () => {
    // The structural half of the fix, and the counterpart of the ban that pins
    // every write to the invalidation door. A tool that opened a cache of its own
    // would answer from a replay nobody checks against the tree — the exact
    // staleness this delivery removed, back through a second door, and looking
    // correct until the second read. So the ban is on the SYMBOL, over the whole
    // MCP surface: a read added later inherits the probe or fails here.
    expect(mcpFilesNaming(DOOR, 'cache-registry.ts')).toEqual([]);
  });

  it('and the registry names it — the ban is not vacuous', () => {
    // The half that keeps the assertion above honest: a rename that emptied the
    // surface of the symbol would leave it passing over a ban on nothing.
    expect(registrySource()).toContain(DOOR);
  });

  it('and the probe is read in exactly one place', () => {
    // One door for the same reason `invalidate` has one: a second site is a
    // second answer to "when is a cache checked", and the one that forgets is
    // the one nothing tells you about.
    expect(registrySource().match(new RegExp(`\\b${PROBE}\\(`, 'g'))).toHaveLength(1);
    expect(mcpFilesNaming(PROBE, 'cache-registry.ts')).toEqual([]);
  });
});

/** The MCP surface's own source, minus tests and minus one file. */
function mcpFilesNaming(symbol: string, except: string): string[] {
  const mcpDir = fileURLToPath(new URL('../src/mcp/', import.meta.url));
  return readdirSync(mcpDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== except)
    .filter((f) => readFileSync(join(mcpDir, f), 'utf-8').includes(symbol));
}

/** The registry module's source. */
function registrySource(): string {
  return readFileSync(fileURLToPath(new URL('../src/mcp/cache-registry.ts', import.meta.url)), {
    encoding: 'utf-8',
  });
}
