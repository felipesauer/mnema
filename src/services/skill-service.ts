import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import type { Skill } from '../domain/entities/skill.js';
import { ActorKind } from '../domain/enums/actor-kind.js';
import { checkSlug, checkStringLength } from '../domain/validation.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { ErrorIssue, MnemaError } from '../errors/mnema-error.js';
import { parseFrontmatter } from '../storage/markdown/frontmatter.js';
import type { ProvenanceLinkRepository } from '../storage/sqlite/repositories/provenance-link-repository.js';
import type { SkillRepository } from '../storage/sqlite/repositories/skill-repository.js';
import { writeFileAtomic } from '../utils/atomic-write.js';
import {
  canonicalMirrorPath as buildMirrorPath,
  findAllMirrors,
  findMirror,
  listMirrorEntries,
  skillOriginDir,
} from '../utils/mirror-layout.js';
import type { AuditService } from './audit-service.js';
import { type CommandRunner, defaultRunner } from './github-pr-service.js';
import type { IdentityService } from './identity-service.js';
import { Err, Ok, type Result } from '../common/result.js';
import { readUserSkills, type SourcedSkill } from './user-knowledge.js';

// The example/core split lives in a leaf util so the skill repository can call
// it on the write path without importing this service (which would form a
// cycle). Re-exported here so it reads as part of the skill vocabulary.
export { splitSkillExampleSections } from '../utils/skill-body.js';

/**
 * Severity of a skill-lint diagnostic.
 *
 * - `error`: blocks publication of the skill (missing required field,
 *   referenced tool unknown, malformed frontmatter)
 * - `warning`: skill is usable but the catalogue convention is not
 *   met (e.g. missing example section, version not semver)
 */
export type SkillSeverity = 'error' | 'warning';

/**
 * One diagnostic emitted by {@link SkillService.lint}.
 */
export interface SkillDiagnostic {
  readonly file: string;
  readonly severity: SkillSeverity;
  readonly message: string;
}

/**
 * Outcome of a full lint pass.
 */
export interface SkillLintReport {
  readonly diagnostics: readonly SkillDiagnostic[];
  readonly filesScanned: number;
  readonly errorCount: number;
  readonly warningCount: number;
}

/**
 * Validated metadata extracted from a skill's YAML frontmatter.
 *
 * Names match the design vocabulary: `name` is the catalogue key,
 * `version` follows semver, `tools_used` lists the MCP tools the skill
 * leans on so the lint can flag stale references.
 */
export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/),
  description: z.string().min(1),
  tools_used: z.array(z.string()).default([]),
  // Dynamic-invocation fields (optional; absent on a passive skill).
  invocable: z.boolean().optional(),
  dynamic_context: z.array(z.string()).optional(),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

/**
 * Mode controlling whether `record` overwrites the latest version
 * (`update`) or creates a new version row (`new_version`).
 */
export type SkillRecordMode = 'update' | 'new_version';

/**
 * Input for {@link SkillService.record}.
 */
export interface SkillRecordInput {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly toolsUsed?: readonly string[];
  /** When true, marks the skill invocable (see {@link Skill.invocable}). */
  readonly invocable?: boolean;
  /** Commands whose output is injected as context (see {@link Skill.dynamicContext}). */
  readonly dynamicContext?: readonly string[];
  readonly mode?: SkillRecordMode;
  /**
   * Why this record changes the skill — stored on the resulting version and
   * shown alongside the version diff. Most useful on `mode='new_version'`;
   * ignored (kept null) when creating version 1.
   */
  readonly changeRationale?: string | null;
  /** Optional area (path/package) this skill belongs to; omit for global. */
  readonly scope?: string | null;
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
}

/**
 * Outcome of {@link SkillService.record}: the resulting skill row plus
 * a hint of what happened (created v1, bumped to vN, overwrote in place,
 * or no-op because content was already identical).
 */
export interface SkillRecordResult {
  readonly skill: Skill;
  readonly action: 'created' | 'updated' | 'new_version' | 'no_op';
}

/** One line-level change in a {@link SkillDiff}. */
export interface DiffHunk {
  readonly kind: 'add' | 'remove' | 'context';
  readonly text: string;
}

