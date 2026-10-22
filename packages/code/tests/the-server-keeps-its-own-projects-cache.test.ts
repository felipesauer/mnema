/**
 * The server reads its own project through the file the command line and the hooks already keep,
 * and a read is never served from a projection that is behind the chain.
 *
 * A server that starts replays every tree it reads, and at a few thousand lines that is most of
 * what its first answer costs. The two trees of the project it is in now open over
 * `locks/projection.db` (`ProjectionCache.open` with `persist`) and take only what arrived since
 * the last process wrote it. The other projects of the workspace and the global tree stay in
 * memory: they are read for a moment, and they are not the project the next session opens first.
 *
 * WHAT HAS TO STAY TRUE:
 *
 *   - THE FILE IS KEPT FOR THE OWN PROJECT AND FOR NO OTHER TREE;
 *   - A SECOND CONNECTION TAKES THE FILE AND DOES NOT REPLAY: the file's generation, which a
 *     replay moves and an untouched file does not, says which;
 *   - A RECORD THAT MOVED BEHIND THE FILE IS SEEN BY THE NEXT READ, whoever moved it: a command
 *     of another process, a tail that arrived with a `git pull`, a segment edited in place;
 *   - DELETING THE FILE CHANGES NO ANSWER.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureTree } from '@mnema/chain';
import { chainRootForScope, type DiscoveryEnv, PROJECT_DIR, type Scope } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeSession, openSession, type Session } from '../src/mcp/session.js';
import { runBootstrap } from '../src/mcp/tools.js';

/** The built CLI: the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
/** `packages/code`, so a spawned script resolves `@mnema/*` the way this test does. */
const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

let sandbox: string;
let env: DiscoveryEnv;
let own: string;
let other: string;

/** A real `mnema` command in its own process, in `project`: the writer the server cannot see. */
function cli(project: string, ...args: string[]): string {
  const inherited = { ...process.env };
  delete inherited.MNEMA_RUN;
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd: project,
    env: { ...inherited, HOME: env.home },
    encoding: 'utf-8',
  });
}

/** A project directory that has a `.mnema/` tree. */
function makeProject(name: string): string {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  ensureTree({ root: join(dir, PROJECT_DIR) });
  return dir;
}

function openOn(...projects: string[]): Session {
  return openSession({
    clientName: 'claude-code',
    roots: projects.map((one) => pathToFileURL(one).href),
    env,
  });
}

function rootOf(session: Session, scope: Scope): string {
  return chainRootForScope(session.trees, scope) as string;
}

/** Where a tree keeps its projection. */
function fileOf(chainRoot: string): string {
  return join(chainRoot, 'locks', 'projection.db');
}

/** The counter a replay moves and an untouched file does not. */
function generationOf(file: string): number {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare("SELECT value FROM cache_meta WHERE key = 'generation'").get() as {
      value: string;
    };
    return Number(row.value);
  } finally {
    db.close();
  }
}

/** What the session's own public tree says it holds, titles in the order the projection lists them. */
function decisionsOf(session: Session): string[] {
  return session.caches
    .get(rootOf(session, 'public'))
    .listDecisions()
    .map((one) => one.title)
    .sort();
}

