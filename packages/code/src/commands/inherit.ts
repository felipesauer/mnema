/**
 * `mnema inherit` — point this project at another repository's record, at one commit.
 *
 * Two acts, both explicit: `set` names the where the first time, `update` moves the pointer to
 * a newer commit. Neither moves anything by itself: each prints what the project would inherit
 * (for `update`, what changes between the commit it has and the one it would have) and writes
 * the pointer only with `--write`, the way `decision import` writes its plan.
 *
 * A record that does not verify at the commit is REFUSED, with or without `--write`: the
 * pointer is how a project says "I trust this where at this commit", and a commit whose record
 * does not verify is not one the project can be shown the decisions of. Inheriting is trusting
 * the where at that commit; nothing here makes the where's decisions the project's own, and
 * nothing is written to the project's chain.
 */

import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import {
  commitsBetween,
  type InheritedRule,
  type Pointer,
  readInherited,
  readPointer,
  resolveAtOrigin,
  writePointer,
} from '../inherited-record.js';

/** Where the verb runs. */
export interface InheritContext {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
}

/** Why an inherit verb did nothing. */
export interface InheritRefused {
  readonly ok: false;
  readonly reason:
    | 'NO_PROJECT'
    | 'ALREADY_INHERITING'
    | 'NOT_INHERITING'
    | 'POINTER_INVALID'
    | 'UNREACHABLE'
    | 'NO_SUCH_REVISION'
    | 'NOT_VERIFIED';
  readonly detail?: string;
}

/** What the pointer would be, what that changes, and whether it was written. */
export interface InheritPlan {
  readonly ok: true;
  /** The pointer before, absent the first time. */
  readonly from?: Pointer;
  readonly to: Pointer;
  /** Commits between the two, when this machine holds both. */
  readonly commits?: number;
  /** Whether the commit it leaves could be read here, to say what changed against. */
  readonly previous: 'none' | 'read' | 'unread';
  readonly added: readonly InheritedRule[];
  readonly removed: readonly InheritedRule[];
  readonly written: boolean;
}

type Planned = InheritPlan | InheritRefused;

function plan(
  ctx: InheritContext,
  where: string,
  rev: string | undefined,
  from: Pointer | undefined,
  write: boolean,
): Planned {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const resolved = resolveAtOrigin(trees, where, rev);
  if (!resolved.ok) return { ok: false, reason: resolved.reason, detail: resolved.detail };
  const to: Pointer = { where, commit: resolved.commit };
  const reading = readInherited(trees, to, false);
  if (reading.state !== 'read') {
    return {
      ok: false,
      reason: 'NOT_VERIFIED',
      detail: reading.why,
    };
  }
  const before = from === undefined ? undefined : readInherited(trees, from, false);
  const old = before?.state === 'read' ? before.decisions : [];
  const ids = new Set(old.map((d) => d.id));
  const now = new Set(reading.decisions.map((d) => d.id));
  const added = reading.decisions.filter((d) => !ids.has(d.id));
  const removed = old.filter((d) => !now.has(d.id));
  const commits =
    from === undefined ? undefined : commitsBetween(trees, where, from.commit, to.commit);
  const changed = from?.commit !== to.commit;
  if (write && changed) writePointer(trees.projectPublic as string, to);
  return {
    ok: true,
    ...(from !== undefined ? { from } : {}),
    to,
    ...(commits !== undefined ? { commits } : {}),
    previous: from === undefined ? 'none' : before?.state === 'read' ? 'read' : 'unread',
    added,
    removed,
    written: write && changed,
  };
}

/** Points the project at an where, at `at` (the where's HEAD when omitted). */
export function runInheritSet(
  ctx: InheritContext,
  args: { readonly where: string; readonly at?: string; readonly write?: boolean },
): Planned {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return { ok: false, reason: 'NO_PROJECT' };
  if (args.where.length === 0 || args.where.startsWith('-')) {
    return { ok: false, reason: 'UNREACHABLE', detail: `${args.where} is not an origin` };
  }
  if (readPointer(trees.projectPublic).state !== 'absent') {
    return { ok: false, reason: 'ALREADY_INHERITING' };
  }
  return plan(ctx, args.where, args.at, undefined, args.write === true);
}

/** Moves the pointer to `to` (the where's HEAD when omitted), showing what changes first. */
export function runInheritUpdate(
  ctx: InheritContext,
  args: { readonly to?: string; readonly write?: boolean },
): Planned {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return { ok: false, reason: 'NO_PROJECT' };
  const found = readPointer(trees.projectPublic);
  if (found.state === 'absent') return { ok: false, reason: 'NOT_INHERITING' };
  if (found.state === 'invalid') {
    return { ok: false, reason: 'POINTER_INVALID', detail: found.why };
  }
  return plan(ctx, found.pointer.where, args.to, found.pointer, args.write === true);
}
