/**
 * `mnema key enroll <request>` — vouch for a key so it joins this identity.
 *
 * The second step of putting two machines on one identity, and the one that has to
 * run on a machine that is ALREADY a member: membership is granted by a member's
 * signature, so there is no way for a joining machine to admit itself.
 *
 * Scope is the project's PUBLIC tree, and only it. An enrollment is a per-tree
 * fact, and the tree that matters is the committed one — it is what the other
 * machine will read to learn it was accepted, and what an anonymous verifier
 * checks the vouch against. The private and global trees are local to one machine,
 * so a second machine could never see an enrollment recorded there.
 *
 * A thin adapter: resolve the project, hand ONE core operation a deferred write of the
 * tree, report what came back. Whether the request proves consent, whether this machine
 * may vouch, whether the key is already a member — all of it is the core's judgement and
 * reaches the person as the core worded it.
 *
 * DEFERRED, and not an open writer, because opening one touches the tree before anything
 * is appended — an installation id, today. Measured on the binary, a refused enrollment
 * used to leave the project with an untracked `keys/<fp>.pub` and an empty tail of the key
 * that asked — which is the key a person following the words of a split has at hand; those
 * two are born at a writer's first append now, and the id is still a file. The core decides
 * first and opens the writer only to write, so a refusal leaves the tree as it found it.
 */

import { catalogUpcasters, holdsRecord, localKeyFingerprint } from '@mnema/chain';
import {
  AGENT_NAME,
  agentKeyRoot,
  agentNameRefusal,
  agentsOf,
  type DiscoveryEnv,
  IdentityUnavailableError,
  PrivateTreeVisibleError,
  reachableTrees,
  resolveTrees,
  type Scope,
  treeWords,
} from '@mnema/core';
import {
  agentKeyConflictIn,
  authorizingAnchor,
  type DeferredWrite,
  decodeAgentRequest,
  deferredWrite,
  enrollAgentFromRequest,
  enrollChecker,
  enrollFromRequest,
  requestAgentEnrollment,
} from '@mnema/core/write';
import { oneLine } from '../one-line.js';
import { personsKeyInTheClear } from '../the-persons-key-in-the-clear.js';