/** The diff between two versions of a skill — see {@link SkillService.diff}. */
export interface SkillDiff {
  readonly slug: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  /** The newer version's change rationale (the "why"), or null if none. */
  readonly changeRationale: string | null;
  readonly hunks: readonly DiffHunk[];
}

/**
 * `show` payload: the skill plus, when this version is superseded, its
 * successor's slug. The stored `supersededBy` pointer is the successor
 * ROW's id (skills are keyed by slug+version), so the service resolves it
 * here — a renderer should name the replacement, not print a UUID.
 */
export type SkillShowView = SourcedSkill & {
  readonly supersededBySlug?: string;
};

/**
 * Skill catalogue: lint (filesystem-only, read-only) and record/show/use
 * (SQLite-backed, agent-facing).
 *
 * Filesystem mirror: when a skill is recorded, the service writes
 * `<skillsDir>/<slug>.md` atomically so humans can see the same content.
 * Frontmatter is generated by the service — agents pass semantic fields,
 * not raw YAML.
 */
/**
 * Read-only `mnema` command prefixes that a skill's dynamic context may
 * run. The command (with the leading `mnema` stripped) must match one of
 * these exactly or start with it followed by a space — so `tasks ready`
 * and `tasks ready --sprint X` are allowed but `task create` is not.
 *
 * The allowlist is a *positive* list of commands proven to only read and
 * print state. It exists because the previous "first token must be
 * `mnema`" check was insufficient: the `mnema` binary also exposes
 * destructive and arbitrary-I/O subcommands (`destroy --yes`, `import
 * --from <path>`, `snapshot --out <path>`) that a hostile skill could
 * otherwise trigger from `skill_show`. Verbs that mix reads and writes
 * (`task`, `epic`, `sprint`, `decision`, `memory`, `skill`, …) are listed
 * only with their read subactions (`list`/`show`/`ready`/`coverage`),
 * never the bare verb.
 */
const DYNAMIC_CONTEXT_ALLOWLIST: readonly string[] = [
  'tasks ready',
  'tasks list',
  'tasks show',
  'task ready',
  'task list',
  'task show',
  'history',
  'stats',
  'query',
  'inbox',
  'search',
  'doctor',
  'epic show',
  'epic list',
  'epic coverage',
  'sprint show',
  'sprint list',
  'decision show',
  'decisions list',
  'skill show',
  'skill list',
  'skills list',
  'command show',
  'commands list',
  'memory show',
  'memories list',
  'observations list',
  'graph',
  'pr status',
];

/**
 * True when a dynamic-context command (already stripped of its leading
 * `mnema`) is on the read-only allowlist — an exact match, or an allowed
 * prefix followed by a space (so flags/arguments are permitted but a
 * different verb is not: `tasks ready` matches `tasks ready --sprint X`
 * but `tasksy` and `task create` do not).
 */
function isAllowedDynamicCommand(rest: string): boolean {
  return DYNAMIC_CONTEXT_ALLOWLIST.some(
    (allowed) => rest === allowed || rest.startsWith(`${allowed} `),
  );
}

export class SkillService {
  /**
   * Filename used as the skill catalogue index. Excluded from lint.
   */
  static readonly INDEX_FILE = 'SKILL.md';

  constructor(
    private readonly skillsDir: string,
    private readonly knownTools: ReadonlySet<string>,
    private readonly repo: SkillRepository | null = null,
    private readonly identity: IdentityService | null = null,
    private readonly audit: AuditService | null = null,
    // User-level knowledge dir (`~/.config/mnema`). When set, skills found
    // under it are merged into list/show as read-only `source: 'user'`
    // entries — a project skill of the same slug always shadows them.
    private readonly userDir: string | null = null,
    // Runner for a skill's dynamic-context commands. Injectable (like
    // GitHubPrService / CommitVerifier) so tests drive it with a mock;
    // the working directory is bound at call time.
    private readonly run: CommandRunner = defaultRunner,
    // Optional: when set, `supersede` records a navigable skill → skill
    // provenance edge (successor by row id). Absent in lint-only mode.
    private readonly provenance: ProvenanceLinkRepository | null = null,
  ) {}

