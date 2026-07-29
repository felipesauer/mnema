/**
 * Locating an entity's home tree inside a session.
 *
 * The rule — which trees are searched, in what order, what counts as the same id
 * — lives in the core and is shared with the CLI. What a session changes is only
 * how ONE tree is asked whether it holds a birth: from its warm projection,
 * where the id is a primary key, instead of by replaying its chain. So the
 * property under test is not "the fast path is fast" but "the fast path answers
 * the same", and almost everything here is a comparison against what a fresh
 * process would say.
 *
 * The comparison is computed, never written down as a literal: each case asks
 * both the session's locate and the core's replaying one, so a change to either
 * side shows up here rather than in a hand-copied expectation.
 *
 * Two groups carry the weight. The first is the agreement itself, across every
 * entity kind and every tree. The second is the reason the session's locate
 * falls back to the chain at all: a projection holds only COMPLETE entities and
 * only what THIS session has seen, so on its own it would have lost a truncated
 * birth and — the one that would have hurt — a task another process had just
 * created, which used to move successfully. Both are exercised against the
 * projections alone, to show the fallback is load-bearing and not insurance.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  catalogUpcasters,
  decisionRecorded,
  ensureTree,
  skillCreated,
  taskCreated,
} from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  locateEntityScope,
  locateEntityScopeWith,
  PROJECT_DIR,
  resolveTrees,
  type Scope,
} from '@mnema/core';
import {
  acceptDecision,
  createTask,
  openTreeForWriting,
  reviewSkill,
  transitionTask,
} from '@mnema/core/write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCacheRegistry } from '../src/mcp/cache-registry.js';
import { cachedBirthProbe, locateEntityInSession } from '../src/mcp/locate.js';
import {
  closeSession,
  openSession,
  openWrite,
  type Session,
  writeContext,
} from '../src/mcp/session.js';
import {
  runCaptureMemory,
  runCreateSkill,
  runCreateTask,
  runDecisionTransition,
  runGuardTool,
  runNextActionsTool,
  runRecordDecision,
  runSkillTransition,
  runTaskTransition,
} from '../src/mcp/tools.js';

let sandbox: string;
let env: DiscoveryEnv;

const upcasters = catalogUpcasters();
const AT = '2026-07-28T00:00:00.000Z';

/** Makes a directory that IS a project (has a `.mnema/` tree), returns its path. */
function makeProject(name: string): string {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  ensureTree({ root: join(dir, PROJECT_DIR) });
  return dir;
}

/** Opens an agent session on a project — the shape every test starts from. */
function openOn(project: string): Session {
  return openSession({ clientName: 'claude-code', roots: [pathToFileURL(project).href], env });
}

/** Where a replay of each chain says the entity lives — what a fresh process answers. */
function viaReplay(session: Session, id: string): Scope | undefined {
  return locateEntityScope(session.trees, id, upcasters);
}

/** Where the session's PROJECTIONS alone say it lives — the fast half, on its own. */
function viaProjectionsOnly(session: Session, id: string): Scope | undefined {
  return locateEntityScopeWith(session.trees, id, cachedBirthProbe(session.caches));
}

/**
 * Appends a birth RECORD with no initial transition — the truncated birth a
 * complete write never produces (the pair is appended atomically) but a
 * partially-fetched chain can carry. No projection will hold it; every replay
 * will find it.
 */
function truncatedBirth(
  session: Session,
  scope: Scope,
  kind: 'task' | 'decision' | 'skill',
  id: string,
): string {
  const writer = openTreeForWriting(session.trees, scope);
  const envelope = { at: AT, who: writer.anchor, signerFp: writer.signerFingerprint, subject: id };
  writer.append(
    kind === 'task'
      ? taskCreated(envelope, { title: 'never transitioned' })
      : kind === 'decision'
        ? decisionRecorded(envelope, {
            title: 'never transitioned',
            rationale: 'why',
            adr: 'ADR-9',
          })
        : skillCreated(envelope, { name: 'never transitioned', body: 'b' }),
  );
  writer.checkpoint();
  // The tree was written to behind the registry's back; tell it, exactly as
  // `writeContext` would have. Without this the session would be answering from
  // a projection taken before the append — a different question from this one.
  session.caches.invalidate(chainRootForScope(session.trees, scope) as string);
  return id;
}

