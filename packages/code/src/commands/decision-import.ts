/**
 * `mnema decision import <source>` — propose the decisions this repository already
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
 * proposal is linked to the file it came from, under {@link DERIVED_FROM_RELATION} —
 * a label the catalog already recommended — so this needed no new field, no version
 * and no upcaster, and none of the published canonical vectors move. That link is
 * ALSO what makes a second run idempotent: a file already on the far end of a
 * `derived-from` edge is a file already imported, whatever its title says now.
 *
 * THE LABEL USED TO BE DECLARED HERE, and it moved because a third party wanted it.
 * The catalog held the bare literal in its recommended set while this file held a
 * constant of its own, so the writer's label and the published vocabulary were two
 * strings that happened to agree; now the READS carry a record's provenance too, and
 * a third spelling is how a write and a read come to disagree about which edge is a
 * provenance. It is one site in the catalog, imported by all three.
 *
 * ONE WRITER, ONE CHECKPOINT. The whole directory is written through a single open
 * writer and signed once at the end, rather than N times through N invocations. That
 * is the cost argument for the verb existing at all, and the report says the number.
 */

import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { catalogUpcasters, chainExtent } from '@mnema/chain';
import {
  type BridgeFormat,
  chainRootForScope,
  DERIVED_FROM_RELATION,
  type DiscoveryEnv,
  type ReplacedClass,
  resolveScope,
  resolveTrees,
  type ScannedDecision,
  type ScanRefusal,
  type Scope,
  scanAdrDirectory,
  scanBridge,
} from '@mnema/core';
import {
  type Judged,
  linkKnowledge,
  onTheRecordAsItStands,
  openTreeForWriting,
  recordDecision,
} from '@mnema/core/write';
import {
  linkBreaksOf,
  type ScopedLinkBreak,
  THE_READING_THAT_OPENED_THESE,
  withScopedCaches,
} from '../tree-sources.js';
import { IMPORT_SCOPES } from '../vocabulary.js';