/** What the enrollment needs — injected so it is testable. */
export interface KeyEnrollContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`), for the key root and the tree paths. */
  readonly env: DiscoveryEnv;
}

/** The key belongs to this machine's identity. */
export interface KeyEnrolled {
  readonly ok: true;
  /** The joining key's fingerprint, derived from the key the request carried. */
  readonly fingerprint: string;
  /** The identity it now belongs to — this machine's own. */
  readonly anchor: string;
  /** True when the record already proved it a member, so nothing was appended. */
  readonly alreadyMember: boolean;
  /** The project tree that recorded it. */
  readonly root: string;
}

/** The enrollment was refused; nothing was written. */
export type KeyEnrollRefused =
  /** There is no project here — an enrollment is a fact in a committed record. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** The core refused: a malformed request, one made for another identity, no right to vouch. */
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/** The key may now sign check results, under its own anchor. */
export interface CheckerEnrolled {
  readonly ok: true;
  /** The checker key's fingerprint. */
  readonly fingerprint: string;
  /** The anchor it signs results under — its own. */
  readonly checker: string;
  /** The identity that vouched for it — this machine's. */
  readonly vouchedBy: string;
  /** True when the record already enrolled it, so nothing was appended. */
  readonly alreadyChecker: boolean;
  /** The project tree that recorded it. */
  readonly root: string;
}

/**
 * Enrolls the key a CHECKER request carries — a key that will sign check results and nothing
 * else — vouched for by this machine's identity, in the project's public tree.
 */
export function runCheckerEnroll(
  ctx: KeyEnrollContext,
  input: { request: string },
): CheckerEnrolled | KeyEnrollRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  const write = deferredWrite(trees, 'public');
  const enrolled = enrollChecker(write, { request: input.request });
  if (!enrolled.ok) {
    return { ok: false, reason: 'REFUSED', code: enrolled.code, message: enrolled.message };
  }
  // The enrolment signs its own checkpoint; this covers a founding it may have appended
  // alongside, and is a no-op otherwise.
  write.checkpoint();
  return { ...enrolled, root: trees.projectPublic };
}

/**
 * Enrolls the key a request carries into the identity this machine serves in the
 * current project. With no project found from the cwd it refuses `NO_PROJECT`: a
 * vouch is a fact, and a fact needs the record the other machine will read.
 */
export function runKeyEnroll(
  ctx: KeyEnrollContext,
  input: { request: string },
): KeyEnrolled | KeyEnrollRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }

  const write = deferredWrite(trees, 'public');
  const enrolled = enrollFromRequest(write, { request: input.request });
  if (!enrolled.ok) {
    return { ok: false, reason: 'REFUSED', code: enrolled.code, message: enrolled.message };
  }

  // The enrollment signs its own checkpoint, so this only covers the founding a first-ever
  // write may have appended alongside it — and is a no-op otherwise, including when the
  // writer was never opened (a key the record already proved a member).
  write.checkpoint();

  return {
    ok: true,
    fingerprint: enrolled.fingerprint,
    anchor: enrolled.anchor,
    alreadyMember: enrolled.alreadyMember,
    root: trees.projectPublic,
  };
}

/** What `key enroll --agent` did in one tree. */
export interface AgentTreeResult {
  readonly scope: Scope;
  /** The tree's root. */
  readonly root: string;
  /**
   * `enrolled`: the vouch was written. `already`: the record had it under this name, nothing
   * written. `skipped`: not attempted, and `why` says what makes that right. `refused`: attempted
   * and refused, with the `code` and the words of the refusal in `why`.
   */
  readonly state: 'enrolled' | 'already' | 'skipped' | 'refused';
  readonly why?: string;
  readonly code?: string;
}

/** The key may now sign as an agent of this machine's identity, in the trees listed. */
export interface AgentEnrolled {
  readonly ok: true;
  /** The agent key's fingerprint. */
  readonly fingerprint: string;
  /** The name it was enrolled under: the `which` of everything it signs. */
  readonly name: string;
  /** The identity it speaks for in the first tree that took it — this machine's own. */
  readonly anchor: string;
  /** True when no tree needed a write: the record already had it, under this name. */
  readonly alreadyAgent: boolean;
  /** The first tree that took it: the project's committed tree inside a project. */
  readonly root: string;
  /** Each tree reached, in the order they were taken: committed, private, global. */
  readonly trees: readonly AgentTreeResult[];
  /** True when a tree refused: what was written stays, and the verb says so and exits 1. */
  readonly partial: boolean;
  /** The other keys the first tree that took it already counts as agents under this same name. */
  readonly alsoUnderTheName: readonly string[];
  /** True when the person's own key is unencrypted, which leaves the separation to nothing. */
  readonly personsKeyInTheClear: boolean;
}

/** The start of a line `key request --agent` prints; a name is told from it by this. */
const AGENT_REQUEST_PREFIX = 'mnema-agent-request:1:';

/** The agent an enrolment is for: what the verb was handed, and what this machine holds of it. */
interface AgentSubject {
  /** The line to hand each tree first; absent when a NAME was given and each tree gets its own. */
  readonly line?: string;
  readonly name?: string;
  /** The key root this machine keeps the agent under that name in, when the name is one. */
  readonly keyRoot?: string;
  /** Whether the key the verb is for is the one this machine holds under that name. */
  readonly local: boolean;
}

/**
 * Enrolls the key an AGENT request carries — a key that signs for this identity under a name —
 * vouched for by this machine's key, in every tree this process reaches that the key can be in:
 * the project's committed tree, where the other machines and an anonymous verifier read it, and,
 * where the key lives on THIS machine, the project's private tree and the machine's global one, so
 * what the agent writes there is signed by it too. Outside a project, the global tree alone.
 *
 * `request` is the line `key request --agent` printed, or — where the key lives on this machine —
 * the agent's NAME, from which the line is made here for each tree. The person's key signs each
 * vouch: this is the verb that asks it for its passphrase at the terminal, which is what the
 * agent's host, without one, can never do.
 *
 * ONE LINE SERVES EVERY TREE where the identity is the same in all of them: the consent covers the
 * identity, the key and the name, never a tree. In a tree whose identity is another's (a machine
 * that joined an identity writes its private and global trees under one of its own), the line does
 * not hold, and the key on this machine consents afresh for that tree's identity — which is what
 * `key request --agent <name> --anchor <that identity>` would have it do.
 *
 * A key retired anywhere this process reaches, or an agent under another name in one, is refused
 * for all and nothing is written. The committed tree is taken first, and a refusal in the first
 * tree tried stops the verb with nothing written; a refusal in a later one leaves what was written
 * and is said, per tree, in the result.
 */
export function runAgentEnroll(
  ctx: KeyEnrollContext,
  input: { request: string },
): AgentEnrolled | KeyEnrollRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const reached = reachableTrees(trees);
  const subject = subjectOf(ctx.env, input.request);
  if (subject === 'NO_AGENT_KEY') {
    return {
      ok: false,
      reason: 'REFUSED',
      code: 'NO_AGENT_KEY',
      message:
        `this machine holds no key for the agent "${oneLine(input.request)}" — ` +
        `\`mnema key request --agent ${oneLine(input.request)} --anchor <your identity>\` makes one, and ` +
        '`mnema key enroll --agent <the line it prints>` enrols it',
    };
  }

  const writes = new Map(reached.map((tree) => [tree.scope, deferredWrite(trees, tree.scope)]));
  const lineIn = (scope: Scope): string => {
    if (subject.line !== undefined) return subject.line;
    return freshLine(writes.get(scope) as DeferredWrite, subject) ?? input.request;
  };

  // A key retired anywhere this process reaches is retired in all, and a key under another name in
  // one keeps it in all: said before any tree is written.
  const first = reached[0];
  const conflict = agentKeyConflictIn(
    reached
      .filter((tree) => holdsRecord({ root: tree.chainRoot }))
      .map((tree) => ({ tree: tree.chainRoot, where: treeWords(tree.scope) })),
    { request: first === undefined ? input.request : lineIn(first.scope) },
  );
  if (conflict !== undefined) {
    return { ok: false, reason: 'REFUSED', code: conflict.code, message: conflict.message };
  }

  const results: AgentTreeResult[] = [];
  let took: { fingerprint: string; name: string; anchor: string } | undefined;
  for (const tree of reached) {
    const where = { scope: tree.scope, root: tree.chainRoot };
    if (tree.scope !== 'public' && !subject.local) {
      results.push({
        ...where,
        state: 'skipped',
        why: 'the key is not on this machine, and only a key that lives here is enrolled in a tree only this machine reads',
      });
      continue;
    }
    const write = writes.get(tree.scope) as DeferredWrite;
    const attempt = enrolIn(write, tree.scope, subject, lineIn(tree.scope));
    if (!attempt.ok) {
      // Nothing was written before the first tree tried: that refusal is the verb's.
      if (took === undefined) {
        return { ok: false, reason: 'REFUSED', code: attempt.code, message: attempt.message };
      }
      results.push({ ...where, state: 'refused', code: attempt.code, why: attempt.message });
      continue;
    }
    took ??= { fingerprint: attempt.fingerprint, name: attempt.name, anchor: attempt.anchor };
    results.push({ ...where, state: attempt.alreadyAgent ? 'already' : 'enrolled' });
  }

  if (took === undefined) {
    return {
      ok: false,
      reason: 'REFUSED',
      code: 'NOT_ON_THIS_MACHINE',
      message:
        "the key is not on this machine, and the only tree this reaches that takes a key from elsewhere is a project's committed one — run it inside the project",
    };
  }
  const root =
    results.find((one) => one.state === 'enrolled' || one.state === 'already')?.root ??
    trees.global;
  return {
    ok: true,
    fingerprint: took.fingerprint,
    name: took.name,
    anchor: took.anchor,
    alreadyAgent: results.every((one) => one.state === 'already' || one.state === 'skipped'),
    root,
    trees: results,
    partial: results.some((one) => one.state === 'refused'),
    alsoUnderTheName: otherKeysUnder(took, root),
    personsKeyInTheClear: personsKeyInTheClear(trees.keyRoot) === true,
  };
}

