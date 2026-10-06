/**
 * `mnema promote` — lift a pattern that recurs across projects to this machine's global tree.
 *
 * Two acts under one word, and the first never writes:
 *
 *   `promote --workspace <path...>` LISTS the candidates — the patterns and decisions in
 *   force, with the same words, in the committed record of two or more of the projects the
 *   caller NAMED. It is a reading. The set is named and never discovered, for the reason
 *   `verify --workspace` states: a walk of the disk would be the product guessing which
 *   projects were meant, and would reach a stranger's project in a neighbouring folder.
 *
 *   `promote <id> --evidence <path>:<id> …` COPIES one. `<id>` is the instance in the
 *   project the caller stands in; each `--evidence` names another project and the id there.
 *   The copy is born `proposed` in the global tree, with the kinds the record already has
 *   (the birth of a skill or a decision), followed by one `derived-from` link per id cited,
 *   this project's included. Nothing is moved and nothing is retracted where it came from,
 *   and the copy carries no address: whether a path of ONE repository may govern every
 *   repository on the machine is a separate act, and an explicit one.
 *
 * BOTH ASK {@link samePattern} (through {@link judgePromotion} for the write), so what the
 * listing shows is what the write accepts, and what the listing leaves out the write
 * refuses by name with nothing appended. Only the COMMITTED trees count and only they can
 * be cited: the copy lands in the global tree, which every project on the machine reads,
 * so a private tree of any project would otherwise be published to all of them.
 *
 * The path of a project is in what this prints and never in what it records: folders move,
 * ids do not.
 */

import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { catalogUpcasters } from '@mnema/chain';
import {
  judgePromotion,
  type PatternInstance,
  type PromotionCandidate,
  type ScopedCache,
  samePattern,
} from '@mnema/context';
import { type DiscoveryEnv, ProjectionCache, resolveTrees } from '@mnema/core';
import { recordTrees, type ScopedTree } from '../intelligence-source.js';
import { forwardReplacement, type Landed, type Replacement } from '../recorded-content.js';
import { runDecision } from './decision.js';
import { runLink } from './link.js';
import { runSkill } from './skill.js';

/** What promote needs — injected so it is testable. */
export interface PromoteContext {
  /** Where relative paths are resolved from, and the project the write is made from. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`). */
  readonly env: DiscoveryEnv;
}

/** The candidates among the projects the caller named. */
export interface PromoteListed {
  readonly ok: true;
  /** How many DISTINCT projects were read (two names of one project count once). */
  readonly projects: number;
  /** Named paths that hold no record — said, never counted. */
  readonly withoutRecord: readonly string[];
  readonly candidates: readonly PromotionCandidate[];
}

/** A copy was written to the global tree. */
export interface PromoteDone extends Replacement, Landed {
  readonly ok: true;
  /** The copy's id in the global tree — what the person adopts. */
  readonly id: string;
  readonly kind: 'skill' | 'decision';
  readonly title: string;
  /** Every instance the copy cites, the project the caller stands in first. */
  readonly derivedFrom: readonly PatternInstance[];
}

/** The promotion was refused and nothing was appended. */
export type PromoteRefused =
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/** One project the caller named: where it is, and the trees of its record. */
interface NamedProject {
  readonly dir: string;
  readonly trees: ScopedTree[];
}