/** Every segment file of a tree, oldest first. */
function segmentsOf(chainRoot: string): string[] {
  const tails = join(chainRoot, 'tails');
  return readdirSync(tails, { recursive: true, encoding: 'utf-8' })
    .filter((name) => /(?:^|[\/])\d+\.jsonl$/.test(name))
    .sort()
    .map((name) => join(tails, name));
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-server-cache-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home };
  own = makeProject('own');
  other = makeProject('other');
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('which trees keep their projection in a file', () => {
  it('the two trees of the project the session is in do, and no other tree does', () => {
    cli(own, 'decision', 'record', 'Own public decision', 'a reason');
    cli(own, 'memory', '--scope', 'private', 'own private note');
    cli(other, 'decision', 'record', 'Another project decision', 'a reason');
    cli(own, 'memory', '--scope', 'global', 'a note for every project');

    // What the command line kept while it wrote is not what is asked about: only the server's
    // own reads are.
    forgetEveryProjection();

    const session = openOn(own, other);
    const otherPublic = join(other, PROJECT_DIR);
    for (const root of [
      rootOf(session, 'public'),
      rootOf(session, 'private'),
      otherPublic,
      rootOf(session, 'global'),
    ]) {
      session.caches.get(root);
    }

    expect(existsSync(fileOf(rootOf(session, 'public')))).toBe(true);
    expect(existsSync(fileOf(rootOf(session, 'private')))).toBe(true);
    expect(existsSync(fileOf(otherPublic))).toBe(false);
    expect(existsSync(fileOf(rootOf(session, 'global')))).toBe(false);
    closeSession(session);
  });

  it('a session outside any project keeps no file at all', () => {
    cli(own, 'memory', '--scope', 'global', 'a note for every project');
    forgetEveryProjection();
    const session = openSession({ clientName: 'claude-code', cwd: sandbox, env });
    session.caches.get(rootOf(session, 'global'));
    expect(existsSync(fileOf(rootOf(session, 'global')))).toBe(false);
    closeSession(session);
  });
});

describe('the second connection takes the file', () => {
  it('opens over what the first kept and replays nothing', () => {
    cli(own, 'decision', 'record', 'Kept between connections', 'a reason');
    const first = openOn(own);
    expect(decisionsOf(first)).toEqual(['Kept between connections']);
    const file = fileOf(rootOf(first, 'public'));
    const kept = generationOf(file);
    closeSession(first);

    const second = openOn(own);
    expect(decisionsOf(second)).toEqual(['Kept between connections']);
    // A replay writes the tables again and moves the counter; taking the file does not.
    expect(generationOf(file)).toBe(kept);
    closeSession(second);
  });

  it('answers the same with the file deleted', () => {
    cli(own, 'decision', 'record', 'Survives the file', 'a reason');
    const first = openOn(own);
    const answer = decisionsOf(first);
    const file = fileOf(rootOf(first, 'public'));
    closeSession(first);

    for (const name of readdirSync(join(file, '..'))) {
      if (name.startsWith('projection.db')) rmSync(join(file, '..', name));
    }

    const second = openOn(own);
    expect(decisionsOf(second)).toEqual(answer);
    closeSession(second);
  });
});

describe('a record that moved behind the file is seen by the next read', () => {
  it('a decision recorded by another process between two reads of one connection', () => {
    const session = openOn(own);
    expect(decisionsOf(session)).toEqual([]);

    cli(own, 'decision', 'record', 'Recorded elsewhere', 'while the server was up');
    expect(decisionsOf(session)).toEqual(['Recorded elsewhere']);

    cli(own, 'decision', 'record', 'Recorded elsewhere again', 'and once more');
    expect(decisionsOf(session)).toEqual(['Recorded elsewhere', 'Recorded elsewhere again']);
    closeSession(session);
  });

  it('a record that moved while no server was up: the next connection reads past the file', () => {
    cli(own, 'decision', 'record', 'Before', 'a reason');
    const first = openOn(own);
    expect(decisionsOf(first)).toEqual(['Before']);
    closeSession(first);

    cli(own, 'decision', 'record', 'After', 'written with the server down');

    const second = openOn(own);
    expect(decisionsOf(second)).toEqual(['After', 'Before']);
    closeSession(second);
  });

  it('a segment cut back to an earlier state, as a checkout of an older commit does', () => {
    cli(own, 'decision', 'record', 'First', 'a reason');
    cli(own, 'decision', 'record', 'Second', 'a reason');
    const first = openOn(own);
    expect(decisionsOf(first)).toEqual(['First', 'Second']);
    const root = rootOf(first, 'public');
    closeSession(first);

    const segment = segmentsOf(root).at(-1) as string;
    const lines = readFileSync(segment, 'utf-8')
      .split('\n')
      .filter((line) => line !== '');
    const keep = lines.findIndex((line) => line.includes('Second'));
    writeFileSync(segment, `${lines.slice(0, keep).join('\n')}\n`);

    const second = openOn(own);
    expect(decisionsOf(second)).toEqual(['First']);
    closeSession(second);
  });

  it('a sealed segment edited in place, to the same size, is read again by the next connection', () => {
    cli(own, 'decision', 'record', 'Original title', 'a reason');
    const first = openOn(own);
    const root = rootOf(first, 'public');
    // A segment is sealed when the writer moves to the next one: a second event in a
    // segment the cap has already passed. The cap is the only thing lowered here.
    writeFromAnotherProcess(own, 'public', 'second segment', 1);
    expect(decisionsOf(first).length).toBe(1);
    closeSession(first);
    const sealed = segmentsOf(root)[0] as string;
    expect(segmentsOf(root).length).toBeGreaterThan(1);

    const text = readFileSync(sealed, 'utf-8');
    expect(text).toContain('Original title');
    writeFileSync(sealed, text.replace('Original title', 'Original TITLE'));

    const second = openOn(own);
    expect(decisionsOf(second)).toEqual(['Original TITLE']);
    closeSession(second);
  });

  it('a tail that arrives with a pull, from another installation', () => {
    cli(own, 'decision', 'record', 'Ours', 'the tail this server knows');
    const session = openOn(own);
    expect(decisionsOf(session)).toEqual(['Ours']);

    const elsewhere = join(sandbox, 'other-home');
    mkdirSync(elsewhere, { recursive: true });
    const inherited = { ...process.env };
    delete inherited.MNEMA_RUN;
    execFileSync(process.execPath, [CLI, 'decision', 'record', 'Theirs', 'another machine'], {
      cwd: own,
      env: { ...inherited, HOME: elsewhere },
      encoding: 'utf-8',
    });

    expect(decisionsOf(session)).toEqual(['Ours', 'Theirs']);
    closeSession(session);
  }, 60_000);
});

