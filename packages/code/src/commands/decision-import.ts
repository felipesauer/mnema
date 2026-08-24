/**
 * `mnema decision import <dir>` — propose the decisions this repository already
 * wrote down.
 *
 * THE GAP IT CLOSES. Reading the record is discoverable and writing to it is not:
 * an agent finds the read tools on the server and uses them unasked, while a write
 * happens only when somebody remembers to write. So a real project's record starts
 * empty and stays empty — while the same project's decisions are already written,
 * in markdown, committed, and being read. This verb reads THOSE and proposes them.
 * It is worth saying which measurement says the knowledge is already there: the
 * `prosa` arm of the P1 protocol is *"the same decision, verbatim, in a
 * `DECISIONS.md` committed at the repository root"*, and in the second round it
 * scored 62.5% against the floor's 25%. Decisions in markdown in a repository are
 * not a hypothesis — they are the practice, and it works. What was missing is them
 * entering the record with an id, a state and a proof, without anyone retyping.
 *
 * WHAT COMES OUT IS A PROPOSAL, AND ONLY A PROPOSAL. Every decision this product
 * records is born `proposed` — there is no path in it that creates an accepted one
 * — and this verb neither adds one nor wants one. A decision the file itself calls
 * `Accepted` is proposed all the same: the person who accepts it here does so with
 * a note, through the move that already exists, and their acceptance is a fact of
 * THIS record rather than an assertion inherited from a file. The file's own status
 * is reported, never applied.
 *
 * IT WRITES NOTHING UNTIL IT IS TOLD TO. The default prints the plan; `--write`
 * records it. That asymmetry is the point rather than a convenience: a verb that
 * read and wrote in one breath would let one accidental invocation fill a record
 * with proposals nobody asked for, and a record full of unasked proposals is worse
 * than not having this verb at all. The guard is one branch, and
 * `the-plan-writes-nothing.test.ts` is what holds it.
 *
 * IT CALLS NO MODEL. The whole read is deterministic — headings and labels — and
 * the product it belongs to has never made a network call. Extraction by model is
 * this project's second stated refusal (a fact summarized by a model entering as a
 * recorded entry), and even stopping at `proposed` it would be the first model call
 * the product ever made. `the-product-calls-no-model.test.ts` fails if anybody adds
 * one.
 *
 * THE PROVENANCE IS A FACT OF THE RECORD, not a sentence inside the rationale. Each
 * proposal is linked to the file it came from, under `derived-from`, which is one of
 * the relation labels the catalog already recommends — so this needed no new field,
 * no version and no upcaster, and none of the published canonical vectors move. That
 * link is ALSO what makes a second run idempotent: a file already on the far end of
 * a `derived-from` edge is a file already imported, whatever its title says now.
 *
 * ONE WRITER, ONE CHECKPOINT. The whole directory is written through a single open
 * writer and signed once at the end, rather than N times through N invocations. That
 * is the cost argument for the verb existing at all, and the report says the number.
 */

import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { catalogUpcasters } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  resolveScope,
  resolveTrees,
  type ScannedDecision,
  type ScanRefusal,
  type Scope,
  type SecretClass,
  scanAdrDirectory,
} from '@mnema/core';
import { linkKnowledge, openTreeForWriting, recordDecision } from '@mnema/core/write';
import { withScopedCaches } from '../tree-sources.js';

/**
 * The relation a proposal asserts about the file it was read from.
 *
 * `derived-from` is already in the catalog's recommended set, so this cost the
 * record no new label. Its target here is a PATH and not an id — the same shape
 * `governs` and `asks-for-a-person` use, and legal for the same reason the catalog
 * gives: `target` is whatever the caller sent, resolved by whoever reads it. What
 * separates this from those two is not the shape but the power: they ADDRESS a part
 * of the tree (compared by segments, covering whatever is under it), while this one
 * points at the single file a fact came out of. That distinction is why
 * `ADDRESS_RELATIONS` does not gain a member here, and it is written down where that
 * constant is declared.
 */
export const DERIVED_FROM_RELATION = 'derived-from';