  private requireRecordDeps(): {
    readonly repo: SkillRepository;
    readonly identity: IdentityService;
    readonly audit: AuditService;
  } {
    if (this.repo === null || this.identity === null || this.audit === null) {
      throw new Error(
        'SkillService was constructed in lint-only mode; record/show/use require the full DI tuple',
      );
    }
    return { repo: this.repo, identity: this.identity, audit: this.audit };
  }

  /**
   * Walks `skillsDir` and returns one diagnostic per problem found.
   *
   * Files that are neither `.md` nor `.markdown` are ignored.
   *
   * @returns Aggregate report with severity counts
   */
  lint(): SkillLintReport {
    if (!existsSync(this.skillsDir)) {
      return { diagnostics: [], filesScanned: 0, errorCount: 0, warningCount: 0 };
    }

    const diagnostics: SkillDiagnostic[] = [];
    // Foldered layout (MNEMA-ADR-51): lint default/ and authored/ plus any
    // flat files, indexes excluded by the shared scan.
    const files = listMirrorEntries(this.skillsDir);

    for (const { filePath } of files) {
      diagnostics.push(...this.lintFile(filePath));
    }

    const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
    const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;
    return { diagnostics, filesScanned: files.length, errorCount, warningCount };
  }

  /**
   * Records every well-formed skill `.md` in `skillsDir` as a SQLite row
   * (the missing file→DB direction). Seed/adopted skills are written as
   * files only; without a row they are indistinguishable from an orphan
   * and get pruned by the next `mnema upgrade`. Importing them as rows
   * makes them first-class — they survive rebuild, list in `skills_list`,
   * and are injectable — and is idempotent (record no-ops on byte-equal
   * content). Files with unparseable frontmatter are skipped, not fatal.
   *
   * @param actor - Identity tuple for the audit trail
   * @param via - Optional client annotation
   * @param runId - Optional run id
   * @returns The slugs that now have a row (created or already present)
   */
  importSeeds(actor: string, via?: string, runId?: string): string[] {
    if (!existsSync(this.skillsDir)) return [];
    const imported: string[] = [];
    // Foldered layout (MNEMA-ADR-51): scan default/ and authored/ as well as
    // any flat pre-migration files. Slug is the basename; the folder is
    // presentational and does not affect the recorded row.
    const files = listMirrorEntries(this.skillsDir);

    for (const { slug, filePath } of files) {
      const parsed = parseFrontmatter(readFileSync(filePath, 'utf-8'));
      const fm = SkillFrontmatterSchema.safeParse(parsed.data);
      if (!fm.success) continue; // malformed frontmatter — skip, don't crash init
      const result = this.record({
        slug,
        name: fm.data.name,
        description: fm.data.description,
        content: parsed.content,
        toolsUsed: fm.data.tools_used,
        invocable: fm.data.invocable,
        dynamicContext: fm.data.dynamic_context,
        actor,
        via,
        runId,
      });
      if (result.ok) imported.push(slug);
    }
    return imported;
  }

  /**
   * Records a skill. Three paths:
   *
   * - slug unknown → creates v1, regardless of `mode`.
   * - slug known and `mode='update'` (default): if content is byte-equal
   *   to the latest version, no-op. Otherwise overwrites the latest row
   *   in place.
   * - slug known and `mode='new_version'`: inserts a new row with
   *   version = latest + 1 (even if content matches; the agent asked).
   *
   * @param input - Skill fields + identity tuple
   * @returns Outcome describing the action taken, or a structured error
   */
  record(input: SkillRecordInput): Result<SkillRecordResult, MnemaError> {
    // Enforce the slug shape and field bounds at the service so the CLI
    // (and any non-MCP caller) is covered — not just the MCP schema. The
    // slug becomes `<skillsDir>/<slug>.md` in writeMirror, so a value like
    // `../../etc/x` would escape the project; reject it before any write.
    // Bounds match the MCP schema (name 1..120, description 1..500,
    // content ≥ 1).
    const shapeIssues: ErrorIssue[] = [];
    checkSlug(input.slug, shapeIssues);
    checkStringLength(input.name, 'name', 1, 120, shapeIssues);
    checkStringLength(input.description, 'description', 1, 500, shapeIssues);
    checkStringLength(input.content, 'content', 1, undefined, shapeIssues);
    if (shapeIssues.length > 0) {
      return Err({ kind: ErrorCode.ValidationFailed, issues: shapeIssues });
    }