function identityOf(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/**
 * The trees of the named projects and of the machine-global tree, each once, with the
 * project every one belongs to — EVERY tree of each project, private included. Which of
 * them count is not decided here: that filter is inside {@link samePattern}, the one place.
 */
function resolveNamed(
  ctx: PromoteContext,
  named: readonly string[],
): { projects: NamedProject[]; withoutRecord: string[]; trees: ScopedTree[] } {
  const projects: NamedProject[] = [];
  const withoutRecord: string[] = [];
  const seen = new Set<string>();
  const trees: ScopedTree[] = [];
  const claimed = new Set<string>();
  for (const path of named) {
    const at = resolve(ctx.cwd, path);
    const found = resolveTrees(at, ctx.env);
    const root = found.projectPublic;
    if (root === undefined) {
      withoutRecord.push(at);
      continue;
    }
    const identity = identityOf(root);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const dir = dirname(root);
    const own = recordTrees(found, dir);
    projects.push({ dir, trees: own });
    for (const tree of own) {
      if (claimed.has(tree.chainRoot)) continue;
      claimed.add(tree.chainRoot);
      trees.push(tree);
    }
  }
  // The machine's own tree, once — the one place "already global" is read from.
  const globalRoot = resolveTrees(ctx.cwd, ctx.env).global;
  if (!claimed.has(globalRoot)) trees.push({ scope: 'global', chainRoot: globalRoot });
  return { projects, withoutRecord, trees };
}

/** Opens each tree in memory (nothing is written into a project that is not this one), reads, closes. */
function reading<T>(trees: readonly ScopedTree[], read: (sources: ScopedCache[]) => T): T {
  const upcasters = catalogUpcasters();
  const opened: ScopedCache[] = [];
  try {
    for (const tree of trees) {
      const cache = ProjectionCache.open(tree.chainRoot, { upcasters });
      opened.push({
        scope: tree.scope,
        chainRoot: tree.chainRoot,
        ...(tree.project !== undefined ? { project: tree.project } : {}),
        cache,
      });
      cache.refresh();
    }
    return read(opened);
  } finally {
    for (const source of opened) source.cache.close();
  }
}

/** Lists what recurs across the projects the caller named. Writes nothing. */
export function runPromoteList(
  ctx: PromoteContext,
  input: { named: readonly string[] },
): PromoteListed {
  const set = resolveNamed(ctx, input.named);
  const candidates = reading(set.trees, (sources) => samePattern(sources));
  return {
    ok: true,
    projects: set.projects.length,
    withoutRecord: set.withoutRecord,
    candidates,
  };
}

/** `<path>:<id>` — the id is what follows the LAST colon, so a path may hold one. */
function splitEvidence(value: string): { path: string; id: string } | undefined {
  const cut = value.lastIndexOf(':');
  if (cut <= 0 || cut === value.length - 1) return undefined;
  return { path: value.slice(0, cut), id: value.slice(cut + 1) };
}

const refused = (code: string, message: string): PromoteRefused => ({
  ok: false,
  reason: 'REFUSED',
  code,
  message,
});

/**
 * Copies the instance `id` of the project the caller stands in to the global tree,
 * citing it and every `evidence` instance. It judges FIRST, with the reading the listing
 * uses, and appends nothing unless the cited set is one that reading lists.
 */
export function runPromote(
  ctx: PromoteContext,
  input: {
    id: string;
    evidence: readonly string[];
    which?: string;
    run?: string;
  },
): PromoteDone | PromoteRefused {
  const here = resolveTrees(ctx.cwd, ctx.env);
  if (here.projectPublic === undefined) return { ok: false, reason: 'NO_PROJECT' };
  if (input.evidence.length === 0) {
    return refused('NO_EVIDENCE', 'name at least one `--evidence <path>:<id>`');
  }

  const cited: { path: string; id: string }[] = [{ path: ctx.cwd, id: input.id }];
  for (const value of input.evidence) {
    const parsed = splitEvidence(value);
    if (parsed === undefined) {
      return refused('BAD_EVIDENCE', `\`${value}\` is not \`<path>:<id>\``);
    }
    cited.push(parsed);
  }

  const set = resolveNamed(
    ctx,
    cited.map((one) => one.path),
  );
  if (set.withoutRecord.length > 0) {
    return refused('NO_RECORD', `${set.withoutRecord.join(', ')} holds no record`);
  }
  // Each citation under the project its path leads to — the same label the listing gives.
  const labelled: PatternInstance[] = cited.map((one) => ({
    project: dirname(resolveTrees(resolve(ctx.cwd, one.path), ctx.env).projectPublic as string),
    id: one.id,
  }));

  const judged = reading(set.trees, (sources) => judgePromotion(sources, labelled));
  if (!judged.ok) return refused(judged.reason, judged.detail);
  const { candidate } = judged;

  const born =
    candidate.kind === 'skill'
      ? runSkill(ctx, {
          name: candidate.title,
          body: candidate.body,
          scope: 'global',
          ...(input.which !== undefined ? { which: input.which } : {}),
          ...(input.run !== undefined ? { run: input.run } : {}),
        })
      : runDecision(ctx, {
          title: candidate.title,
          rationale: candidate.body,
          ...(candidate.alternatives !== undefined ? { alternatives: candidate.alternatives } : {}),
          scope: 'global',
          ...(input.which !== undefined ? { which: input.which } : {}),
          ...(input.run !== undefined ? { run: input.run } : {}),
        });
  if (!born.ok) {
    return born.reason === 'NO_PROJECT' ? born : refused(born.code, born.message);
  }

  for (const from of labelled) {
    const linked = runLink(ctx, {
      subject: born.id,
      target: from.id,
      rel: 'derived-from',
      scope: 'global',
      ...(input.which !== undefined ? { which: input.which } : {}),
      ...(input.run !== undefined ? { run: input.run } : {}),
    });
    if (!linked.ok) {
      return linked.reason === 'NO_PROJECT' ? linked : refused(linked.code, linked.message);
    }
  }

  return {
    ok: true,
    id: born.id,
    kind: candidate.kind,
    title: candidate.title,
    derivedFrom: labelled,
    scope: 'global',
    ...forwardReplacement(born),
  };
}
