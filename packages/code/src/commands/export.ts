/**
 * `mnema export [--from --to --who --which]` — the record as a feed of audit facts,
 * one OCSF event per line, for a system that is not this one.
 *
 * THE ONLY READING THAT ANSWERS OFF THE MACHINE. Every other verb prints onto the
 * terminal of the person who holds the record; this one writes what somebody forwards to
 * a SIEM, which indexes it, keeps it, and lets a stranger search it. That is what decides
 * its shape: it carries the ENVELOPE — when, which operation, who authorized it, which
 * agent executed it, in which session, over which entity, SIGNED by which key — and no
 * payload of any kind. This line used to read *attested* by which key, the same wording
 * `audit-feed.ts` carried, and it claimed a verification this verb does not perform:
 * `signerFp` names the credential that signed the ORIGINAL fact, while whether a signature
 * covers that fact is a question for `mnema verify`, and nothing in this projection is an
 * attestation. The reason for the envelope is `mnema exposure`'s: the product refuses to
 * print a value that looks like a credential even to the person standing in front of the
 * record, and a feed carrying bodies would push exactly that off the machine and into an
 * index. `@mnema/copilot`'s `audit-feed.ts` holds the argument in full and enforces it in
 * the type it reads.
 *
 * IT SENDS NOTHING ANYWHERE. The feed goes to standard output and stops there. Whoever
 * forwards it decides where it goes, over which transport, with which credential — this
 * verb opens no socket, reads no endpoint and holds no destination.
 *
 * IT TAKES THE TREES SEPARATELY ({@link scopedEvents}), like `exposure` and for the same
 * reason: a fact in the public tree is committed and clones to every machine, and the same
 * fact in the global tree is on one disk. Each line names the tree it came from, so a
 * consumer can still tell those apart — which a merge is exactly what would lose.
 *
 * Read-only in the strict sense: it reads the present trees' tails and folds them with a
 * pure derivation. No cache is rebuilt to disk, no writer is opened, no key is minted, and
 * nothing is appended to say the export happened. It needs no `--actor` — what a fact
 * records is a property of the record, not of who asks for it. With no project it refuses
 * `NO_PROJECT`, like every other intelligence read.
 *
 * THE ONE THING IT MAY OPEN is the projection caches, and only when it has to: a `--who`
 * written as a prefix has to resolve against the identities the record knows, exactly as
 * `accountability`'s does. {@link resolveAnchorInRecord} is what pays that cost only for
 * the caller who asked for the convenience — a `--who` given whole, and every invocation
 * with no `--who` at all, opens nothing.
 */

import { catalogUpcasters } from '@mnema/chain';
import { type AuditEvent, auditFeed } from '@mnema/copilot';
import { type AuthorshipFilter, type DiscoveryEnv, resolveTrees, type Scope } from '@mnema/core';
import { resolveAnchorInRecord } from '../anchors.js';
import { recordTrees, scopedEventsOf } from '../intelligence-source.js';
import { VERSION } from '../version.js';

/** What the export command needs — injected so it is testable. */
export interface ExportContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/**
 * Who the feed says produced it.
 *
 * The record holds no such field and never will — it is a fact about the BUILD that read
 * the record, not about the record — so it is stamped here, from the one version constant
 * every surface of this product reports.
 */
const PRODUCER = { product: 'mnema', vendor: 'mnema', version: VERSION } as const;

/** The feed: one audit event per fact in scope, tree by tree. */
export interface ExportDone {
  readonly ok: true;
  /** The events themselves — the faithful objects a line is written from. */
  readonly events: readonly AuditEvent[];
  /**
   * WHICH TREES THE FEED COVERS, so a filtered one can be told from a complete one.
   *
   * NDJSON has no header and no line declares the set: every line names the tree it
   * came FROM (`metadata.log_name`), which says where a fact was, and says nothing
   * about where the reader was not allowed to look. So "no global fact exists" and
   * "the global tree was left out" arrive identical, and the surface is the only
   * place that can tell them apart. It is a fact about THIS invocation and varies with
   * it, which is why it is a field here and a line the verb writes rather than prose
   * in a help text.
   */
  readonly trees: readonly Scope[];
}

/** The read was refused — no project to export, or a `--who` that names no identity. */
export type ExportRefused =
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * The audit feed over every present tree, narrowed by the optional filter. With no filter
 * it is the whole record. An empty record — or filters that exclude everything — is an
 * empty feed, never an error: nothing to forward is a legitimate answer.
 *
 * The filter is `accountability`'s, resolved the same way: a `--who` typed as a prefix is
 * resolved against the identities the record knows before it narrows anything, because a
 * prefix left unresolved would filter on a `who` that matches nothing and come back as an
 * empty feed — the one answer that looks like an answer and is not.
 */
export function runExport(
  ctx: ExportContext,
  input: AuthorshipFilter & { readonly global?: boolean } = {},
): ExportDone | ExportRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  const { global: alsoGlobal, ...asked } = input;
  let filter: AuthorshipFilter = asked;
  if (asked.who !== undefined) {
    const who = resolveAnchorInRecord(trees, asked.who);
    if (!who.ok) {
      return { ok: false, reason: 'REFUSED', code: who.code, message: who.message };
    }
    filter = { ...asked, who: who.anchor };
  }
  // THE TREE LOCK. `this project's record` is the committed tree and the private one —
  // exactly what it means for `verify`, and for the same reason: the machine-global tree
  // belongs to no project and is present in every one. Off by default here matters more
  // than anywhere else, because this is the only read that LEAVES the machine: run inside
  // one project it used to carry the id, the instant and the author of a fact written in
  // another, so whoever forwarded the feed to a company's SIEM sent along what they had
  // written at home.
  //
  // ADDITIVE, and that is what makes the worst shape unrepresentable. A selector that
  // could ask for the global tree ALONE would fabricate a broken session in the feed: a
  // run opens in the public tree and pins facts written in the global one, so a
  // global-only cut shows lines correlated to a session that never opens. `--global` can
  // only ever ADD, so the public tree is in every feed this verb emits.
  const covered = recordTrees(trees, undefined).filter(
    (tree) => tree.scope !== 'global' || alsoGlobal === true,
  );
  return {
    ok: true,
    trees: covered.map((tree) => tree.scope),
    events: auditFeed(scopedEventsOf(covered, catalogUpcasters()), PRODUCER, filter),
  };
}
