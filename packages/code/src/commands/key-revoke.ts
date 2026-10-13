/**
 * `mnema key revoke <fingerprint> --reason <text>` — retire a key from this
 * identity, from this point forward.
 *
 * The third roster verb, and the one that answers a key going missing or leaking:
 * events the key signed while it was a member stay valid (a revocation is
 * prospective — past work does not become unattributable because a key was rotated
 * out), and anything it signs from here on fails verification — which is why a checkout of this
 * machine that recorded the identity refuses to sign as it with that key from then on (the
 * core's `ensureFounded`), and why the revocation of this machine's own key says so.
 *
 * Scope is the project's PUBLIC tree, and only it, for the reason an enrollment is:
 * the retirement has to be where the other machines and an anonymous verifier read
 * it. A revocation recorded in a tree only this machine can see would retire
 * nothing anyone else can tell.
 *
 * A thin adapter. Which keys the identity has, whether this one is among them, and
 * whether it is the last — the core's judgement, worded by the core. It hands the core a
 * DEFERRED write rather than an open writer: opening one touches the tree even when nothing
 * is appended — an installation id, and until a tail came to be born at its first append,
 * the key's public half and an empty tail as well — so the core decides first and opens it
 * only to write, and a refused revocation leaves the tree as it found it.
 */

import {
  holdsRecord,
  KEY_PASSPHRASE_VARIABLE,
  KeyIsProtectedError,
  privateKeyPath,
} from '@mnema/chain';
import {
  type DiscoveryEnv,
  IdentityUnavailableError,
  PrivateTreeVisibleError,
  reachableTrees,
  resolveTrees,
  type Scope,
} from '@mnema/core';
import {
  deferredWrite,
  type RetireAgentOk,
  retireAgentKey,
  retireChecker,
  revokeMember,
} from '@mnema/core/write';
import { oneLine } from '../one-line.js';
import { forwardReplacement, type Replacement } from '../recorded-content.js';

