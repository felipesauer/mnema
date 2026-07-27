/**
 * `mnema memory "<content>"` — capture a memory.
 *
 * The first of the four knowledge verbs, and the simplest. A memory is a
 * point-in-time FACT, not a workflow entity: there is no gate, no state, no
 * `move`. So the adapter is a leaner sibling of the birth mold — resolve which
 * tree the write belongs to, open its writer, call ONE core operation, report
 * what it returned — with no transition to follow and nothing to judge.
 *
 * The content is a POSITIONAL argument (`mnema memory "<content>"`). This is
 * quick capture — jrnl / todo.txt / taskwarrior — where the content IS the
 * command and competes with no label, so it needs no flag. (A skill puts its
 * body behind `--body` because a `name` positional competes with it; a memory
 * has no such competitor, and the asymmetry is deliberate.)
 *
 * The birth scope is a per-action choice, exactly as for a task/decision/skill:
 * an explicit `scope` wins; when omitted, the routing rule's default stands
 * (public, a deliberate human capture). A human capture carries no `which` — that
 * is what the scope resolver reads to keep a deliberate capture public rather than
 * defaulting it private the way an agent's would. An agent operating the CLI
 * DECLARES itself (`which`), and then both halves follow: the capture defaults
 * private, and the fact names the agent that made it.
 */

import { catalogUpcasters } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  resolveScope,
  resolveTrees,
  type Scope,
} from '@mnema/core';
import { captureMemory, openTreeForWriting } from '@mnema/core/write';

/** What the memory command needs — injected so it is testable. */
export interface MemoryContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** A memory was captured. */
export interface MemoryCaptured {
  readonly ok: true;
  /** The minted memory id (the event subject). */
  readonly id: string;
}

/** The capture was refused. */
export type MemoryRefused =
  /** There is no project here — a project-scoped memory needs one. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** The core operation refused (e.g. the authority invariant). */
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * Captures a memory, routing its birth to the resolved scope. The scope rule is
 * identical to a task's: an explicit `scope` wins, else the routing default
 * (public) — `resolveScope` is the single source of that rule. A PROJECT scope
 * (public/private) needs a project; with no `.mnema/` found from the cwd this
 * refuses `NO_PROJECT` rather than falling through. The GLOBAL scope needs none,
 * so `--scope global` works anywhere; the guard is on the RESOLVED scope, not the
 * flag.
 *
 * A declared `which` (an agent operating the CLI) shifts the omitted default to
 * private and is recorded on the event; an explicit `scope` still wins over it.
 */
export function runMemory(
  ctx: MemoryContext,
  input: { content: string; scope?: Scope; which?: string; run?: string },
): MemoryCaptured | MemoryRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const scope = resolveScope({ which: input.which }, input.scope);
  // A project scope needs a project; global does not. Guard the resolved scope,
  // not the flag, so an omitted flag (default public) outside a project refuses
  // just as an explicit `--scope public` would.
  if (scope !== 'global' && trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }

  const writer = openTreeForWriting(trees, scope);
  const captured = captureMemory(
    {
      writer,
      layout: { root: chainRootForScope(trees, scope) as string },
      upcasters: catalogUpcasters(),
    },
    {
      content: input.content,
      ...(input.which !== undefined ? { which: input.which } : {}),
      ...(input.run !== undefined ? { run: input.run } : {}),
    },
  );
  if (!captured.ok) {
    return { ok: false, reason: 'REFUSED', code: captured.code, message: captured.message };
  }

  // Checkpoint so the new memory is signature-covered at once — the tree stays
  // fully signed after every command, the same posture init leaves it in.
  writer.checkpoint();

  return { ok: true, id: captured.id };
}