describe('a branch checked out over the live segment', () => {
  /**
   * The tails of two branches that share a base and then diverge, the branch longer than the
   * one served: what `git checkout` leaves behind.
   */
  function twoBranches(): { main: Map<string, string>; branch: Map<string, string> } {
    cli(own, 'decision', 'record', 'Base', 'shared by both branches');
    const tails = join(own, PROJECT_DIR, 'tails');
    const base = snapshot(tails);
    cli(own, 'decision', 'record', 'OnMain', 'x');
    const main = snapshot(tails);
    checkout(base);
    cli(own, 'decision', 'record', 'OnTheBranchWithALongerTitle', 'a longer reason than the other');
    cli(own, 'decision', 'record', 'AndMore', 'y');
    return { main, branch: snapshot(tails) };
  }

  /** Every file of a tree's tails, as git keeps them per branch. */
  function snapshot(tails: string): Map<string, string> {
    const files = new Map<string, string>();
    for (const name of readdirSync(tails, { recursive: true, encoding: 'utf-8' })) {
      const path = join(tails, name);
      if (!readdirSafe(path)) files.set(path, readFileSync(path, 'utf-8'));
    }
    return files;
  }

  function checkout(branch: Map<string, string>): void {
    for (const [path, text] of branch) writeFileSync(path, text);
  }

  it('a new session serves the branch and not the other one', () => {
    const { main, branch } = twoBranches();
    checkout(main);
    const first = openOn(own);
    expect(decisionsOf(first)).toEqual(['Base', 'OnMain']);
    closeSession(first);
    checkout(branch);

    const next = openOn(own);
    expect(decisionsOf(next)).toEqual(['AndMore', 'Base', 'OnTheBranchWithALongerTitle']);
    closeSession(next);
  });

  it('a session that is up serves the branch after the checkout', () => {
    const { main, branch } = twoBranches();
    checkout(main);
    const session = openOn(own);
    expect(decisionsOf(session)).toEqual(['Base', 'OnMain']);
    checkout(branch);
    expect(decisionsOf(session)).toEqual(['AndMore', 'Base', 'OnTheBranchWithALongerTitle']);
    closeSession(session);
  });

  it('the command line, which keeps the same file, serves the branch too', () => {
    const { main, branch } = twoBranches();
    checkout(main);
    expect(cli(own, 'search', '--kind', 'decision')).toContain('OnMain');
    checkout(branch);
    const answer = cli(own, 'search', '--kind', 'decision');
    expect(answer).toContain('OnTheBranchWithALongerTitle');
    expect(answer).not.toContain('OnMain');
  });
});

