/**
 * The session's warm projection caches.
 *
 * A cache retained between tool calls is only worth having if it cannot go
 * behind the chain, so most of what is here is about freshness rather than
 * speed. The entry that matters is the first group: for EVERY write tool, a read
 * in the same session sees the write. Stale data handed to an agent is worse
 * than a slow answer, and that is the property these tests defend.
 *
 * The rest pins the boundaries the reuse depends on: one cache per TREE (a write
 * to one leaves the others alone, and a read of one is never answered from
 * another), the handles released when the session ends even if ending it fails,
 * and — structurally — that no write in the MCP surface reaches a chain without
 * passing the door where the invalidation lives.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureTree } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  PROJECT_DIR,
  type ProjectionCache,
  resolveTrees,
  type Scope,
} from '@mnema/core';
import { createTask } from '@mnema/core/write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCacheRegistry } from '../src/mcp/cache-registry.js';
import { closeSession, openSession, type Session, writeContext } from '../src/mcp/session.js';
import {
  runCaptureMemory,
  runCreateSkill,
  runCreateTask,
  runDecisionTransition,
  runFocusTool,
  runGuardTool,
  runLinkKnowledge,
  runNextActionsTool,
  runRecordDecision,
  runRecordHandoff,
  runRecordObservation,
  runSkillTransition,
  runTaskTransition,
} from '../src/mcp/tools.js';

let sandbox: string;
let env: DiscoveryEnv;

/** Makes a directory that IS a project (has a `.mnema/` tree), returns its path. */
function makeProject(name: string): string {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  ensureTree({ root: join(dir, PROJECT_DIR) });
  return dir;
}

/** Opens an agent session on a fresh project — the shape every test starts from. */
function openOn(project: string): Session {
  return openSession({
    clientName: 'claude-code',
    roots: [pathToFileURL(project).href],
    env,
  });
}

/** The chain root a scope resolves to within a session's trees. */
function rootOf(session: Session, scope: Scope): string {
  return chainRootForScope(session.trees, scope) as string;
}