/** What the revocation needs — injected so it is testable. */
export interface KeyRevokeContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`), for the key root and the tree paths. */
  readonly env: DiscoveryEnv;
}

/** The key was retired from this machine's identity. */
export interface KeyRevoked extends Replacement {
  readonly ok: true;
  readonly fingerprint: string;
  /** The identity it was retired from. */
  readonly anchor: string;
  /** True when the retired key is the one this machine signs with. */
  readonly self: boolean;
  /** How many keys the identity has left. */
  readonly remaining: number;
  /** The project tree that recorded it. */
  readonly root: string;
  /**
   * When the retired key is this machine's own, the file its private half is kept in — the one
   * `mnema key restore` takes to point this checkout at the identity the key is still in.
   */
  readonly keyFile?: string;
  /** When the retired key is this machine's own, the one identity the record still proves it in. */
  readonly stillMemberOf?: string;
}

/** The revocation was refused; nothing was written. */
export type KeyRevokeRefused =
  /** There is no project here — a retirement is a fact in a committed record. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** The core refused: an unknown key, the last key, or no right to revoke. */
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * What a retirement says when the key that signs it is protected and no passphrase is to hand.
 * The chain's own sentence ends in the advice for a host that signs for an agent — a key of its own
 * — which has nothing to do with a person retiring a key: the retirement is signed by THEIR key.
 */
function protectedKeyMessage(error: KeyIsProtectedError): string {
  return `the private key at ${error.path} is protected by a passphrase and ${KEY_PASSPHRASE_VARIABLE} is not set, and a retirement is signed with it: run the command in a terminal, which asks for the passphrase, or set ${KEY_PASSPHRASE_VARIABLE} for it`;
}

/** The refusal a protected key earns from a verb that signs, in words that fit the verb. */
function refusedWhereProtected<T>(body: () => T): T | KeyRevokeRefused {
  try {
    return body();
  } catch (error) {
    if (!(error instanceof KeyIsProtectedError)) throw error;
    return { ok: false, reason: 'REFUSED', code: error.code, message: protectedKeyMessage(error) };
  }
}

/**
 * Retires `fingerprint` from the identity this machine serves in the current
 * project. With no project found from the cwd it refuses `NO_PROJECT`.
 */
export function runKeyRevoke(
  ctx: KeyRevokeContext,
  input: { fingerprint: string; reason: string },
): KeyRevoked | KeyRevokeRefused {
  return refusedWhereProtected(() => revokeOwnKey(ctx, input));
}

function revokeOwnKey(
  ctx: KeyRevokeContext,
  input: { fingerprint: string; reason: string },
): KeyRevoked | KeyRevokeRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }

  const write = deferredWrite(trees, 'public');
  const revoked = revokeMember(write, { fingerprint: input.fingerprint, reason: input.reason });
  if (!revoked.ok) {
    return { ok: false, reason: 'REFUSED', code: revoked.code, message: revoked.message };
  }

  // The revocation signs its own checkpoint (the verifier only honors a covered one), so
  // this covers whatever else the run appended and is otherwise a no-op.
  write.checkpoint();

  return {
    ok: true,
    fingerprint: revoked.fingerprint,
    anchor: revoked.anchor,
    self: revoked.self,
    remaining: revoked.remaining,
    root: trees.projectPublic,
    ...(revoked.self
      ? { keyFile: privateKeyPath({ root: trees.keyRoot }, revoked.fingerprint) }
      : {}),
    ...(revoked.stillMemberOf !== undefined ? { stillMemberOf: revoked.stillMemberOf } : {}),
    ...forwardReplacement(revoked),
  };
}

/** The checker key signs nothing from now on. */
export interface CheckerRetired extends Replacement {
  readonly ok: true;
  readonly fingerprint: string;
  /** The anchor its results were signed under — its own. */
  readonly checker: string;
  /** The identity that retired it. */
  readonly retiredBy: string;
  /** True when the record already retired it, so nothing was appended. */
  readonly alreadyRetired: boolean;
  /** The project tree that recorded it. */
  readonly root: string;
}

/**
 * Retires a CHECKER key — a key that signs check results only — signed by the identity this
 * machine serves in the project's public tree, where the runner and every verifier read it.
 */
export function runCheckerRetire(
  ctx: KeyRevokeContext,
  input: { fingerprint: string; reason: string },
): CheckerRetired | KeyRevokeRefused {
  return refusedWhereProtected(() => retireCheckerKey(ctx, input));
}

function retireCheckerKey(
  ctx: KeyRevokeContext,
  input: { fingerprint: string; reason: string },
): CheckerRetired | KeyRevokeRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  const write = deferredWrite(trees, 'public');
  const retired = retireChecker(write, { fingerprint: input.fingerprint, reason: input.reason });
  if (!retired.ok) {
    return { ok: false, reason: 'REFUSED', code: retired.code, message: retired.message };
  }
  // The retirement signs its own checkpoint (the reader honours only a covered one); this
  // covers a founding it may have appended alongside, and is a no-op otherwise.
  write.checkpoint();
  return {
    ok: true,
    fingerprint: retired.fingerprint,
    checker: retired.checker,
    retiredBy: retired.retiredBy,
    alreadyRetired: retired.alreadyRetired,
    root: trees.projectPublic,
    ...forwardReplacement(retired),
  };
}

/** What `key revoke --agent` did in one tree. */
export interface AgentTreeRetired {
  readonly scope: Scope;
  readonly root: string;
  /**
   * `retired`: the retirement was written. `skipped`: the tree does not count the key as an agent
   * (it never enrolled it, or retired it already). `refused`: attempted and refused.
   */
  readonly state: 'retired' | 'skipped' | 'refused';
  readonly why?: string;
  readonly code?: string;
}

/** The agent key signs nothing from now on, in every tree that enrolled it. */
export interface AgentRetired extends Replacement {
  readonly ok: true;
  readonly fingerprint: string;
  /** The name it held. */
  readonly name: string;
  /** The identity that retired it, in the first tree that did. */
  readonly anchor: string;
  /** The first tree that recorded it: the project's committed tree inside a project. */
  readonly root: string;
  /** Each tree that holds a record, in the order they were taken: committed, private, global. */
  readonly trees: readonly AgentTreeRetired[];
}

/**
 * Retires an AGENT key — a key that signs for this identity under a name — signed by this
 * machine's key in every tree this process reaches that enrolled it: the project's committed tree,
 * where every other machine and an anonymous verifier read it, and the private and the global
 * tree, where the agent signs too. A key retired in one tree is retired for this machine's
 * writes in all of them, but a tree that is not told keeps counting it as an agent for whoever
 * reads that tree's record, so the retirement is written in each. The agent's key is not asked,
 * and its file is not touched: what retires it is the record.
 *
 * `UNKNOWN_AGENT` is said only when no tree counts the key as an agent. A refusal in the first
 * tree tried stops the verb with nothing written; a later one leaves what was written and is said,
 * per tree, in the result.
 */
export function runAgentRetire(
  ctx: KeyRevokeContext,
  input: { fingerprint: string; reason: string },
): AgentRetired | KeyRevokeRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const results: AgentTreeRetired[] = [];
  let first: (RetireAgentOk & { readonly root: string }) | undefined;
  let unknown: { readonly code: string; readonly message: string } | undefined;
  for (const tree of reachableTrees(trees)) {
    const where = { scope: tree.scope, root: tree.chainRoot };
    if (!holdsRecord({ root: tree.chainRoot })) continue;
    const write = deferredWrite(trees, tree.scope);
    let retired: ReturnType<typeof retireAgentKey>;
    try {
      retired = retireAgentKey(write, { fingerprint: input.fingerprint, reason: input.reason });
    } catch (error) {
      const nothingWritten = first === undefined && results.every((one) => one.state === 'skipped');
      const known =
        error instanceof PrivateTreeVisibleError || error instanceof IdentityUnavailableError;
      // Any other error is a system's (a permission, a full disk): thrown as it is when nothing was
      // written yet, and, once another tree took the retirement, that tree's refusal in the
      // system's own code, so the verb says what was written.
      const fits = error instanceof KeyIsProtectedError;
      if (!known && !fits && nothingWritten) throw error;
      const code = !known
        ? String((error as { code?: unknown }).code ?? 'REFUSED')
        : error instanceof PrivateTreeVisibleError
          ? 'PRIVATE_TREE_VISIBLE'
          : error.code;
      const message = fits
        ? protectedKeyMessage(error)
        : oneLine(error instanceof Error ? error.message : String(error));
      if (nothingWritten) return { ok: false, reason: 'REFUSED', code, message };
      results.push({ ...where, state: 'refused', code, why: message });
      continue;
    }
    if (!retired.ok) {
      if (retired.code === 'UNKNOWN_AGENT') {
        unknown ??= { code: retired.code, message: retired.message };
        results.push({
          ...where,
          state: 'skipped',
          why: 'the record of this tree does not count the key as an agent (never enrolled here, or retired already)',
        });
        continue;
      }
      if (first === undefined && results.every((one) => one.state === 'skipped')) {
        return { ok: false, reason: 'REFUSED', code: retired.code, message: retired.message };
      }
      results.push({ ...where, state: 'refused', code: retired.code, why: retired.message });
      continue;
    }
    // The retirement signs its own checkpoint (a reader honours only a covered one); this covers a
    // founding it may have appended alongside, and is a no-op otherwise.
    write.checkpoint();
    first ??= { ...retired, root: tree.chainRoot };
    results.push({ ...where, state: 'retired' });
  }
  if (first === undefined) {
    if (unknown !== undefined) {
      return { ok: false, reason: 'REFUSED', code: unknown.code, message: unknown.message };
    }
    return { ok: false, reason: 'NO_PROJECT' };
  }
  return {
    ok: true,
    fingerprint: first.fingerprint,
    name: first.name,
    anchor: first.anchor,
    root: first.root,
    trees: results,
    ...forwardReplacement(first),
  };
}