/** What the import needs — injected so it is testable. */
export interface DecisionImportContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`). */
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
  /**
   * Whether the document lists its options without saying which it chose, so none was
   * recorded as turned down: the list holds the winner too, and nothing in the file tells it
   * from the losers.
   */
  readonly optionsUnclear: boolean;
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
  readonly replaced?: readonly ReplacedClass[];
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
  /**
   * The tails among those read that do not chain — empty for a sound record, which is
   * every record this product wrote on its own. See {@link linkBreaksOf}: what is served
   * beside it came off a record whose proof this is the state of, and the wiring is what
   * says so.
   */
  readonly linkBreaks: readonly ScopedLinkBreak[];
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
  | { readonly ok: false; readonly reason: 'OUTSIDE_PROJECT'; readonly from: string }
  /**
   * The proposals would be born in the machine-global tree. Each one records the file it came
   * from as a path inside THIS project, and the global tree is read in every project, where
   * that path names another project's file — so the import writes only into the trees of the
   * project it read ({@link IMPORT_SCOPES} carries what was measured).
   */
  | { readonly ok: false; readonly reason: 'GLOBAL_TREE' };

/** What `decision import` reads: a directory of decision files, or one of the bridges. */
export type ImportFormat = 'adr' | BridgeFormat;

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
function alreadyDerived(ctx: DecisionImportContext): {
  readonly byTarget: ReadonlyMap<string, string>;
  readonly linkBreaks: readonly ScopedLinkBreak[];
} {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  return withScopedCaches(trees, (sources) => {
    const byTarget = new Map<string, string>();
    for (const source of sources) {
      for (const edge of source.cache.linksByRelation(DERIVED_FROM_RELATION)) {
        if (!byTarget.has(edge.target)) byTarget.set(edge.target, edge.subject);
      }
    }
    // THE SAME READ, and this verb is the one where it matters most: the set above is
    // what stops a file being proposed twice, and an import that appends over a tail
    // that no longer chains is a write onto a record whose proof already failed.
    return { byTarget, linkBreaks: linkBreaksOf(sources, THE_READING_THAT_OPENED_THESE) };
  });
}

/** The plan a run would carry out: what is new, and what the record already has. */
function plan(
  scanned: readonly ScannedDecision[],
  originOf: (path: string, line?: number, digest?: string) => string,
  derived: ReadonlyMap<string, string>,
): { readonly fresh: readonly ScannedDecision[]; readonly already: readonly AlreadyImported[] } {
  const fresh: ScannedDecision[] = [];
  const already: AlreadyImported[] = [];
  for (const document of scanned) {
    const path = originOf(document.path, document.line, document.digest);
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
function named(
  refusal: ScanRefusal,
  originOf: (path: string, line?: number, digest?: string) => string,
): ScanRefusal {
  return { ...refusal, path: originOf(refusal.path, refusal.line) };
}

/** What a proposal looks like before anything is written. */
function proposed(document: ScannedDecision): ImportedProposal {
  return {
    path: document.path,
    title: document.title,
    alternatives: document.alternatives !== undefined,
    optionsUnclear: document.optionsUnclear === true,
    ...(document.status !== undefined ? { status: document.status } : {}),
  };
}

/** What importing one file came to: written, found already there, or stopped by a refusal. */
type Imported =
  | { readonly proposal: ImportedProposal }
  | { readonly already: AlreadyImported }
  | { readonly stopped: NonNullable<ImportDone['stopped']> };

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
    format?: ImportFormat;
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
  const format = input.format ?? 'adr';
  const from = inside(root, directory);
  // A decision FILE is cited by a path every clone can open, so one outside the project is
  // refused. A bridge's source is somebody else's notes and may live anywhere (the host keeps
  // its memory under the home): it is cited by its source and file name instead.
  if (from === undefined && format === 'adr') {
    return { ok: false, reason: 'OUTSIDE_PROJECT', from: input.from };
  }
  // A path inside the project cites itself. A source outside it is cited by its format and
  // file name, and the name is not unique across directories, so the content's hash is what
  // tells two files of one name apart (and never a path of this machine).
  const originOf = (path: string, line?: number, digest?: string): string => {
    const base = inside(root, path) ?? `${format}:${basename(path)}`;
    const at = line !== undefined ? `${base}:${line}` : base;
    return digest !== undefined && inside(root, path) === undefined ? `${at}#${digest}` : at;
  };

  const scope = resolveScope('decision.recorded', { which: input.which }, input.scope);
  if (!IMPORT_SCOPES.includes(scope)) return { ok: false, reason: 'GLOBAL_TREE' };
  const scan = format === 'adr' ? scanAdrDirectory(directory) : scanBridge(format, directory);
  const refused = scan.refused.map((refusal) => named(refusal, originOf));
  const layout = { root: chainRootForScope(trees, scope) as string };
  // Taken BEFORE the reading, so a write that lands while the record is being read moves it.
  const readAt = chainExtent(layout);
  const derived = alreadyDerived(ctx);
  const { fresh, already } = plan(scan.read, originOf, derived.byTarget);

  if (input.write !== true) {
    return {
      ok: true,
      linkBreaks: derived.linkBreaks,
      wrote: false,
      from: from ?? input.from,
      proposals: fresh.map(proposed),
      already,
      refused,
      scope,
    };
  }

  // NOTHING NEW TO RECORD OPENS NO WRITER. Every file already derived, or refused by name:
  // the plan is complete and nothing will be appended, and opening one anyway touches the
  // tree — for a key that never wrote here, an installation id; and its public half and an
  // empty tail too, which a run that recorded 0 decisions used to leave behind (measured on
  // the binary), until a tail came to be born at its writer's first append.
  if (fresh.length === 0) {
    return {
      ok: true,
      linkBreaks: derived.linkBreaks,
      wrote: true,
      from: from ?? input.from,
      proposals: [],
      already,
      refused,
      scope,
    };
  }

  const writer = openTreeForWriting(trees, scope);
  const context = { writer, layout, upcasters: catalogUpcasters() };
  // What the record holds derived from each file, as of `knownAt`: read again only when the
  // tree moved since, and kept in step with this run's own writes, which it makes under the lock.
  let known = derived.byTarget;
  let knownAt = readAt;
  const derivedNow = (): ReadonlyMap<string, string> => {
    const at = chainExtent(layout);
    if (at !== knownAt) {
      known = alreadyDerived(ctx).byTarget;
      knownAt = at;
    }
    return known;
  };
  // One file's decision and the edge that names the file it came from, called under the
  // tail's lock, so the two land in one hold and no other import reads the decision without
  // its origin. Inside this function rather than beside it, because it is this verb's write,
  // signed by the one checkpoint at the end.
  const importOne = (document: ScannedDecision): Imported => {
    const recorded = recordDecision(context, {
      title: document.title,
      rationale: document.rationale,
      ...(document.alternatives !== undefined ? { alternatives: document.alternatives } : {}),
      ...(input.which !== undefined ? { which: input.which } : {}),
      ...(input.run !== undefined ? { run: input.run } : {}),
    });
    if (!recorded.ok) {
      return { stopped: { path: document.path, code: recorded.code, message: recorded.message } };
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
      return { stopped: { path: document.path, code: linked.code, message: linked.message } };
    }
    // BOTH writes' reports: the provenance link is a fact this verb recorded too, and its
    // report used to be dropped here. (Its `target` and `rel` are names, refused rather than
    // redacted, so today it can replace nothing; the next field it carries could.)
    const replaced = [...(recorded.replaced ?? []), ...(linked.replaced ?? [])];
    return {
      proposal: {
        ...proposed(document),
        id: recorded.id,
        adr: recorded.adr,
        ...(replaced.length > 0 ? { replaced } : {}),
      },
    };
  };
  const proposals: ImportedProposal[] = [];
  const meanwhile: AlreadyImported[] = [];
  let stopped: ImportDone['stopped'];
  for (const document of fresh) {
    // ONE FILE, ONE ACT UNDER THE TAIL'S LOCK. Two imports of one directory run together both
    // read the record before either wrote, both found every file new, and the record came out
    // holding each decision twice. Whether a file is already derived is judged again under the
    // lock when anything landed since the plan was read ({@link onTheRecordAsItStands}), and
    // the decision and the edge that names its file are appended in that same hold — so the
    // second import finds the first one's edge, and reports the file as already there.
    const outcome = onTheRecordAsItStands(context, derivedNow, (byTarget): Judged<Imported> => {
      const decision = byTarget.get(document.path);
      if (decision !== undefined) return { refuse: { already: { path: document.path, decision } } };
      return {
        write: () => {
          const imported = importOne(document);
          // SIGNED IN THE SAME HOLD. This was one checkpoint for the whole directory, after
          // the last file: a signature asked for under a lock of its own, which a busy tail
          // could refuse with every decision of the directory already on it, and the refusal
          // read "not appended". A signature per file costs milliseconds; a refusal that
          // denies what landed costs the record its word.
          writer.checkpoint();
          // This run's own writes moved the tree, and they are known: the edge it just
          // appended. The extent is taken here, still under the lock, so nothing another
          // session appends after the lock is let go can be folded into it unread.
          if ('proposal' in imported) {
            known = new Map(known).set(document.path, imported.proposal.id as string);
            knownAt = chainExtent(layout);
          }
          return imported;
        },
      };
    });
    if ('already' in outcome) {
      meanwhile.push(outcome.already);
      continue;
    }
    if ('stopped' in outcome) {
      stopped = outcome.stopped;
      break;
    }
    proposals.push(outcome.proposal);
  }
  return {
    ok: true,
    linkBreaks: derived.linkBreaks,
    wrote: true,
    from: from ?? input.from,
    proposals,
    already: [...already, ...meanwhile],
    refused,
    scope,
    ...(stopped !== undefined ? { stopped } : {}),
  };
}