/** A v7-shaped id that nothing was ever written under. */
function unusedId(): string {
  return '019fa622-0000-7000-8000-000000000000';
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-locate-cache-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home, xdgDataHome: join(sandbox, 'data') };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('a session locates an entity exactly where a fresh process would', () => {
  it('every entity kind, in every tree, plus the ids nothing holds', () => {
    const session = openOn(makeProject('proj'));

    // One of each kind in each tree the session can reach — nine entities whose
    // home the two paths must agree on, born through the real write tools.
    const ids: string[] = [];
    for (const scope of ['public', 'private', 'global'] as const) {
      const task = runCreateTask(session, { title: `task in ${scope}`, scope });
      const decision = runRecordDecision(session, { title: `d ${scope}`, rationale: 'r', scope });
      const skill = runCreateSkill(session, { name: `s ${scope}`, body: 'b', scope });
      if (!task.ok || !decision.ok || !skill.ok) throw new Error('setup: a write was refused');
      ids.push(task.id, decision.id, skill.id);
    }
    // Plus an id no birth exists for, and one the chain cannot canonicalize.
    ids.push(unusedId(), '\ud800');

    for (const id of ids) {
      expect(locateEntityInSession(session, id)).toBe(viaReplay(session, id));
    }
    // …and the agreement is not the vacuous one: the nine were really located.
    expect(ids.slice(0, 9).map((id) => locateEntityInSession(session, id))).toEqual([
      'public',
      'public',
      'public',
      'private',
      'private',
      'private',
      'global',
      'global',
      'global',
    ]);

    closeSession(session);
  });

  it('a knowledge fact has no home — its id is located by neither path', () => {
    // Memories, observations, handoffs and links are facts, not workflow
    // entities: nothing transitions them and nothing reads them by entity. The
    // probe consults the three entity projections only — the same three kinds
    // the core counts as births.
    const session = openOn(makeProject('proj'));
    const memory = runCaptureMemory(session, { content: 'the auth flow uses PKCE' });
    if (!memory.ok) throw new Error('setup: capture refused');

    expect(locateEntityInSession(session, memory.id)).toBeUndefined();
    expect(viaReplay(session, memory.id)).toBeUndefined();
    closeSession(session);
  });

  it('an entity born in this session, a moment ago, is located from the projection', () => {
    // The invalidation has to reach the LOCATE, not just the reads: the probe
    // asks the registry, so a cache the session's own write left behind is
    // rebuilt before it answers. Written to PUBLIC while the session's default
    // is private, so the tree being refreshed is not the one it writes to.
    const session = openOn(makeProject('proj'));
    // Warm the public projection first, so the probe answers from one that
    // already existed and would be stale.
    expect(viaProjectionsOnly(session, unusedId())).toBeUndefined();

    const created = runCreateTask(session, { title: 'brand new', scope: 'public' });
    if (!created.ok) throw new Error('setup: create refused');

    expect(viaProjectionsOnly(session, created.id)).toBe('public');
    expect(locateEntityInSession(session, created.id)).toBe('public');
    closeSession(session);
  });

  it('the answer comes from the ENTITY’s tree, not the session’s', () => {
    // Two tasks with the same title, one per tree: an answer from the wrong
    // cache would still look plausible, so only the ids tell them apart.
    const session = openOn(makeProject('proj'));
    expect(session.scope).toBe('private');

    const inPublic = runCreateTask(session, { title: 'same name', scope: 'public' });
    const inPrivate = runCreateTask(session, { title: 'same name' });
    if (!inPublic.ok || !inPrivate.ok) throw new Error('setup: create refused');

    expect(locateEntityInSession(session, inPublic.id)).toBe('public');
    expect(locateEntityInSession(session, inPrivate.id)).toBe('private');

    // And the tools that route by it land in the right tree: a move on the
    // public task is legal from DRAFT, and the read that follows sees it.
    expect(runTaskTransition(session, { id: inPublic.id, action: 'submit' })).toMatchObject({
      ok: true,
      to: 'READY',
    });
    const moved = runNextActionsTool(session, { id: inPublic.id });
    if (!moved.ok) throw new Error('next_actions refused after the move');
    expect(moved.actions.map((a) => a.action).sort()).toEqual(['cancel', 'start']);
    // The private namesake did not move.
    const other = runNextActionsTool(session, { id: inPrivate.id });
    if (!other.ok) throw new Error('next_actions refused');
    expect(other.actions.map((a) => a.action).sort()).toEqual(['cancel', 'submit']);

    closeSession(session);
  });

  it('an entity in a tree this context does not have is located by neither path', () => {
    // A session outside a project sees only the global tree. A task born in some
    // project is invisible to it — no probe is even asked about that tree.
    const project = makeProject('proj');
    const inProject = openOn(project);
    const created = runCreateTask(inProject, { title: 'lives in a project', scope: 'public' });
    if (!created.ok) throw new Error('setup: create refused');
    closeSession(inProject);

    const outside = openSession({ clientName: 'claude-code', env });
    expect(outside.inProject).toBe(false);
    expect(locateEntityInSession(outside, created.id)).toBeUndefined();
    expect(viaReplay(outside, created.id)).toBeUndefined();
    closeSession(outside);
  });
});