/** The session's cache for a scope — the same one the read tools receive. */
function cacheOf(session: Session, scope: Scope): ProjectionCache {
  return session.caches.get(rootOf(session, scope));
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-session-cache-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home, xdgDataHome: join(sandbox, 'data') };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('a write is visible to the next read in the same session', () => {
  /**
   * One case per write tool. Each WARMS the session's cache first (so the test
   * is about a cache that already exists and would be stale), performs the
   * write, and then reads the SAME cache object the read tools are handed. If
   * `writeContext` failed to invalidate, `see` would find nothing.
   *
   * The assertion goes through the cache rather than a read tool because most of
   * these facts have no read tool that surfaces them yet — a memory, a link, a
   * decision. Checking the cache is checking the thing every present and future
   * read shares, which is where the staleness would live.
   */
  const cases: {
    readonly tool: string;
    readonly write: (session: Session) => void;
    readonly see: (cache: ProjectionCache) => boolean;
  }[] = [];

  cases.push({
    tool: 'capture_memory',
    write: (s) => {
      const done = runCaptureMemory(s, { content: 'the auth flow uses PKCE' });
      if (!done.ok) throw new Error(`capture refused: ${done.code}`);
    },
    see: (cache) => cache.listMemories().some((m) => m.content === 'the auth flow uses PKCE'),
  });

  cases.push({
    tool: 'record_observation',
    write: (s) => {
      const done = runRecordObservation(s, { about: 'subject-1', topic: 'perf', text: 'slow' });
      if (!done.ok) throw new Error(`observe refused: ${done.code}`);
    },
    see: (cache) => cache.listObservationsAbout('subject-1').length === 1,
  });

  cases.push({
    tool: 'record_handoff',
    write: (s) => {
      const done = runRecordHandoff(s, { task: 'task-1', from: 'a', to: 'b' });
      if (!done.ok) throw new Error(`handoff refused: ${done.code}`);
    },
    see: (cache) => cache.listHandoffs('task-1').length === 1,
  });

  cases.push({
    tool: 'link_knowledge',
    write: (s) => {
      const done = runLinkKnowledge(s, { subject: 'from-1', target: 'to-1', rel: 'relates-to' });
      if (!done.ok) throw new Error(`link refused: ${done.code}`);
    },
    see: (cache) => cache.listLinksFrom('from-1').some((e) => e.target === 'to-1'),
  });

  cases.push({
    tool: 'create_task',
    write: (s) => {
      const done = runCreateTask(s, { title: 'freshly opened' });
      if (!done.ok) throw new Error(`create refused: ${done.code}`);
    },
    see: (cache) => cache.listTasks().some((t) => t.title === 'freshly opened'),
  });

  cases.push({
    tool: 'record_decision',
    write: (s) => {
      const done = runRecordDecision(s, { title: 'use PKCE', rationale: 'implicit is dead' });
      if (!done.ok) throw new Error(`decision refused: ${done.code}`);
    },
    see: (cache) => cache.listDecisions().some((d) => d.title === 'use PKCE'),
  });

  cases.push({
    tool: 'create_skill',
    write: (s) => {
      const done = runCreateSkill(s, { name: 'bisect', body: 'halve the range' });
      if (!done.ok) throw new Error(`skill refused: ${done.code}`);
    },
    see: (cache) => cache.listSkills().some((k) => k.name === 'bisect'),
  });

  for (const { tool, write, see } of cases) {
    it(`${tool} — the cache the next read gets already has it`, () => {
      const session = openOn(makeProject('proj'));
      // Warm it: from here on the session HAS a cache that a write can leave behind.
      expect(cacheOf(session, session.scope)).toBeDefined();
      expect(see(cacheOf(session, session.scope))).toBe(false);

      write(session);

      expect(see(cacheOf(session, session.scope))).toBe(true);
      closeSession(session);
    });
  }

  it('task_transition — the read tools report the state the move just reached', () => {
    const session = openOn(makeProject('proj'));
    const created = runCreateTask(session, { title: 'moves' });
    if (!created.ok) throw new Error('setup: create refused');

    // Warm the cache on the PRE-move state, through the real read tools.
    const before = runNextActionsTool(session, { id: created.id });
    if (!before.ok) throw new Error('setup: next_actions refused');
    expect(before.actions.map((a) => a.action).sort()).toEqual(['cancel', 'submit']);

    const moved = runTaskTransition(session, { id: created.id, action: 'submit' });
    expect(moved).toMatchObject({ ok: true, to: 'READY' });

    // Both reads must see READY, not the DRAFT they were warmed on.
    const after = runNextActionsTool(session, { id: created.id });
    if (!after.ok) throw new Error('next_actions refused after the move');
    expect(after.actions.map((a) => a.action).sort()).toEqual(['cancel', 'start']);

    const guarded = runGuardTool(session, { id: created.id, action: 'start' });
    if (!guarded.ok) throw new Error('guard refused after the move');
    expect(guarded.result.verdict).toMatchObject({ ok: true, to: 'IN_PROGRESS' });

    closeSession(session);
  });

  it('decision_transition — the cache carries the new state, not the one it was warmed on', () => {
    const session = openOn(makeProject('proj'));
    const recorded = runRecordDecision(session, { title: 'adopt X', rationale: 'because' });
    if (!recorded.ok) throw new Error('setup: record refused');
    expect(cacheOf(session, session.scope).getDecision(recorded.id)?.state).toBe('proposed');

    const moved = runDecisionTransition(session, {
      id: recorded.id,
      action: 'accept',
      note: 'agreed',
    });
    expect(moved).toMatchObject({ ok: true, to: 'accepted' });
    expect(cacheOf(session, session.scope).getDecision(recorded.id)?.state).toBe('accepted');
    closeSession(session);
  });

  it('skill_transition — the cache carries the new state, not the one it was warmed on', () => {
    const session = openOn(makeProject('proj'));
    const created = runCreateSkill(session, { name: 'bisect', body: 'halve the range' });
    if (!created.ok) throw new Error('setup: create refused');
    expect(cacheOf(session, session.scope).getSkill(created.id)?.state).toBe('proposed');

    const moved = runSkillTransition(session, {
      id: created.id,
      action: 'review',
      note: 'read it',
    });
    expect(moved).toMatchObject({ ok: true, to: 'reviewed' });
    expect(cacheOf(session, session.scope).getSkill(created.id)?.state).toBe('reviewed');
    closeSession(session);
  });

  it('the run the first write opened is already in the next read', () => {
    // The run is appended by the door, on the way to the write the agent asked for,
    // and the cache is told through that same door. It has to be visible immediately
    // anyway — a focus that could not see the run the previous call opened would be
    // the reuse breaking on the connection's own work.
    const session = openOn(makeProject('proj'));
    if (!runCaptureMemory(session, { content: 'the write that opens the run' }).ok) {
      throw new Error('setup: capture refused');
    }
    const focus = runFocusTool(session);
    expect(focus.openRuns.some((r) => r.id === session.run.id)).toBe(true);
    closeSession(session);
  });
});