    const { repo, identity, audit } = this.requireRecordDeps();
    const createdBy = identity.ensureActor(input.actor, ActorKind.Human);
    const toolsUsed = input.toolsUsed ?? [];
    const invocable = input.invocable ?? false;
    const dynamicContext = input.dynamicContext ?? [];
    const latest = repo.findLatestBySlug(input.slug);
    const mode: SkillRecordMode = input.mode ?? 'update';

    let action: SkillRecordResult['action'];
    let resulting: Skill;

    if (latest === null) {
      resulting = repo.insert({
        slug: input.slug,
        name: input.name,
        version: 1,
        description: input.description,
        content: input.content,
        toolsUsed,
        invocable,
        dynamicContext,
        scope: input.scope ?? null,
        createdBy,
      });
      action = 'created';
    } else if (mode === 'new_version') {
      // Read-then-write: the next version number is derived from the latest
      // row. Do the re-read and the insert inside ONE transaction so two
      // concurrent `new_version` records cannot both read the same latest and
      // collide on the `(slug, version)` UNIQUE constraint. (better-sqlite3 is
      // synchronous today, but this keeps the invariant correct by
      // construction rather than by runtime coincidence.)
      resulting = repo.runInTransaction(() => {
        const current = repo.findLatestBySlug(input.slug) ?? latest;
        return repo.insert({
          slug: input.slug,
          name: input.name,
          version: current.version + 1,
          description: input.description,
          content: input.content,
          toolsUsed,
          invocable,
          dynamicContext,
          changeRationale: input.changeRationale ?? null,
          // A new version keeps the prior scope unless a new one is supplied.
          scope: input.scope ?? current.scope,
          createdBy,
        });
      });
      action = 'new_version';
    } else {
      // `scope` is part of the record's identity: a re-record that changes
      // ONLY the scope must not be swallowed as a no-op (that silently drops
      // the new scope). `changeRationale` is intentionally excluded — an
      // in-place edit that resupplies the same body is a no-op even without a
      // fresh rationale, and the rationale is preserved below.
      const nextScope = input.scope ?? latest.scope;
      const sameContent =
        latest.content === input.content &&
        latest.name === input.name &&
        latest.description === input.description &&
        toolsArraysEqual(latest.toolsUsed, toolsUsed) &&
        latest.invocable === invocable &&
        toolsArraysEqual(latest.dynamicContext, dynamicContext) &&
        latest.scope === nextScope;
      if (sameContent) {
        resulting = latest;
        action = 'no_op';
      } else {
        const updated = repo.updateContent(latest.id, {
          name: input.name,
          description: input.description,
          content: input.content,
          toolsUsed,
          invocable,
          dynamicContext,
          // Keep the prior rationale unless a new one is supplied — an
          // in-place fix must not erase the "why" a past version recorded.
          changeRationale: input.changeRationale ?? latest.changeRationale,
          // Keep the prior scope unless a new one is supplied.
          scope: nextScope,
        });
        if (updated === null) {
          throw new Error('skill update returned null after a known row');
        }
        resulting = updated;
        action = 'updated';
      }
    }

    if (action !== 'no_op') {
      this.writeMirror(resulting);
    } else if (!this.mirrorExists(resulting)) {
      // a no_op record (content byte-equal to the stored row) does
      // not normally rewrite the mirror — but if the mirror file went
      // missing in the meantime, regenerate it so SQLite and the file
      // tree stay in sync without forcing a content change.
      this.writeMirror(resulting);
    }

    audit.write({
      kind: 'skill_recorded',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: {
        slug: resulting.slug,
        version: resulting.version,
        action,
      },
    });

    return Ok({ skill: resulting, action });
  }

