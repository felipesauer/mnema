/**
 * `mnema task <title>` — create a task.
 *
 * This is the MOLD every writing verb copies: an adapter that parses input,
 * resolves which tree the write belongs to, opens that tree's writer, calls ONE
 * core write operation through the gate, and reports what the operation returned.
 * The path adapter → gate → chain runs here in full; the ~nine other verbs
 * differ only in which operation they call.
 *
 * It holds no domain logic. The id is minted by `createTask`, the identity is
 * derived by the writer, the scope is the core's routing rule — the command only
 * decides that a task needs a project to belong to, and refuses when there is
 * none.
 *
 * The birth scope is a per-action choice: an explicit `scope` wins (the override
 * the caller states); when omitted, the routing rule's default stands — a
 * deliberate human capture (no executing agent) goes to the public tree. That
 * omitted default is PROVISIONAL: the team-wide default is left open to decide
 * against real use, and only the mechanism (the override on top) is settled here.
 */

import { catalogUpcasters } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  deriveAlias,
  resolveScope,
  resolveTrees,
  type Scope,
} from '@mnema/core';
import { createTask, openTreeForWriting } from '@mnema/core/write';

/** What the task command needs — injected so it is testable. */
export interface TaskContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** A task was created. */
export interface TaskCreated {
  readonly ok: true;
  /** The minted task id. */
  readonly id: string;
  /** The short human-facing alias (`t-xxxx`), derived from the id. */
  readonly alias: string;
}

/** The create was refused. */
export type TaskRefused =
  /** There is no project here — a task is project work and needs one. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** The core operation refused (e.g. the authority invariant). */
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * Creates a task, routing its birth to the resolved scope. The scope is an
 * explicit `scope` when the caller stated one, else the routing default (public,
 * a deliberate human capture) — `resolveScope` is the single source of that rule,
 * so the command never re-decides it.
 *
 * A PROJECT scope (public/private) needs a project: with no `.mnema/` found from
 * the cwd, this refuses `NO_PROJECT` rather than falling through — for a human
 * capturing a task, "run mnema init" is clearer than a task silently landing
 * elsewhere. The GLOBAL scope needs no project (it is personal cross-project
 * knowledge), so `--scope global` works anywhere; the guard is on the RESOLVED
 * scope, not on the flag, so an omitted flag outside a project still refuses.
 */
export function runTask(
  ctx: TaskContext,
  input: { title: string; scope?: Scope },
): TaskCreated | TaskRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const scope = resolveScope({}, input.scope);
  // A project scope needs a project; global does not. Guard the resolved scope,
  // not the flag, so an omitted flag (default public) outside a project refuses
  // just as an explicit `--scope public` would.
  if (scope !== 'global' && trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }

  const writer = openTreeForWriting(trees, scope);
  const created = createTask(
    {
      writer,
      layout: { root: chainRootForScope(trees, scope) as string },
      upcasters: catalogUpcasters(),
    },
    { title: input.title },
  );
  if (!created.ok) {
    return { ok: false, reason: 'REFUSED', code: created.code, message: created.message };
  }

  // Checkpoint so the new task is signature-covered at once — the tree stays
  // fully signed after every command, the same posture init leaves it in.
  writer.checkpoint();

  return { ok: true, id: created.id, alias: deriveAlias('task', created.id) };
}