/** What the import needs — injected so it is testable. */
export interface DecisionImportContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** One decision that would be — or was — proposed, and where it came from. */
export interface ImportedProposal {
  /** The file it was read from, relative to the project root: the provenance. */
  readonly path: string;
  /** The title as it will be recorded. */
  readonly title: string;
  /** Whether the document named what it turned down. */
  readonly alternatives: boolean;
  /** The status the FILE states, verbatim; absent when it states none. */
  readonly status?: string;
  /** The minted id — present only once it was actually written. */
  readonly id?: string;
  /** The frozen `ADR-<n>` label — present only once it was actually written. */
  readonly adr?: string;
  /**
   * What the content door replaced on the way in. The triage refuses a file that
   * holds one, so this should always be absent; it is carried because the door is
   * inside the write and its report is not this verb's to swallow.
   */
  readonly replaced?: readonly SecretClass[];
}

/** One file whose decision the record already holds. */
export interface AlreadyImported {
  /** The file, relative to the project root. */
  readonly path: string;
  /** The decision already derived from it. */
  readonly decision: string;
}

/** The import ran. */
export interface ImportDone {
  readonly ok: true;
  /** Whether anything was written. False on a plan — which is the default. */
  readonly wrote: boolean;
  /** The directory that was read, relative to the project root. */
  readonly from: string;
  /** The decisions proposed (or, on a plan, that would be). */
  readonly proposals: readonly ImportedProposal[];
  /** The files whose decision the record already holds, skipped. */
  readonly already: readonly AlreadyImported[];
  /** The files that produced nothing, each with its reason. */
  readonly refused: readonly ScanRefusal[];
  /** The scope the proposals were (or would be) born in. */
  readonly scope: Scope;
  /** A gate refusal that stopped the write partway; absent when nothing stopped it. */
  readonly stopped?: { readonly path: string; readonly code: string; readonly message: string };
}

/** The import was refused before it read anything. */
export type ImportRefused =
  /** There is no project here — decisions are project work and need one. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /**
   * The directory is not inside the project. The provenance a proposal records has
   * to be citable by every clone, and an absolute path on one machine is citable by
   * none of them — so a directory outside the project is refused rather than
   * recorded as a path nobody else can open.
   */
  | { readonly ok: false; readonly reason: 'OUTSIDE_PROJECT'; readonly from: string };

/** The project-relative POSIX path of `target`, or undefined when it is outside `root`. */
function inside(root: string, target: string): string | undefined {
  const rel = relative(root, target);
  if (rel === '') return '.';
  if (rel.startsWith('..') || isAbsolute(rel)) return undefined;
  return rel.split(sep).join('/');
}

/**
 * The files the record already holds a decision for: every `derived-from` edge in
 * every visible tree, keyed by its target.
 *
 * It reads EVERY tree and not only the one being written to. A proposal that landed
 * in the private tree on an earlier run is still a decision derived from that file,
 * and re-proposing it into the public one because the public tree cannot see it
 * would duplicate exactly what this is here to prevent.
 */
function alreadyDerived(ctx: DecisionImportContext): ReadonlyMap<string, string> {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  return withScopedCaches(trees, (sources) => {
    const byTarget = new Map<string, string>();
    for (const source of sources) {
      for (const edge of source.cache.linksByRelation(DERIVED_FROM_RELATION)) {
        if (!byTarget.has(edge.target)) byTarget.set(edge.target, edge.subject);
      }
    }
    return byTarget;
  });
}

/** The plan a run would carry out: what is new, and what the record already has. */
function plan(
  scanned: readonly ScannedDecision[],
  root: string,
  derived: ReadonlyMap<string, string>,
): { readonly fresh: readonly ScannedDecision[]; readonly already: readonly AlreadyImported[] } {
  const fresh: ScannedDecision[] = [];
  const already: AlreadyImported[] = [];
  for (const document of scanned) {
    const path = inside(root, document.path) ?? document.path;
    const decision = derived.get(path);
    if (decision !== undefined) {
      already.push({ path, decision });
      continue;
    }
    fresh.push({ ...document, path });
  }
  return { fresh, already };
}