  /**
   * Returns a skill by slug. If `version` is omitted, the latest version
   * is returned.
   *
   * @param slug - Skill slug
   * @param version - Optional specific version
   * @returns The skill or an error
   */
  show(slug: string, version?: number): Result<SkillShowView, MnemaError> {
    const { repo } = this.requireRecordDeps();
    const skill =
      version !== undefined
        ? repo.findBySlugAndVersion(slug, version)
        : repo.findLatestBySlug(slug);
    if (skill !== null) {
      // A superseded version stays retrievable for history, so resolve its
      // successor's slug for the renderer — see {@link SkillShowView}.
      const successor = skill.supersededBy === null ? null : repo.findById(skill.supersededBy);
      return Ok({
        ...skill,
        source: 'project',
        ...(successor === null ? {} : { supersededBySlug: successor.slug }),
      });
    }

    // Fall back to a user-level skill only when no project skill matches —
    // the project always shadows. A specific version is a project concept,
    // so a versioned lookup never falls through to the user layer.
    if (version === undefined && this.userDir !== null) {
      const userSkill = readUserSkills(this.userDir).find((s) => s.slug === slug);
      if (userSkill !== undefined) return Ok(userSkill);
    }
    return Err({ kind: ErrorCode.SkillNotFound, slug });
  }

  /**
   * Lists the latest version of every recorded skill, ordered by
   * `usage_count` then recency.
   *
   * @returns Skill rows
   */
  list(): readonly SourcedSkill[] {
    const { repo } = this.requireRecordDeps();
    const project: SourcedSkill[] = repo.listLatest().map((s) => ({ ...s, source: 'project' }));
    if (this.userDir === null) return project;

    // Merge user-level skills, but a project slug shadows the user's.
    const projectSlugs = new Set(project.map((s) => s.slug));
    const userOnly = readUserSkills(this.userDir).filter((s) => !projectSlugs.has(s.slug));
    return [...project, ...userOnly];
  }

  /**
   * Lists every version recorded under a slug, newest first.
   *
   * @param slug - Skill slug
   * @returns Skill rows
   */
  listVersions(slug: string): readonly Skill[] {
    const { repo } = this.requireRecordDeps();
    return repo.listBySlug(slug);
  }

  /**
   * Diffs two versions of a skill's content and surfaces the newer
   * version's change rationale — the "what changed, and why" that teaches
   * the next agent. `from`/`to` default to the two most recent versions;
   * a slug with only one version diffs against an empty base. Read-only.
   *
   * @param slug - Skill slug
   * @param from - Older version number (defaults to the second-newest)
   * @param to - Newer version number (defaults to the latest)
   * @returns The diff view or `SkillNotFound`
   */
  diff(slug: string, from?: number, to?: number): Result<SkillDiff, MnemaError> {
    const { repo } = this.requireRecordDeps();
    const versions = repo.listBySlug(slug); // newest first
    const latest = versions[0];
    if (latest === undefined) {
      return Err({ kind: ErrorCode.SkillNotFound, slug });
    }
    const toVersion = to ?? latest.version;
    // Default `from` to the version just below `to`; for a lone version,
    // diff against an empty base so the whole body reads as added.
    const fromVersion = from ?? versions[1]?.version ?? 0;

    const toSkill = versions.find((v) => v.version === toVersion);
    if (toSkill === undefined) {
      return Err({ kind: ErrorCode.SkillNotFound, slug });
    }
    const fromSkill = versions.find((v) => v.version === fromVersion);
    // fromVersion 0 (or an unknown one) means "no prior version" → empty base.
    const fromContent = fromSkill?.content ?? '';

    return Ok({
      slug,
      fromVersion: fromSkill?.version ?? 0,
      toVersion: toSkill.version,
      changeRationale: toSkill.changeRationale,
      hunks: diffLines(fromContent, toSkill.content),
    });
  }

  /**
   * Increments the usage counter on the latest version of a slug and
   * stamps `last_used_at`.
   *
   * @param slug - Skill slug
   * @param actor - Identity tuple for audit
   * @param via - Optional client annotation
   * @param runId - Optional run id
   * @returns The updated skill or an error
   */
  recordUse(slug: string, actor: string, via?: string, runId?: string): Result<Skill, MnemaError> {
    const { repo, audit } = this.requireRecordDeps();
    const updated = repo.incrementUsage(slug);
    if (updated === null) {
      return Err({ kind: ErrorCode.SkillNotFound, slug });
    }
    audit.write({
      kind: 'skill_used',
      actor,
      via,
      run: runId,
      data: { slug, version: updated.version, usage_count: updated.usageCount },
    });
    return Ok(updated);
  }