describe('the projections answer first — the chain is not replayed for an entity they hold', () => {
  it('a warm session still locates a task whose chain has been taken away', () => {
    // The decisive proof that the fast half is the one answering, and that the
    // slow half is not run behind it. Once the projection holds the task, the
    // public tree's event files are deleted: a replay can no longer produce that
    // birth, and the session still locates it. If the locate had gone to the
    // chain first — or at all, for an entity the projection holds — this would
    // not come back 'public'.
    const project = makeProject('proj');
    const session = openOn(project);
    const created = runCreateTask(session, { title: 'in the projection', scope: 'public' });
    if (!created.ok) throw new Error('setup: create refused');
    expect(viaProjectionsOnly(session, created.id)).toBe('public'); // warm

    // Only the public tree's tails: the private tree lives beneath it and must
    // stay intact, or this would be testing an empty context instead.
    const publicRoot = chainRootForScope(session.trees, 'public') as string;
    rmSync(join(publicRoot, 'tails'), { recursive: true, force: true });

    const byReplay = (() => {
      try {
        return viaReplay(session, created.id);
      } catch {
        return 'the chain could not be read';
      }
    })();
    expect(byReplay).not.toBe('public');
    expect(locateEntityInSession(session, created.id)).toBe('public');

    closeSession(session);
  });
});