/**
 * A refusal with its file named the way every other line of this verb names one:
 * relative to the project root.
 *
 * The scanner works in absolute paths because it walks a directory, and the plan
 * relativizes what it read — so this half was reporting `/home/…/repo/docs/adr/x.md`
 * beside proposals reporting `docs/adr/x.md`. Two spellings of one file in one report
 * is bad enough on its own; the half that made it a defect is that the absolute one is
 * THIS MACHINE'S, and every other path this verb prints is one a reader of a pasted
 * transcript can open in their own clone.
 */
function named(refusal: ScanRefusal, root: string): ScanRefusal {
  return { ...refusal, path: inside(root, refusal.path) ?? refusal.path };
}

/** What a proposal looks like before anything is written. */
function proposed(document: ScannedDecision): ImportedProposal {
  return {
    path: document.path,
    title: document.title,
    alternatives: document.alternatives !== undefined,
    ...(document.status !== undefined ? { status: document.status } : {}),
  };
}

/**
 * Reads a directory of decision documents and proposes what it finds — printing the
 * plan, or, with `write`, recording it.
 *
 * Every proposal is born `proposed`, because that is the only state this product's
 * writes produce. The file's status is reported and never applied, and there is no
 * flag, threshold or confidence that would make one land accepted.
 *
 * On `write`, the whole directory goes through ONE open writer and ONE checkpoint at
 * the end. A gate refusal stops the run at the file that earned it, and what was
 * already appended stays appended — an append-only record cannot take it back, and
 * pretending otherwise by reporting nothing would be worse than saying where it
 * stopped.
 */
export function runDecisionImport(
  ctx: DecisionImportContext,
  input: {
    from: string;
    write?: boolean;
    scope?: Scope;
    which?: string;
    run?: string;
  },
): ImportDone | ImportRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return { ok: false, reason: 'NO_PROJECT' };
  const root = dirname(trees.projectPublic);
  const directory = resolve(ctx.cwd, input.from);
  const from = inside(root, directory);
  if (from === undefined) return { ok: false, reason: 'OUTSIDE_PROJECT', from: input.from };

  const scope = resolveScope('decision.recorded', { which: input.which }, input.scope);
  const scan = scanAdrDirectory(directory);
  const refused = scan.refused.map((refusal) => named(refusal, root));
  const { fresh, already } = plan(scan.read, root, alreadyDerived(ctx));

  if (input.write !== true) {
    return {
      ok: true,
      wrote: false,
      from,
      proposals: fresh.map(proposed),
      already,
      refused,
      scope,
    };
  }

  const writer = openTreeForWriting(trees, scope);
  const context = {
    writer,
    layout: { root: chainRootForScope(trees, scope) as string },
    upcasters: catalogUpcasters(),
  };
  const proposals: ImportedProposal[] = [];
  let stopped: ImportDone['stopped'];
  for (const document of fresh) {
    const recorded = recordDecision(context, {
      title: document.title,
      rationale: document.rationale,
      ...(document.alternatives !== undefined ? { alternatives: document.alternatives } : {}),
      ...(input.which !== undefined ? { which: input.which } : {}),
      ...(input.run !== undefined ? { run: input.run } : {}),
    });
    if (!recorded.ok) {
      stopped = { path: document.path, code: recorded.code, message: recorded.message };
      break;
    }
    // The provenance, as a fact of the record rather than a sentence in the prose.
    // It is recorded right after the decision it is about, so a run that stops
    // partway never leaves a decision whose origin nobody can name.
    const linked = linkKnowledge(context, {
      subject: recorded.id,
      target: document.path,
      rel: DERIVED_FROM_RELATION,
      ...(input.which !== undefined ? { which: input.which } : {}),
      ...(input.run !== undefined ? { run: input.run } : {}),
    });
    if (!linked.ok) {
      stopped = { path: document.path, code: linked.code, message: linked.message };
      break;
    }
    proposals.push({
      ...proposed(document),
      id: recorded.id,
      adr: recorded.adr,
      ...(recorded.replaced !== undefined ? { replaced: recorded.replaced } : {}),
    });
  }
  // One checkpoint for the whole directory: the tree is left fully signed, at the
  // cost of one signature rather than one per decision.
  writer.checkpoint();

  return {
    ok: true,
    wrote: true,
    from,
    proposals,
    already,
    refused,
    scope,
    ...(stopped !== undefined ? { stopped } : {}),
  };
}
