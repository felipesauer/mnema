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

import { cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CatalogEvent,
  catalogUpcasters,
  decisionBirth,
  decisionTransitioned,
  handoffRecorded,
  knowledgeLinked,
  memoryCaptured,
  observationRecorded,
  runEnded,
  runStarted,
  skillBirth,
  skillConsulted,
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

/**
 * The instant the asking derivations measure against, in these tests.
 *
 * One hour after the bench's own epoch (`makeBench`'s clock starts at
 * 2026-01-01T00:00:00Z and ticks a second per event), so an age is a round number
 * a test can assert rather than a wall-clock value it can only sniff at.
 */
export const ASKED_AT = '2026-01-01T01:00:00.000Z';

/**
 * An {@link ActorScope} for a test: whose context, measured when, and which runs the
 * asker opened itself.
 *
 * The two extra fields are what only an asker knows, and defaulting them here keeps
 * the tests that are about something ELSE from having to say so. A test that IS about
 * them passes them.
 */
export function asking(
  actor: string,
  opts: { readonly asOf?: string; readonly sessionRuns?: readonly string[] } = {},
): { readonly actor: string; readonly asOf: string; readonly sessionRuns: readonly string[] } {
  return {
    actor,
    asOf: opts.asOf ?? ASKED_AT,
    sessionRuns: opts.sessionRuns ?? [],
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
  moveTaskAt(b, id, b.now(), from, to, action, fields);
}

/**
 * The same move, at an instant the caller chooses — the only way to make two tasks
 * share an `updatedAt`, because `b.now()` is monotonic by design.
 *
 * A derivation that orders by an instant has a tie-break, and a tie-break is only
 * testable if a tie can be built. Nothing about this is unrealistic: two moves in the
 * same millisecond is one batch script.
 */
export function moveTaskAt(
  b: Bench,
  id: string,
  at: string,
  from: string,
  to: string,
  action: string,
  fields?: TransitionFields,
): void {
  b.writer.append(
    taskTransitioned(
      { at, who: b.who, signerFp: b.writer.signerFingerprint, subject: id },
      { from, to, action, ...(fields !== undefined ? { fields } : {}) },
    ),
  );
}

/**
 * Appends one `skill.consulted` — a session was served that pattern's body.
 *
 * The `run` and the `who` are arguments because the counting derivation is ABOUT
 * them: one run consulting twice is one session, and the same run may record the
 * fact in two trees. A test that could not vary them could not tell those apart.
 */
export function consultSkill(
  b: Bench,
  id: string,
  opts: { readonly run?: string; readonly who?: string; readonly which?: string } = {},
): void {
  b.writer.append(
    skillConsulted({
      at: b.now(),
      who: opts.who ?? b.who,
      signerFp: b.writer.signerFingerprint,
      subject: id,
      ...(opts.run !== undefined ? { run: opts.run } : {}),
      ...(opts.which !== undefined ? { which: opts.which } : {}),
    }),
  );
}

/**
 * Appends a decision's birth pair, returning its id.
 *
 * THE STATES ARE THE WORKFLOW'S OWN, in the workflow's own case. These helpers used
 * to write `PROPOSED`/`ACCEPTED`/`SUPERSEDED`, which no write path of the product can
 * produce: `DECISION_STATES` is lower-case, `isDecisionState('PROPOSED')` is false by
 * its own test, and the projection's `state` column is compared with SQLite's binary
 * collation — so a fixture in the wrong case is a decision no state-keyed read can
 * ever match. It cost nothing while every test keyed on ids and roles; it would have
 * made a state FILTER untestable, which is what {@link decisionsInForce} is.
 */
export function birthDecision(
  b: Bench,
  id: string,
  title: string,
  initial = 'proposed',
  // The label the chain would have minted, when a case is ABOUT the label. It
  // defaults to one derived from the id, which keeps every other fixture's labels
  // distinct without a case having to say so — a shape the product never produces,
  // and harmless everywhere the label is carried rather than compared. A case that
  // compares them passes the number this chain's own count would have frozen.
  adr = `ADR-${id}`,
): string {
  for (const e of decisionBirth(
    { at: b.now(), who: b.who, signerFp: b.writer.signerFingerprint, subject: id },
    {
      title,
      rationale: `why ${title}`,
      adr,
      initial,
      // Every bench decision carries what it turned down, and that is deliberate:
      // this layer serves NAMES and never bodies, and a decision's body is now two
      // fields. A fixture that left the second one absent would let every "never
      // carries the body" assertion pass by having nothing to leak.
      alternatives: `turned down for ${title}`,
    },
  )) {
    b.writer.append(e);
  }
  return id;
}

/**
 * Appends one `decision.transitioned` — a decision moving as the workflow moves it,
 * with the proof field that action requires (`accept` and `reject` take a note).
 *
 * A decision is ALWAYS born `proposed` in production (`INITIAL_DECISION_STATE`), so
 * this is how a test reaches any other state by the path the product takes, rather
 * than by asking the birth for a state no birth writes.
 */
export function moveDecision(
  b: Bench,
  id: string,
  from: string,
  to: string,
  action: string,
  fields: TransitionFields = { note: `${action}ed` },
): void {
  moveDecisionAt(b, id, b.now(), from, to, action, fields);
}

/**
 * The same move, at an instant the caller chooses — the only way to make two
 * decisions share an `updatedAt`, because `b.now()` is monotonic by design. The
 * reason is the task helper's: a derivation that orders by an instant has a
 * tie-break, and a tie-break is only testable if a tie can be built.
 */
export function moveDecisionAt(
  b: Bench,
  id: string,
  at: string,
  from: string,
  to: string,
  action: string,
  fields: TransitionFields = { note: `${action}ed` },
): void {
  b.writer.append(
    decisionTransitioned(
      { at, who: b.who, signerFp: b.writer.signerFingerprint, subject: id },
      { from, to, action, fields },
    ),
  );
}

/**
 * Appends a `decision.transitioned {action: 'supersede'}` naming the successor, with
 * the `reason` the gate requires of that move.
 */
export function supersedeDecision(b: Bench, id: string, by: string, from = 'accepted'): void {
  b.writer.append(
    decisionTransitioned(
      { at: b.now(), who: b.who, signerFp: b.writer.signerFingerprint, subject: id },
      { from, to: 'superseded', action: 'supersede', by, fields: { reason: 'replaced' } },
    ),
  );
}

/**
 * Appends a skill's birth pair, returning its id. States are the workflow's own.
 * `which` names the agent that executed the birth; omitted, the events carry no
 * agent — which is what a person acting directly leaves behind.
 */
export function birthSkill(
  b: Bench,
  id: string,
  name: string,
  initial = 'proposed',
  which?: string,
): string {
  for (const e of skillBirth(
    {
      at: b.now(),
      who: b.who,
      signerFp: b.writer.signerFingerprint,
      subject: id,
      ...(which !== undefined ? { which } : {}),
    },
    { name, body: `body of ${name}`, initial },
  )) {
    b.writer.append(e);
  }
  return id;
}

/** Appends a `skill.transitioned`, optionally executed by an agent. */
export function moveSkill(
  b: Bench,
  id: string,
  from: string,
  to: string,
  action: string,
  which?: string,
): void {
  b.writer.append(
    skillTransitioned(
      {
        at: b.now(),
        who: b.who,
        signerFp: b.writer.signerFingerprint,
        subject: id,
        ...(which !== undefined ? { which } : {}),
      },
      { from, to, action, fields: { note: `${action}ed` } },
    ),
  );
}

/** Appends a `skill.transitioned {action: 'deprecate'}`. */
export function deprecateSkill(b: Bench, id: string, from = 'adopted'): void {
  b.writer.append(
    skillTransitioned(
      { at: b.now(), who: b.who, signerFp: b.writer.signerFingerprint, subject: id },
      { from, to: 'deprecated', action: 'deprecate', fields: { reason: 'unused' } },
    ),
  );
}

/**
 * Appends a `memory.captured`, returning its id. `run` pins it to a run — the
 * envelope slot every fact of a session carries, and the only way a run comes to have
 * anything recorded IN it.
 */
export function capture(b: Bench, id: string, content: string, run?: string): string {
  b.writer.append(
    memoryCaptured(
      {
        at: b.now(),
        who: b.who,
        signerFp: b.writer.signerFingerprint,
        subject: id,
        ...(run !== undefined ? { run } : {}),
      },
      { content },
    ),
  );
  return id;
}

/** Appends a `handoff.recorded` on a task — a fact with no prose of its own. */
export function handoff(b: Bench, task: string, fromAgent: string, toAgent: string): void {
  b.writer.append(
    handoffRecorded(
      { at: b.now(), who: b.who, signerFp: b.writer.signerFingerprint, subject: task },
      { fromAgent, toAgent },
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

/**
 * Lands another bench's tail in this one's tree — the offline merge two clones of a
 * repository produce when their branches meet.
 *
 * It is the only way a chain comes to hold two `ADR-1`s: each bench numbered its own
 * first decision from the chain IT could see, and neither write could have known about
 * the other. Copying the tail and the public key material is what a clone brings; the
 * signing key never lives in a tree.
 *
 * The merged-into bench keeps reading through its own root, so `events()` and
 * `cache()` now see both tails.
 */
export function mergeTailInto(into: Bench, from: Bench): void {
  cpSync(join(from.root, 'tails'), join(into.root, 'tails'), { recursive: true });
  cpSync(join(from.root, 'keys'), join(into.root, 'keys'), { recursive: true });
}
