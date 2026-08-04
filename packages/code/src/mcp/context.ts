/**
 * Resolving the tree a stdio MCP server operates on.
 *
 * A CLI command has an obvious working directory; a server does not — the host
 * spawns it with an arbitrary cwd, so the project cannot be read off `cwd` the
 * way `mnema init` reads it. The project is discovered from the client instead,
 * in a fixed cascade from most explicit to fallback:
 *
 *   1. an explicit project path (`mnema mcp --project`), if the operator named one.
 *      It is the one rung that can REFUSE rather than fall through to the next —
 *      see {@link configuredProject};
 *   2. the client's workspace `roots` — the first root that resolves to a
 *      project (has a `.mnema/`), walked up from that root's directory;
 *   3. GLOBAL — with no configured path and no project among the roots, the
 *      server does NOT guess a project at some cwd (only `mnema init` may create
 *      a `.mnema/`). It operates on the global tree. This is not a limbo; the
 *      global tree is legitimate cross-project knowledge. It never refuses.
 *
 * Rungs 2 and 3 never refuse and rung 1 does, and the asymmetry is the whole of
 * what an operator can rely on here. An unmatched CASCADE is a legitimate global
 * session: nobody said which project, so landing outside one is an answer. An
 * operator NAMING a project that does not exist is not — it is a statement about
 * the world that is false, and the two possible behaviours are to say so or to serve
 * some other project in silence. The second is the defect this rung exists to close:
 * a session that answered about a project nobody asked for, in a reply indistinguishable
 * from an answer about the right one, and the emptiness of that record read as
 * "nothing was decided here".
 *
 * It also answers a second question the cascade alone cannot: WHICH OTHER projects
 * the workspace holds. The cascade returns at the first root that resolves, so it
 * learns of exactly one — and one project and five look identical from inside the
 * session that landed. So every root is probed, and the projects among them are
 * collected by a rule of their own (a root counts when it IS a project's root, never
 * when one lies above it — see {@link announcedProjects}). The list changes nothing
 * about WHERE the session lands: that stays the cascade's, and omitting it stays the
 * cascade's answer. It is reported for two things a reader and a caller each need —
 * a reader can tell that where it landed was a choice, and a caller can NAME one of
 * the others, which is the only way work done in a second project can be recorded
 * in that project instead of in whichever one the cascade happened to pick.
 *
 * This module is pure: it takes the already-listed roots (the server does the
 * protocol call) and returns which trees to work on. WHICH of them a write lands in is
 * not decided here; that is the core's routing rule ({@link resolveScope}), applied at
 * the write, where the KIND is known. This decides only which PROJECT — never
 * public/private.
 */

import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DiscoveryEnv, type ResolvedTrees, resolveTrees } from '@mnema/core';
import { oneLine } from '../served-patterns.js';

/**
 * One project the session knows the workspace holds, with the trees it resolves to.
 *
 * The trees come with the directory rather than being re-resolved later, because
 * they were already computed to answer whether the directory is a project at all:
 * a probe that found a `.mnema/` has the whole tree set in hand, and discarding it
 * would mean walking the filesystem again to learn what this already knows.
 */
export interface WorkspaceProject {
  /**
   * The project DIRECTORY — the parent of its `.mnema/`, absolute.
   *
   * Absolute because it is compared against what a caller passes, and a comparison
   * between two spellings of one path is a comparison that fails on the same
   * directory. A root arrives as the client spelled it and a configured path as the
   * operator wrote it, so the spelling is settled here, once, rather than at each
   * place that matches against it.
   */
  readonly dir: string;
  /** The trees resolved FOR it: its two project scopes, and the global tree beside them. */
  readonly trees: ResolvedTrees;
}