describe('one cache per tree — the trees do not mix', () => {
  it('a task read out of the public tree is not answered from the private one', () => {
    const session = openOn(makeProject('proj'));
    expect(session.scope).toBe('private');

    // Two tasks with the same title, one per tree — so an answer from the wrong
    // cache would still look plausible. Only the ids tell them apart.
    const inPublic = runCreateTask(session, { title: 'same name', scope: 'public' });
    const inPrivate = runCreateTask(session, { title: 'same name' });
    if (!inPublic.ok || !inPrivate.ok) throw new Error('setup: create refused');

    // Each read routes by the ENTITY's home tree, so both resolve.
    expect(runNextActionsTool(session, { id: inPublic.id }).ok).toBe(true);
    expect(runNextActionsTool(session, { id: inPrivate.id }).ok).toBe(true);

    // And the caches are genuinely separate: neither holds the other's task.
    const publicCache = cacheOf(session, 'public');
    const privateCache = cacheOf(session, 'private');
    expect(publicCache).not.toBe(privateCache);
    expect(publicCache.getTask(inPublic.id)).not.toBeNull();
    expect(publicCache.getTask(inPrivate.id)).toBeNull();
    expect(privateCache.getTask(inPrivate.id)).not.toBeNull();
    expect(privateCache.getTask(inPublic.id)).toBeNull();

    closeSession(session);
  });

  it('a move follows the entity into another tree, and THAT tree’s read sees it', () => {
    // The cross-tree case the registry exists for: the session writes private,
    // but the task lives public, so the invalidation has to land on the public
    // cache — the one the session never writes to by default.
    const session = openOn(makeProject('proj'));
    const created = runCreateTask(session, { title: 'lives in public', scope: 'public' });
    if (!created.ok) throw new Error('setup: create refused');

    const before = runNextActionsTool(session, { id: created.id });
    if (!before.ok) throw new Error('setup: next_actions refused');
    expect(before.actions.map((a) => a.action).sort()).toEqual(['cancel', 'submit']);

    // A private capture in between, to prove it is not what refreshes public.
    const noise = runCaptureMemory(session, { content: 'unrelated' });
    if (!noise.ok) throw new Error('setup: capture refused');

    const moved = runTaskTransition(session, { id: created.id, action: 'submit' });
    expect(moved).toMatchObject({ ok: true, to: 'READY' });

    const after = runNextActionsTool(session, { id: created.id });
    if (!after.ok) throw new Error('next_actions refused after the move');
    expect(after.actions.map((a) => a.action).sort()).toEqual(['cancel', 'start']);

    closeSession(session);
  });

  it('a write to one tree does not invalidate another tree’s cache', () => {
    // The other half of "they do not mix": invalidation is per root, so a private
    // write must leave the public cache exactly as it was. Observed by appending
    // to the public chain BEHIND the session's back — if the private write had
    // wrongly invalidated public, the next public read would rebuild and pick the
    // stray event up. It does not, which is what over-invalidation would look like.
    const project = makeProject('proj');
    const session = openOn(project);

    const seen = runCreateTask(session, { title: 'known', scope: 'public' });
    if (!seen.ok) throw new Error('setup: create refused');
    expect(cacheOf(session, 'public').listTasks()).toHaveLength(1);

    // Behind the session's back, into the PUBLIC tree.
    const outside = writeContext(resolveTrees(project, env), 'public', createCacheRegistry());
    const stray = createTask(outside, { title: 'appended from outside' });
    if (!stray.ok) throw new Error('setup: outside create refused');
    outside.writer.checkpoint();

    // A PRIVATE write through the session: it invalidates private, not public.
    const captured = runCaptureMemory(session, { content: 'private note' });
    if (!captured.ok) throw new Error('setup: capture refused');

    expect(cacheOf(session, 'public').listTasks()).toHaveLength(1);
    expect(cacheOf(session, 'public').getTask(stray.id)).toBeNull();
    // …while a PUBLIC write through the session does rebuild it, and the stray
    // event comes along — the cache is a replay of the chain, not a log of what
    // this session did.
    const later = runCreateTask(session, { title: 'later', scope: 'public' });
    if (!later.ok) throw new Error('setup: create refused');
    expect(cacheOf(session, 'public').getTask(stray.id)).not.toBeNull();

    closeSession(session);
  });

  it('the registry holds one cache per tree and no more, however many reads run', () => {
    // The memory bound, and it is structural rather than an eviction policy: the
    // keys can only be the session's resolved trees, so a long connection cannot
    // grow past them.
    const session = openOn(makeProject('proj'));
    const task = runCreateTask(session, { title: 'read me' });
    if (!task.ok) throw new Error('setup: create refused');

    const instances = new Set<ProjectionCache>();
    for (let i = 0; i < 30; i += 1) {
      instances.add(cacheOf(session, 'public'));
      instances.add(cacheOf(session, 'private'));
      instances.add(cacheOf(session, 'global'));
      runFocusTool(session);
      runNextActionsTool(session, { id: task.id });
    }
    expect(instances.size).toBe(3);
    closeSession(session);
  });
});

