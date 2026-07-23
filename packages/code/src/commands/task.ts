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
 * derived by the writer, the scope default (a deliberate human capture goes to
 * the public tree) is the core's routing rule — the command only decides that a
 * task needs a project to belong to, and refuses when there is none.
 */

import { catalogUpcasters } from '@mnema/chain';
import { chainRootForScope, type DiscoveryEnv, deriveAlias, resolveTrees } from '@mnema/core';
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
 * Creates a task in the current project's public tree. A task is project work,
 * so it needs a project: with no `.mnema/` found from the cwd, this refuses with
 * `NO_PROJECT` rather than falling through to the global tree — for a human
 * capturing a task, "run mnema init" is clearer than a task silently landing in
 * personal cross-project knowledge. The scope is public by default (a deliberate
 * human capture, no executing agent), the core's own routing rule.
 */
export function runTask(ctx: TaskContext, input: { title: string }): TaskCreated | TaskRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }

  const writer = openTreeForWriting(trees, 'public');
  const created = createTask(
    {
      writer,
      layout: { root: chainRootForScope(trees, 'public') as string },
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