/** What the server hands the resolver — the raw discovery inputs. */
export interface ContextInput {
  /**
   * An explicit project directory the server was configured with, if any — what
   * `mnema mcp --project` carries. The strongest signal: the operator named the
   * exact project.
   *
   * It must be ABSOLUTE and it must resolve to a project; neither is a preference.
   * See {@link configuredProject} for both, and for why a value that fails either
   * is refused rather than passed over.
   */
  readonly configProject?: string | undefined;
  /**
   * The client's workspace roots as `file://` URIs (from `roots/list`). Empty
   * when the client declares no `roots` capability or opened no workspace.
   */
  readonly roots?: readonly string[] | undefined;
  /** The discovery environment (XDG/home), for the global tree and identity. */
  readonly env: DiscoveryEnv;
}

/** The tree the session works on, and whether it landed in a project. */
export interface ResolvedContext {
  /** The three trees resolved for the chosen directory (project or global). */
  readonly trees: ResolvedTrees;
  /**
   * Whether a project was found. True → both project trees are present and a write
   * goes to whichever of them its KIND names; false → there is no project and
   * everything works on the global tree, the only one there is.
   */
  readonly inProject: boolean;
  /**
   * The project DIRECTORY this landed on — the parent of its `.mnema/` — absent
   * when it landed on the global tree.
   *
   * It is reported because a cascade nobody can see is a cascade nobody can
   * debug. Three inputs can each point somewhere (a configured path, several
   * workspace roots, neither), the rule walks UP from whichever it takes, and the
   * project it arrives at is frequently not the directory the host named: a folder
   * opened inside another repository resolves to that repository. Every step is
   * defensible and the result can still be a surprise, so the session carries the
   * answer and says it out loud rather than leaving the reader to re-derive it.
   */
  readonly project?: string;
  /**
   * The DISTINCT projects this session knows the workspace holds — the one above
   * among them, always.
   *
   * Naming the project a session landed on answers "where am I"; it does not
   * answer "was there anywhere else it could have been", and that is the question
   * behind every surprise the cascade produces. One project and three are the
   * same session from the inside, so the others are carried alongside the name: a
   * reader who knows there were three can tell that the one they got was a choice,
   * and a caller who knows their directories can name the one the work is actually
   * happening in.
   *
   * Collected by the ROOT rule — see {@link announcedProjects}. It is a FACT about
   * the workspace and is reported as one: nothing here or downstream reads it as
   * a warning, because a signal that fires in every multi-folder workspace stops
   * being read, and which project is the right one is not this server's to say.
   *
   * In the order the client announced the roots, with the project the session
   * landed on last when no root announced it (it is in the list either way — the
   * session writes there). The order is the host's and is not improved on: this
   * server has no ranking of its own to impose, and the list is read as a list —
   * every reader of it either matches a name against the whole thing or prints it.
   */
  readonly workspaceProjects: readonly WorkspaceProject[];
}

/** One announced root, paired with what the topology rule resolves it to. */
interface ProbedRoot {
  /** The root's filesystem path, as the client announced it. */
  readonly dir: string;
  /** The trees that resolve FROM it (project scopes absent when it is in none). */
  readonly trees: ResolvedTrees;
}

/**
 * Resolves the tree the session operates on, following the cascade above. It
 * probes the explicit path first, then each root in order, taking the first
 * that resolves to a project; failing all, it falls back to the global tree
 * resolved from the environment (the same `ResolvedTrees` shape, with the
 * project scopes simply absent).
 *
 * It never creates a `.mnema/`, and it refuses in exactly one case: an explicitly
 * configured project that is relative or is no project ({@link configuredProject},
 * which throws). An unmatched CASCADE is not that case and never refuses — nobody
 * named a project, so a global session is a legitimate answer.
 */