/**
 * The fingerprints of the OTHER keys a tree counts as agents under the name just enrolled. The
 * record allows them — a key is an agent by its fingerprint, and a person with two machines has two
 * keys under the one name the host's manifest fixes — so this is said, never refused.
 */
function otherKeysUnder(
  agent: { readonly fingerprint: string; readonly name: string; readonly anchor: string },
  tree: string,
): string[] {
  return [...agentsOf({ tree, upcasters: catalogUpcasters() }, agent.anchor)]
    .filter(([fingerprint, name]) => name === agent.name && fingerprint !== agent.fingerprint)
    .map(([fingerprint]) => fingerprint);
}

/**
 * What the verb was handed: a line, or a name. A name needs the key to be here already — it stands
 * for the line this machine would print — and says `NO_AGENT_KEY` when it is not. Anything else is
 * handed to the core as a line, which refuses what is not one.
 */
function subjectOf(env: DiscoveryEnv, request: string): AgentSubject | 'NO_AGENT_KEY' {
  if (!request.startsWith(AGENT_REQUEST_PREFIX) && AGENT_NAME.test(request)) {
    const keyRoot = agentKeyRoot(env, request);
    if (localKeyFingerprint({ root: keyRoot }) === null) return 'NO_AGENT_KEY';
    return { name: request, keyRoot, local: true };
  }
  const decoded = decodeAgentRequest(request);
  if (decoded === null || agentNameRefusal(decoded.name) !== undefined) {
    return { line: request, local: false };
  }
  const keyRoot = agentKeyRoot(env, decoded.name);
  return {
    line: request,
    name: decoded.name,
    keyRoot,
    local: localKeyFingerprint({ root: keyRoot }) === decoded.key.fingerprint,
  };
}