describe('a file another version of the code rewrote under a server that is up', () => {
  it('is taken again and answers, instead of failing on the other schema', () => {
    cli(own, 'decision', 'record', 'Alpha', 'a reason');
    const session = openOn(own);
    expect(decisionsOf(session)).toEqual(['Alpha']);
    const file = fileOf(rootOf(session, 'public'));

    const db = new DatabaseSync(file);
    db.exec('BEGIN IMMEDIATE');
    const row = db.prepare("SELECT value FROM cache_meta WHERE key = 'generation'").get() as {
      value: string;
    };
    db.prepare("UPDATE cache_meta SET value = ? WHERE key = 'generation'").run(
      String(Number(row.value) + 1),
    );
    db.exec("UPDATE cache_meta SET value = 'another-version' WHERE key = 'stamp'");
    db.exec('ALTER TABLE decisions RENAME COLUMN state TO status');
    db.exec('COMMIT');
    db.close();

    // The bootstrap reads the column the other version renamed.
    expect(JSON.stringify(runBootstrap(session))).toContain('Alpha');
    expect(decisionsOf(session)).toEqual(['Alpha']);
    closeSession(session);
  });
});

describe('what a read leaves behind', () => {
  it('is the projection of the tree it read, and nothing else in the project', () => {
    cli(own, 'decision', 'record', 'Something to read', 'so the tree has a tail');
    // The command that wrote it kept its own file; start from a project that has none.
    for (const name of readdirSync(join(own, PROJECT_DIR, 'locks'))) {
      if (name.startsWith('projection.db')) rmSync(join(own, PROJECT_DIR, 'locks', name));
    }
    const before = everyFileUnder(own);

    const session = openOn(own);
    runBootstrap(session);
    closeSession(session);

    const added = everyFileUnder(own).filter((one) => !before.includes(one));
    expect(added.length).toBeGreaterThan(0);
    for (const one of added) expect(one).toMatch(/locks\/projection\.db(?:-wal|-shm)?$/);
  });
});

/** Removes every projection file under the sandbox: the ones the commands that wrote left. */
function forgetEveryProjection(): void {
  for (const name of readdirSync(sandbox, { recursive: true, encoding: 'utf-8' })) {
    if (/(?:^|\/)locks\/projection\.db(?:-wal|-shm)?$/.test(name)) rmSync(join(sandbox, name));
  }
}

/** Appends one memory from ANOTHER process, with the segment cap lowered so it opens a new file. */
function writeFromAnotherProcess(
  project: string,
  scope: Scope,
  content: string,
  maxSegmentBytes: number,
): void {
  const script = `
    const { resolveTrees, chainRootForScope } = await import('@mnema/core');
    const { openTreeForWriting, captureMemory } = await import('@mnema/core/write');
    const { catalogUpcasters } = await import('@mnema/chain');
    const trees = resolveTrees(${JSON.stringify(project)}, { home: process.env.HOME });
    const writer = openTreeForWriting(trees, ${JSON.stringify(scope)}, { maxSegmentBytes: ${maxSegmentBytes} });
    const done = captureMemory(
      { writer, layout: { root: chainRootForScope(trees, ${JSON.stringify(scope)}) }, upcasters: catalogUpcasters() },
      { content: ${JSON.stringify(content)} },
    );
    if (!done.ok) throw new Error('outside capture refused: ' + done.code);
  `;
  const inherited = { ...process.env };
  delete inherited.MNEMA_RUN;
  execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: PACKAGE_DIR,
    env: { ...inherited, HOME: env.home },
    encoding: 'utf-8',
  });
}

/** Every file under `dir`, relative, sorted. */
function everyFileUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf-8' })
    .filter((name) => !readdirSafe(join(dir, name)))
    .sort();
}

function readdirSafe(path: string): boolean {
  try {
    readdirSync(path);
    return true;
  } catch {
    return false;
  }
}