  /**
   * Supersedes a skill: points a version at a successor skill that
   * replaces it. The target is the latest version of `slug` unless
   * `version` is given; the successor resolves to the latest version of
   * `successorSlug`. The pointer stored is the successor row's `id`
   * (skill is keyed by `(slug, version)`, so the reference is a row id,
   * not a slug — see the supersede ADR). One-way: a superseded latest
   * version drops out of `list()` and search. Superseding a version by
   * itself is rejected with {@link ErrorCode.SelfSupersede}. No provenance
   * edge is recorded (the `'skill'` provenance kind is deferred — see the
   * ADR); an audit event stands in.
   *
   * @param slug - Slug of the skill being superseded
   * @param successorSlug - Slug of the replacement skill
   * @param actor - Identity tuple for audit
   * @param version - Optional specific version to supersede (default: latest)
   * @param via - Optional client annotation
   * @param runId - Optional run id
   * @returns The successor skill, or a structured error
   */
  supersede(
    slug: string,
    successorSlug: string,
    actor: string,
    version?: number,
    via?: string,
    runId?: string,
  ): Result<Skill, MnemaError> {
    const { repo, audit } = this.requireRecordDeps();

    const target =
      version !== undefined
        ? repo.findBySlugAndVersion(slug, version)
        : repo.findLatestBySlug(slug);
    if (target === null) return Err({ kind: ErrorCode.SkillNotFound, slug });
    // The target row must still be live: re-superseding an already-superseded
    // version would otherwise no-op in the repo (WHERE superseded_by IS NULL)
    // yet return Ok, silently leaving the pointer aimed at the first successor.
    if (target.supersededBy !== null) {
      return Err({
        kind: ErrorCode.SupersededEntity,
        entity: 'skill',
        ref: `${slug}@v${target.version}`,
      });
    }

    const successor = repo.findLatestBySlug(successorSlug);
    if (successor === null) return Err({ kind: ErrorCode.SkillNotFound, slug: successorSlug });
    // The successor's latest version must be live: `findLatestBySlug` does not
    // filter superseded rows, so guard against pointing at an already-retired
    // version (which would chain this skill to a dead one).
    if (successor.supersededBy !== null) {
      return Err({
        kind: ErrorCode.SupersededEntity,
        entity: 'skill',
        ref: `${successorSlug}@v${successor.version}`,
      });
    }

    // A skill row cannot supersede itself — a self-referential pointer.
    // Compared by row id, since (slug, version) is the identity: superseding
    // a slug by its own latest version, or a version by itself, is rejected.
    if (target.id === successor.id) {
      return Err({
        kind: ErrorCode.SelfSupersede,
        entity: 'skill',
        ref: `${slug}@v${target.version}`,
      });
    }

    const superseded = repo.supersede(target.id, successor.id);
    if (superseded) {
      // When the latest version is the one just superseded, the slug drops
      // from `list()` (listLatest filters superseded), so its `.md` mirror
      // must not linger looking live. `findLatestBySlug` does not filter, so
      // it still returns that row — check its pointer, not for absence.
      const latest = repo.findLatestBySlug(slug);
      if (latest !== null && latest.supersededBy !== null) {
        const mirror = findMirror(this.skillsDir, latest.slug);
        if (mirror !== null) unlinkSync(mirror);
      }
      audit.write({
        kind: 'skill_superseded',
        actor,
        via,
        run: runId,
        data: { slug, version: target.version, superseded_by: successor.id },
      });
      // First-class, navigable edge: the superseded skill row → its successor
      // row. Skill refs are row ids (not slugs), matching how the pointer
      // stores the successor id and how decision stores a successor id.
      this.provenance?.link(
        { kind: 'skill', ref: target.id },
        { kind: 'skill', ref: successor.id },
      );
    }
    return Ok(successor);
  }

