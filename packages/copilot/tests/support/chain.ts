/**
 * Test support: build a real chain and a rebuilt ProjectionCache over it.
 *
 * The derivations read a ProjectionCache, and the honest way to test them is
 * against a cache rebuilt from a real chain — the same path production takes —
 * not a hand-mocked cache. This helper writes events through the chain's own
 * builders and topology (so `who` is a real anchor and the tail is signed), then
 * opens and rebuilds a cache over the public tree. It lives in tests/ only; the
 * copilot package itself writes nothing (see boundaries.test.ts).
 */

import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CatalogEvent,
  catalogUpcasters,
  decisionBirth,
  decisionTransitioned,
  knowledgeLinked,
  observationRecorded,
  runEnded,
  runStarted,
  skillBirth,
  skillTransitioned,
  type TransitionFields,
  taskBirth,
  taskTransitioned,
} from '@mnema/chain';
import { chainRootForScope, orderedEvents, ProjectionCache, resolveTrees } from '@mnema/core';
import { openTreeForWriting } from '@mnema/core/write';

/** A writer bound to the public tree of a throwaway sandbox, plus its root. */
export interface Bench {
  readonly writer: ReturnType<typeof openTreeForWriting>;
  readonly root: string;
  readonly who: string;
  /** A monotonically increasing wall-clock ISO stamp, so events order stably. */
  now(): string;
  /** Open and rebuild a cache over the tree written so far. */
  cache(): ProjectionCache;
  /** The raw, ordered event stream over the tree — the intelligence input. */
  events(): CatalogEvent[];
}

/** Creates a sandbox, opens the public tree for writing, and returns a Bench. */
export function makeBench(): Bench {
  const sandbox = mkdtempSync(join(tmpdir(), 'mnema-copilot-'));
  mkdirSync(join(sandbox, 'repo', '.mnema'), { recursive: true });
  const trees = resolveTrees(join(sandbox, 'repo'), {
    xdgDataHome: join(sandbox, 'data'),
    home: join(sandbox, 'home'),
  });
  const writer = openTreeForWriting(trees, 'public');
  const root = chainRootForScope(trees, 'public') as string;

  let tick = 0;
  const now = (): string => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString();

  return {
    writer,
    root,
    who: writer.anchor,
    now,
    cache(): ProjectionCache {
      const c = ProjectionCache.open(root);
      c.rebuild();
      return c;
    },
    events(): CatalogEvent[] {
      return orderedEvents({ root }, catalogUpcasters());
    },
  };
}

/** How a run is started: its agent, an optional goal, and an optional `who`. */
export interface RunSpec {
  readonly agent: string;
  readonly goal?: string;
  /**
   * The authorizing identity to stamp as `who`. Defaults to the writer's anchor.
   * A test may override it to simulate a DIFFERENT actor sharing the tail — the
   * projection replays `who` as written, which is exactly what focus filters on.
   * (Such an event would not pass `verify` unless that `who` were founded, but a
   * projection replays facts; it never re-judges them.)
   */
  readonly who?: string;
}

/** Appends a `run.started`, returning the run's id. */
export function startRun(b: Bench, id: string, spec: RunSpec): string {
  b.writer.append(
    runStarted(
      {
        at: b.now(),
        who: spec.who ?? b.who,
        signerFp: b.writer.signerFingerprint,
        subject: id,
        which: spec.agent,
      },
      spec.goal !== undefined ? { agent: spec.agent, goal: spec.goal } : { agent: spec.agent },
    ),
  );
  return id;
}

/** Appends a `run.ended` for an existing run. */
export function endRun(b: Bench, id: string, outcome?: string): void {
  b.writer.append(
    runEnded(
      { at: b.now(), who: b.who, signerFp: b.writer.signerFingerprint, subject: id },
      outcome !== undefined ? { outcome } : {},
    ),
  );
}

/** Appends a task's birth pair (created + initial transition), returning its id. */
export function birthTask(b: Bench, id: string, title: string, initial = 'DRAFT'): string {
  for (const e of taskBirth(
    { at: b.now(), who: b.who, signerFp: b.writer.signerFingerprint, subject: id },
    { title, initial },
  )) {
    b.writer.append(e);
  }
  return id;
}

/** Appends one `task.transitioned` (state moves are literal, not gated here). */
export function moveTask(
  b: Bench,
  id: string,
  from: string,
  to: string,
  action: string,
  fields?: TransitionFields,
): void {
  b.writer.append(
    taskTransitioned(
      { at: b.now(), who: b.who, signerFp: b.writer.signerFingerprint, subject: id },
      { from, to, action, ...(fields !== undefined ? { fields } : {}) },
    ),
  );
}

/** Appends a decision's birth pair, returning its id. */
export function birthDecision(b: Bench, id: string, title: string, initial = 'PROPOSED'): string {
  for (const e of decisionBirth(
    { at: b.now(), who: b.who, signerFp: b.writer.signerFingerprint, subject: id },
    { title, rationale: `why ${title}`, adr: `ADR-${id}`, initial },
  )) {
    b.writer.append(e);
  }
  return id;
}

/** Appends a `decision.transitioned {action: 'supersede'}` naming the successor. */
export function supersedeDecision(b: Bench, id: string, by: string, from = 'ACCEPTED'): void {
  b.writer.append(
    decisionTransitioned(
      { at: b.now(), who: b.who, signerFp: b.writer.signerFingerprint, subject: id },
      { from, to: 'SUPERSEDED', action: 'supersede', by },
    ),
  );
}

/** Appends a skill's birth pair, returning its id. */
export function birthSkill(b: Bench, id: string, name: string, initial = 'PROPOSED'): string {
  for (const e of skillBirth(
    { at: b.now(), who: b.who, signerFp: b.writer.signerFingerprint, subject: id },
    { name, body: `body of ${name}`, initial },
  )) {
    b.writer.append(e);
  }
  return id;
}

/** Appends a `skill.transitioned {action: 'deprecate'}`. */
export function deprecateSkill(b: Bench, id: string, from = 'ADOPTED'): void {
  b.writer.append(
    skillTransitioned(
      { at: b.now(), who: b.who, signerFp: b.writer.signerFingerprint, subject: id },
      { from, to: 'DEPRECATED', action: 'deprecate', fields: { reason: 'unused' } },
    ),
  );
}

/** Appends an `observation.recorded` about an entity, returning the note's id. */
export function observe(b: Bench, obsId: string, about: string, text = 'noted'): string {
  b.writer.append(
    observationRecorded(
      { at: b.now(), who: b.who, signerFp: b.writer.signerFingerprint, subject: obsId },
      { about, topic: 'note', text },
    ),
  );
  return obsId;
}

/** Appends a `knowledge.linked` from `subject` to `target` with a relation. */
export function link(b: Bench, subject: string, target: string, rel = 'relates-to'): void {
  b.writer.append(
    knowledgeLinked(
      { at: b.now(), who: b.who, signerFp: b.writer.signerFingerprint, subject },
      { target, rel },
    ),
  );
}