describe('what the projections alone would have got wrong', () => {
  it('a TRUNCATED birth: the projection cannot see it, the session still can', () => {
    // A birth is two appends — the record and its initial transition — written
    // atomically, so an intact chain never carries one without the other; a
    // partially-fetched chain can. The projection drops such a subject rather
    // than invent a state for it, so on its own it would have reported the
    // entity as living nowhere.
    const session = openOn(makeProject('proj'));
    const task = truncatedBirth(session, 'private', 'task', unusedId());

    expect(viaProjectionsOnly(session, task)).toBeUndefined(); // the gap…
    expect(locateEntityInSession(session, task)).toBe('private'); // …closed
    expect(locateEntityInSession(session, task)).toBe(viaReplay(session, task));
    closeSession(session);
  });

  const kinds = ['task', 'decision', 'skill'] as const;

  for (const kind of kinds) {
    it(`${kind}_transition on a truncated birth answers what the operation answers`, () => {
      const session = openOn(makeProject('proj'));
      const id = truncatedBirth(session, 'private', kind, unusedId());
      const action = kind === 'task' ? 'submit' : kind === 'decision' ? 'accept' : 'review';

      // What the tool answers.
      const actual =
        kind === 'task'
          ? runTaskTransition(session, { id, action })
          : kind === 'decision'
            ? runDecisionTransition(session, { id, action, note: 'n' })
            : runSkillTransition(session, { id, action, note: 'n' });

      // What the operation itself answers once the entity HAS been located — the
      // refusal the tool must be relaying, computed rather than written down.
      const scope = viaReplay(session, id);
      expect(scope).toBe('private');
      const { ctx, run } = openWrite(session, scope as Scope);
      const stamp = { which: session.which, run };
      const refused =
        kind === 'task'
          ? transitionTask(ctx, { id, action, ...stamp })
          : kind === 'decision'
            ? acceptDecision(ctx, { id, fields: { note: 'n' }, ...stamp })
            : reviewSkill(ctx, { id, fields: { note: 'n' }, ...stamp });
      if (refused.ok) throw new Error('the operation did NOT refuse — the case is not live');

      expect(actual).toEqual({ ok: false, code: refused.code, message: refused.message });
      closeSession(session);
    });
  }

  it('the refusal a truncated entity gets for a NON-EXISTENT action is unchanged', () => {
    // The order of the two checks decides which refusal is reported: the entity
    // is located first, then the action vocabulary is checked. Locating from the
    // projection alone would have skipped straight to UNKNOWN_DECISION and
    // silently changed the answer for a case that has nothing to do with caching.
    const session = openOn(makeProject('proj'));
    const decision = truncatedBirth(session, 'private', 'decision', unusedId());
    const skill = truncatedBirth(
      session,
      'private',
      'skill',
      '019fa622-0000-7000-8000-000000000001',
    );

    expect(runDecisionTransition(session, { id: decision, action: 'nope' })).toMatchObject({
      ok: false,
      code: 'UNKNOWN_ACTION',
    });
    expect(runSkillTransition(session, { id: skill, action: 'nope' })).toMatchObject({
      ok: false,
      code: 'UNKNOWN_ACTION',
    });
    closeSession(session);
  });

  it('a task another process just created still MOVES', () => {
    // The one that would have hurt. The session's view of a tree does not
    // include writes it did not make — a declared limit, and already the answer
    // `next_actions` and `guard` gave. It was never the answer a MOVE gave: the
    // operations read the chain, so the move landed. Locating from the
    // projection alone would have turned a task that exists into UNKNOWN_TASK on
    // the one surface that was still right about it.
    const project = makeProject('proj');
    const session = openOn(project);
    // Warm every tree through the probe itself, so the setup does not depend on
    // how the locate happens to be composed — only on the projections existing.
    expect(viaProjectionsOnly(session, unusedId())).toBeUndefined();

    const outside = writeContext(resolveTrees(project, env), 'private', createCacheRegistry());
    const theirs = createTask(outside, { title: 'from another process', which: 'other-agent' });
    if (!theirs.ok) throw new Error('setup: outside create refused');
    outside.writer.checkpoint();

    expect(viaProjectionsOnly(session, theirs.id)).toBeUndefined(); // the gap…
    expect(locateEntityInSession(session, theirs.id)).toBe('private'); // …closed

    expect(runTaskTransition(session, { id: theirs.id, action: 'submit' })).toMatchObject({
      ok: true,
      to: 'READY',
    });
    // And the move refreshed the tree, so the reads catch up with it — the
    // limit closes on the session's first write, exactly as documented.
    const after = runNextActionsTool(session, { id: theirs.id });
    if (!after.ok) throw new Error('next_actions refused after the move');
    expect(after.actions.map((a) => a.action).sort()).toEqual(['cancel', 'start']);

    closeSession(session);
  });

  it('a read of a task another process just created is refused as before', () => {
    // The other half of the same limit, unchanged: the READS answer from the
    // session's projection, so they still do not see it until something this
    // session does rebuilds the tree. The locate finds the tree; the projection
    // it then reads is the stale one. That was the behaviour before and it is
    // the behaviour now — the fallback restores the locate, not the read.
    const project = makeProject('proj');
    const session = openOn(project);
    expect(viaProjectionsOnly(session, unusedId())).toBeUndefined(); // warm

    const outside = writeContext(resolveTrees(project, env), 'private', createCacheRegistry());
    const theirs = createTask(outside, { title: 'from another process', which: 'other-agent' });
    if (!theirs.ok) throw new Error('setup: outside create refused');
    outside.writer.checkpoint();

    const message = `task "${theirs.id}" does not exist`;
    expect(runNextActionsTool(session, { id: theirs.id })).toEqual({
      ok: false,
      code: 'UNKNOWN_TASK',
      message,
    });
    expect(runGuardTool(session, { id: theirs.id, action: 'submit' })).toEqual({
      ok: false,
      code: 'UNKNOWN_TASK',
      message,
    });
    closeSession(session);
  });
});

describe('no MCP tool locates an entity its own way', () => {
  it('only the locate module names the core’s locate reads', () => {
    // The structural guard behind the design, the counterpart of the one that
    // pins every write to the invalidation door. The composition matters — the
    // projections first, the chains only if they came up empty — and a tool that
    // reached for either half directly would quietly get a different answer than
    // the other four: a bare replay would pay a full scan per call, a
    // bare projection walk would lose entities the chain still holds. So the ban
    // is on the SYMBOLS, over the whole MCP surface: a tool added later composes
    // through `locateEntityInSession` or fails here.
    const mcpDir = fileURLToPath(new URL('../src/mcp/', import.meta.url));
    const offenders = readdirSync(mcpDir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'locate.ts')
      .filter((f) => /locateEntityScope/.test(readFileSync(join(mcpDir, f), 'utf-8')));
    expect(offenders).toEqual([]);
  });
});