  /**
   * Regenerates missing `.md` mirror files for the latest version of
   * every recorded slug. Existing mirrors are left alone — this only
   * heals drift, not reformats human-edited content. Returns the slugs
   * whose mirror was just rewritten.
   *
   * @returns Slugs whose mirror file was created during this call
   */
  rebuildMirrors(): string[] {
    const { repo } = this.requireRecordDeps();
    const rebuilt: string[] = [];
    for (const skill of repo.listLatest()) {
      // Rewrite when missing OR mislocated — the latter migrates a flat
      // pre-ADR-51 file into default/ or authored/. writeMirror unlinks the
      // old one.
      if (findMirror(this.skillsDir, skill.slug) !== this.canonicalMirrorPath(skill)) {
        this.writeMirror(skill);
        rebuilt.push(skill.slug);
      }
    }
    return rebuilt;
  }

  private mirrorExists(skill: Skill): boolean {
    return findMirror(this.skillsDir, skill.slug) !== null;
  }

  /** The canonical foldered path a skill's mirror belongs at (MNEMA-ADR-51). */
  private canonicalMirrorPath(skill: Skill): string {
    const handle = this.identity?.resolveHandle(skill.createdBy) ?? '';
    return buildMirrorPath(this.skillsDir, skill.slug, skillOriginDir(handle));
  }

  /**
   * Resolves a skill's `dynamicContext` commands into their current output,
   * so an invocable skill can embed live state (e.g. `mnema tasks ready`)
   * instead of a stale hand-written list. One entry per declared command,
   * in order.
   *
   * Only a fixed allowlist of read-only `mnema` subcommands may run (see
   * {@link DYNAMIC_CONTEXT_ALLOWLIST}) — the check happens before any
   * process is spawned. This is deliberately a positive list of state-
   * printing commands, not merely "the binary is `mnema`": the `mnema`
   * binary also has destructive / arbitrary-I/O subcommands (`destroy`,
   * `import --from`, `snapshot --out`) that must never be reachable from a
   * recorded skill. Commands run through the injectable {@link CommandRunner}
   * (argv array, no shell); they inherit the working directory of the mnema
   * process, which is the project root. Advisory: a command that is
   * disallowed, fails, or errors yields an entry with `ok: false` and a
   * reason rather than throwing — showing a skill must never blow up
   * because one embedded command failed.
   *
   * @param skill - The skill whose dynamic context to resolve
   * @returns One result per command, preserving declaration order
   */
  resolveDynamicContext(
    skill: Skill,
  ): Array<{ readonly command: string; readonly ok: boolean; readonly output: string }> {
    return skill.dynamicContext.map((command) => {
      const tokens = command.trim().split(/\s+/).filter(Boolean);
      if (tokens[0] !== 'mnema') {
        return {
          command,
          ok: false,
          output: 'skipped — only `mnema …` commands may be embedded as dynamic context',
        };
      }
      const rest = tokens.slice(1).join(' ');
      if (!isAllowedDynamicCommand(rest)) {
        return {
          command,
          ok: false,
          output:
            'skipped — only read-only mnema commands are allowed as dynamic context (e.g. `mnema tasks ready`, `mnema history`, `mnema stats`)',
        };
      }
      const result = this.run('mnema', tokens.slice(1));
      if (result.error !== undefined || result.status !== 0) {
        const reason = result.error?.message ?? `exit ${result.status ?? 'unknown'}`;
        return { command, ok: false, output: `command failed — ${reason}` };
      }
      return { command, ok: true, output: result.stdout.trimEnd() };
    });
  }

  private writeMirror(skill: Skill): void {
    // Foldered layout (MNEMA-ADR-51): seeds authored by the reserved `system`
    // handle mirror under `default/`, everything else under `authored/` (see
    // canonicalMirrorPath). Remove any existing mirror elsewhere in the tree
    // first so a row keeps exactly one mirror (e.g. a pre-migration flat file,
    // or an origin that changed).
    const targetPath = this.canonicalMirrorPath(skill);
    // Remove EVERY existing mirror other than the target — a changed origin, a
    // flat pre-migration file, or a duplicate left by an interrupted migration
    // — so the row keeps exactly one mirror.
    for (const stale of findAllMirrors(this.skillsDir, skill.slug)) {
      if (stale !== targetPath) unlinkSync(stale);
    }
    mkdirSync(path.dirname(targetPath), { recursive: true });
    const frontmatter = [
      '---',
      `name: ${quoteYaml(skill.name)}`,
      `version: ${skill.version}.0.0`,
      `description: ${quoteYaml(skill.description)}`,
      `tools_used: ${JSON.stringify(skill.toolsUsed)}`,
      // Only emit the invocation fields when set, so a passive skill's
      // mirror stays byte-identical to what earlier versions produced.
      skill.invocable ? 'invocable: true' : null,
      skill.dynamicContext.length > 0
        ? `dynamic_context: ${JSON.stringify(skill.dynamicContext)}`
        : null,
      `usage_count: ${skill.usageCount}`,
      skill.lastUsedAt !== null ? `last_used_at: ${skill.lastUsedAt}` : null,
      `created_at: ${skill.createdAt}`,
      `updated_at: ${skill.updatedAt}`,
      '---',
      '',
    ]
      .filter((line) => line !== null)
      .join('\n');
    writeFileAtomic(targetPath, `${frontmatter + skill.content}\n`);
  }