export function resolveContext(input: ContextInput): ResolvedContext {
  // EVERY root is probed, before the cascade picks one. The cascade returns at the
  // first root that resolves, so a session that only ran the cascade cannot say how
  // many projects the workspace holds — it stopped counting at one. That is the one
  // thing the cascade's answer can never tell a reader, and it is cheap: a probe is
  // a walk-up over already-listed paths, and the roots a host announces are few.
  const probed: ProbedRoot[] = [];
  for (const root of input.roots ?? []) {
    const dir = rootToPath(root);
    if (dir === undefined) continue;
    probed.push({ dir, trees: resolveTrees(dir, input.env) });
  }

  // 1. An explicit project path wins — or refuses. It never falls through.
  if (input.configProject !== undefined) {
    return landedInProject(configuredProject(input.configProject, input.env), probed);
  }

  // 2. The first workspace root that resolves to a project.
  for (const { trees } of probed) {
    if (trees.projectPublic !== undefined) return landedInProject(trees, probed);
  }

  // 3. Fallback: the GLOBAL tree, deliberately with NO project. `resolveTrees`
  // always returns `global` + `keyRoot` regardless of where it resolves from,
  // so we take exactly those two and drop any project scopes a walk-up might
  // have found — the server must never adopt a project the client did not point
  // at (a stray `.mnema/` above home would otherwise leak in).
  const { global, keyRoot } = resolveTrees(input.env.home, input.env);
  return {
    trees: { global, keyRoot },
    inProject: false,
    workspaceProjects: announcedProjects(probed),
  };
}

/**
 * The trees an explicitly configured project resolves to — or a refusal, which is
 * the whole point of this function existing beside {@link resolveTrees}.
 *
 * ## It must be ABSOLUTE
 *
 * A relative path is refused before it is resolved, rather than taken against this
 * process's working directory. That directory is whatever the host spawned the
 * server with; it is not the operator's shell, and it is not visible from where the
 * value is written. A configured path is written ONCE, into a file, and read by a
 * process nobody watches start — so `./repo` would resolve against a directory the
 * person who wrote it never saw, and would land somewhere different the day the host
 * changed how it spawns. This whole module exists because a server has no cwd worth
 * trusting, and honouring a relative path here would bring that back.
 *
 * Refusing is also the only honest option: a relative path CAN resolve to a real
 * project by accident, and the accident is silent. `resolve` is then applied to what
 * survives, so the walk-up is given ONE spelling of the directory whatever the
 * operator typed — a trailing slash, a `.`, a `..`. It is belt and braces rather
 * than what makes those spellings work: the walk-up joins each candidate and `join`
 * normalizes as well. It is here so the value handed on is settled at the door,
 * rather than by whichever step below happens to normalize it today.
 *
 * ## It must BE a project
 *
 * A path that resolves to no project is refused, and NOT passed over to the roots.
 * Falling through is what produced this rung's requirement: the operator said which
 * project, the value did not resolve, and the session opened somewhere else — an
 * answer about a record nobody asked about, which reads exactly like an answer about
 * the right one. "I named the project and you served another in silence" is the
 * defect; continuing the cascade IS that defect.
 *
 * Both refusals are shaped for the one person who can act on them: they name the
 * value as it was configured (the string to go and find), say which of the two rules
 * it broke, and say what to do — because the operator is reading this in a host's log
 * with no other account of what happened. The value is collapsed to one line: a
 * directory may hold a newline, and a refusal is a one-item list whose second half
 * would look like a refusal of its own.
 *
 * It THROWS rather than returning a refusal, because there is no honest session to
 * return: the server's caller ({@link openSession}) already fails this way when the
 * anchor is unanswerable, the session never opens, and every tool call on the
 * connection reports the same sentence instead of answering out of the wrong record.
 * Nothing has been written when it fires — the trees are resolved before the anchor
 * is read, which is the first thing that touches disk.
 */