describe('a KNOWN LIMIT: a write from outside the session is not seen', () => {
  it('a warm cache does not notice another process appending to the same tree', () => {
    // Declared, not accidental. Invalidation is driven by THIS process's writes,
    // which is what makes it exact and free — and it is the whole of what it can
    // see. A `mnema` command in a terminal, or a second agent on the same
    // project, appends to a tree this session has already read, and the session
    // keeps answering from the projection it has until something it does itself
    // rebuilds that tree.
    //
    // The alternative was rejected on purpose: polling mtimes or expiring on a
    // timer trades an exact rule for a guess, and would still be a race. The real
    // fix belongs to a cache shared BETWEEN processes, where the coordination has
    // an owner. Until then a fresh process (every CLI command is one) always
    // reads the chain, so the record itself is never what goes wrong — only one
    // connection's view of it, for as long as that connection stays read-only.
    //
    // This test exists to make the limit visible and to make removing it
    // deliberate: whoever closes the gap has to come here and say so.
    const project = makeProject('proj');
    const session = openOn(project);

    const mine = runCreateTask(session, { title: 'mine' });
    if (!mine.ok) throw new Error('setup: create refused');
    expect(cacheOf(session, session.scope).listTasks()).toHaveLength(1);

    const outside = writeContext(resolveTrees(project, env), 'private', createCacheRegistry());
    const theirs = createTask(outside, { title: 'theirs', which: 'another-agent' });
    if (!theirs.ok) throw new Error('setup: outside create refused');
    outside.writer.checkpoint();

    // The chain HAS both. The session's warm cache has one.
    expect(cacheOf(session, session.scope).getTask(theirs.id)).toBeNull();

    // The moment this session writes to that tree again, the replay catches up —
    // so the divergence closes on its own the first time the agent does anything.
    const anything = runCaptureMemory(session, { content: 'any write at all' });
    if (!anything.ok) throw new Error('setup: capture refused');
    expect(cacheOf(session, session.scope).getTask(theirs.id)).not.toBeNull();

    closeSession(session);
  });
});

describe('the session releases what it held', () => {
  it('closing the session closes the databases it opened', () => {
    const session = openOn(makeProject('proj'));
    const cache = cacheOf(session, session.scope);
    expect(cache.listTasks()).toEqual([]);
    // A run to end, so the close does its recording half as well as its releasing
    // half — the release must not depend on the write, and this is the path where
    // both happen.
    if (!runCaptureMemory(session, { content: 'a note' }).ok) {
      throw new Error('setup: capture refused');
    }

    expect(closeSession(session)).toBe(true);

    // The handle is really gone — querying the closed cache throws rather than
    // quietly answering from a database nobody owns any more.
    expect(() => cache.listTasks()).toThrow();
  });

  it('closing releases the caches even when ending the run fails', () => {
    // The case that matters for a long-lived server: the close path is
    // best-effort, so the release cannot be conditional on it succeeding.
    const session = openOn(makeProject('proj'));
    const cache = cacheOf(session, session.scope);

    // A session whose scope names a tree that is not there: `writeContext` throws
    // before `endRun` is ever reached.
    const broken: Session = { ...session, trees: { ...session.trees, projectPrivate: undefined } };
    expect(closeSession(broken)).toBe(false);
    expect(() => cache.listTasks()).toThrow();
  });

  it('a call that lands after the close gets a fresh cache, not a closed handle', () => {
    // Releasing FORGETS as well as closes, so the registry stays usable. It
    // matters because the close is driven by the transport, not by the last tool
    // call: a request already in flight when the client disconnects would
    // otherwise reach a database that was shut under it and crash the answer
    // instead of returning one.
    const session = openOn(makeProject('proj'));
    const created = runCreateTask(session, { title: 'before the close' });
    if (!created.ok) throw new Error('setup: create refused');
    closeSession(session);

    const reopened = cacheOf(session, session.scope);
    expect(reopened.getTask(created.id)).not.toBeNull();
    session.caches.closeAll();
  });
});

describe('no MCP write reaches a chain without passing the invalidation door', () => {
  it('only the session module opens a tree for writing', () => {
    // The structural guard behind the whole design. Every write tool builds its
    // context with `writeContext`, and that is the only place a cache is told it
    // went behind. A tool that opened its own writer would append events no cache
    // ever hears about — a silent staleness with no test to catch it, because it
    // would look correct until the second read. So the ban is on the SYMBOL that
    // makes a writer, checked over the whole MCP surface: a write tool added
    // later inherits the invalidation or fails here.
    const mcpDir = fileURLToPath(new URL('../src/mcp/', import.meta.url));
    const offenders = readdirSync(mcpDir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'session.ts')
      .filter((f) =>
        /openTreeForWriting|openChainForWriting/.test(readFileSync(join(mcpDir, f), 'utf-8')),
      );
    expect(offenders).toEqual([]);
  });
});