  private lintFile(filePath: string): SkillDiagnostic[] {
    const out: SkillDiagnostic[] = [];
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown read error';
      return [{ file: filePath, severity: 'error', message: `cannot read: ${message}` }];
    }

    let parsed: ReturnType<typeof parseFrontmatter>;
    try {
      parsed = parseFrontmatter(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown parse error';
      return [{ file: filePath, severity: 'error', message: `malformed frontmatter: ${message}` }];
    }

    const validation = SkillFrontmatterSchema.safeParse(parsed.data);
    if (!validation.success) {
      for (const issue of validation.error.issues) {
        const where = issue.path.length > 0 ? issue.path.map(String).join('.') : '<root>';
        out.push({
          file: filePath,
          severity: 'error',
          message: `frontmatter.${where}: ${issue.message}`,
        });
      }
      return out;
    }
    const front = validation.data;

    for (const tool of front.tools_used) {
      if (!this.knownTools.has(tool)) {
        out.push({
          file: filePath,
          severity: 'error',
          message: `references unknown MCP tool "${tool}"`,
        });
      }
    }

    if (!hasExample(parsed.content)) {
      out.push({
        file: filePath,
        severity: 'warning',
        message: 'no `## Example` section — skills should include at least one worked example',
      });
    }

    return out;
  }
}

function hasExample(body: string): boolean {
  return /^##\s+example\b/im.test(body);
}

function toolsArraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function quoteYaml(value: string): string {
  if (/[:#&*!|>{}[\],?\-'"`%@\\\n]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

/**
 * Hashes a string deterministically for content-equality checks across
 * record calls. Currently unused outside tests but exported so suites can
 * reuse the exact comparison logic when needed.
 *
 * @param content - String to hash
 * @returns Hex SHA-256 digest
 */
export function contentDigest(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * A line-level diff between two texts, via the classic LCS dynamic program.
 * Lines common to both are `context`; lines only in the old text are
 * `remove`; lines only in the new text are `add`. Deterministic and
 * dependency-free — enough to show what changed between two skill versions
 * without pulling in a diff library.
 *
 * @param before - The old content
 * @param after - The new content
 * @returns The ordered hunks
 */
function diffLines(before: string, after: string): DiffHunk[] {
  const a = before.length === 0 ? [] : before.split('\n');
  const b = after.length === 0 ? [] : after.split('\n');
  const n = a.length;
  const m = b.length;
  const width = m + 1;

  // lcs[i*width + j] = length of the longest common subsequence of a[i:]
  // and b[j:]. A flat typed array so every index is defined (no
  // undefined-index noise) and the walk below reads cleanly.
  const lcs = new Int32Array((n + 1) * width);
  const at = (i: number, j: number): number => lcs[i * width + j] as number;
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  const hunks: DiffHunk[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const ai = a[i] as string;
    const bj = b[j] as string;
    if (ai === bj) {
      hunks.push({ kind: 'context', text: ai });
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      hunks.push({ kind: 'remove', text: ai });
      i += 1;
    } else {
      hunks.push({ kind: 'add', text: bj });
      j += 1;
    }
  }
  while (i < n) {
    hunks.push({ kind: 'remove', text: a[i] as string });
    i += 1;
  }
  while (j < m) {
    hunks.push({ kind: 'add', text: b[j] as string });
    j += 1;
  }
  return hunks;
}