function configuredProject(configured: string, env: DiscoveryEnv): ResolvedTrees {
  if (!isAbsolute(configured)) {
    throw new Error(
      oneLine(
        `the configured project "${configured}" is not an absolute path. This server's ` +
          'working directory is whatever the host spawned it with, so a relative path ' +
          'would resolve against a directory nobody chose — pass the full path of the ' +
          'project to serve to `mnema mcp --project`, or drop the flag to take the ' +
          "project from the host's workspace roots.",
      ),
    );
  }
  const trees = resolveTrees(resolve(configured), env);
  if (trees.projectPublic === undefined) {
    throw new Error(
      oneLine(
        `the configured project "${configured}" is not a project: no \`.mnema/\` is ` +
          'there or in any directory above it. This server was told which project to ' +
          'serve and will not serve another instead — point `mnema mcp --project` at a ' +
          'directory `mnema init` has been run in, or drop the flag to take the project ' +
          "from the host's workspace roots.",
      ),
    );
  }
  return trees;
}

/**
 * The context for a cascade that landed on a project: the trees, the project's
 * directory, and the projects the workspace holds counting this one.
 *
 * The project is the parent of the `.mnema/` the walk-up FOUND, never the path
 * that was pointed at: a subdirectory of a project resolves to the project, and
 * reporting the input would name a directory that owns nothing.
 */
function landedInProject(trees: ResolvedTrees, probed: readonly ProbedRoot[]): ResolvedContext {
  const project = projectDirOf(trees);
  const workspaceProjects = announcedProjects(probed);
  // The project this session landed on belongs in the list even when no root
  // announced it as its own — which is the common shape, not the corner: the
  // walk-up regularly arrives at a project ABOVE every root (a folder opened
  // inside a repository), and a configured path need not be among the roots at
  // all. Including it is what stops the list contradicting the name beside it,
  // and it is not an exception to the root rule: this directory holds the
  // `.mnema/` the session is writing to.
  if (!workspaceProjects.some((known) => known.dir === project)) {
    workspaceProjects.push({ dir: project, trees });
  }
  return { trees, inProject: true, project, workspaceProjects };
}

/**
 * The distinct projects the announced roots name, by the ROOT rule: a root counts
 * when it IS a project's root, and not when a project merely lies somewhere above
 * it.
 *
 * The rule is here and not in the cascade because collecting and RESOLVING are
 * different questions. Resolution walks up, and must: a package of a monorepo is
 * a place to work, and refusing to walk would put that work in the machine-global
 * tree instead of the project. Collecting must not, because the walk-up makes every
 * folder inside a project look like one: a notes directory checked out inside
 * another repository would appear as a project of its own, and the list would name
 * two where the workspace has one. A list that inflates is worse than no list —
 * it is a fact the reader cannot check, and a name a caller could route a write to
 * that names no project anybody opened.
 *
 * Distinct by directory, so two roots that resolve to the same project appear once
 * (two folders of one monorepo, or the same path announced twice), keeping the
 * order the client announced them in.
 */
function announcedProjects(probed: readonly ProbedRoot[]): WorkspaceProject[] {
  const projects: WorkspaceProject[] = [];
  for (const { dir, trees } of probed) {
    if (trees.projectPublic === undefined) continue;
    const project = projectDirOf(trees);
    // `resolve` so a root announced with a trailing slash still matches the
    // directory `dirname` reports — the same path, spelled two ways.
    if (project !== resolve(dir)) continue;
    if (projects.some((known) => known.dir === project)) continue;
    projects.push({ dir: project, trees });
  }
  return projects;
}

/**
 * The project directory a tree set belongs to: the parent of its public tree,
 * absolute.
 *
 * One function because the directory is derived at three places and compared
 * across them — the list, the cascade's answer, and a caller's argument — and two
 * of those comparisons are for equality. A `dirname` that kept a relative
 * configured path would make the same project unequal to itself depending on which
 * rung produced it. Callers must have established that the public tree is present.
 */
function projectDirOf(trees: ResolvedTrees): string {
  return resolve(dirname(trees.projectPublic as string));
}

/**
 * Turns a `file://` root URI into a filesystem path, or undefined for a
 * non-file URI (a client may expose non-file roots the server cannot resolve).
 */
function rootToPath(root: string): string | undefined {
  try {
    return root.startsWith('file://') ? fileURLToPath(root) : undefined;
  } catch {
    return undefined;
  }
}