/** The line the agent key this machine holds makes for the identity `write`'s tree speaks for. */
function freshLine(write: DeferredWrite, subject: AgentSubject): string | undefined {
  if (subject.name === undefined || subject.keyRoot === undefined) return undefined;
  const anchor = authorizingAnchor({
    writer: write.signer,
    layout: write.layout,
    upcasters: write.upcasters,
  });
  const made = requestAgentEnrollment({ anchor, name: subject.name, keyRoot: subject.keyRoot });
  return made.ok ? made.request : undefined;
}

/**
 * One tree's vouch: the line first, and — in a tree other than the committed one, for a key that
 * lives here — the key's fresh consent to that tree's identity where the line was made for another.
 * What a tree throws (a private tree git would stage, an identity the record cannot name) is that
 * tree's refusal, in the code it carries.
 */
function enrolIn(
  write: DeferredWrite,
  scope: Scope,
  subject: AgentSubject,
  line: string,
):
  | { readonly ok: true; fingerprint: string; name: string; anchor: string; alreadyAgent: boolean }
  | { readonly ok: false; readonly code: string; readonly message: string } {
  try {
    let done = enrollAgentFromRequest(write, { request: line });
    if (!done.ok && done.code === 'UNPROVEN_REQUEST' && scope !== 'public' && subject.local) {
      const again = freshLine(write, subject);
      if (again !== undefined && again !== line) {
        done = enrollAgentFromRequest(write, { request: again });
      }
    }
    // The enrolment signs its own checkpoint; this covers a founding it may have appended
    // alongside, and is a no-op otherwise.
    if (done.ok) write.checkpoint();
    return done;
  } catch (error) {
    if (error instanceof PrivateTreeVisibleError) {
      return { ok: false, code: 'PRIVATE_TREE_VISIBLE', message: error.message };
    }
    if (error instanceof IdentityUnavailableError) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }
}
