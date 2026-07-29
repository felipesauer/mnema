/**
 * Where a write goes: which project, and which of its trees.
 *
 * A workspace holds several projects and a conversation is regularly work in more
 * than one of them — a product being migrated into its successor, a fix made in one
 * codebase and normalized into two others. The cascade picks ONE of them for the
 * session ({@link resolveContext}), and until a write could name another, everything
 * a connection recorded landed there: the work done in the second and third projects
 * was written into the first, in a record that then says it happened somewhere it
 * did not. Nothing marks such a fact afterwards — no field of an event names a
 * project — so it is not a defect a reader can find and undo later.
 *
 * So a write says where it belongs, and this is the one function that answers it.
 * Two questions, and they are asked together because they are the same question:
 *
 *   1. WHICH PROJECT. The `project` argument, matched against the projects the
 *      client announced ({@link Session.workspaceProjects}). Absent, the answer is
 *      the session's own — the cascade's choice, unchanged, which is what makes a
 *      caller that says nothing behave exactly as it did before the argument
 *      existed.
 *   2. WHICH TREE inside it. The `scope` argument over that project's default, the
 *      per-action scope model applied to whichever project the write landed in.
 *
 * One function, called once by every write verb, because this is a rule that has to
 * hold at ten call sites and a rule spelled out ten times is a rule that holds at
 * nine. It returns the destination or a refusal, never throwing: a name it cannot
 * resolve is an answer, and the caller shapes it into the same tool error every
 * other refused write already produces.
 *
 * ## What it refuses, and why refusing is the safe side
 *
 * A name that matches nothing, and a name that matches TWO projects. The second is
 * the ordinary shape of a real workspace rather than a corner: two checkouts with
 * the same directory name — `~/work/api` beside `~/side/api` — is what a person
 * doing exactly the work this exists for tends to have open. Guessing between them
 * writes the fact into the wrong repository and reports success, which is the defect
 * this module exists to remove, one level down. Refusing costs the caller one round
 * trip and a longer argument; the refusal names every project it could have meant,
 * so the second attempt is unambiguous.
 *
 * Both sentences live here, beside the rule, for the reason {@link locate.js} keeps
 * its own: a refusal is a statement about the search, and every caller that asks
 * this question must give the same account of it.
 */

import { basename, isAbsolute, resolve } from 'node:path';
import { chainRootForScope, type Scope } from '@mnema/core';
import { oneLine } from '../served-patterns.js';
import type { WorkspaceProject } from './context.js';
import type { Session, WriteTarget } from './session.js';

/** Where a write is going, or why the caller's `project` could not be honored. */
export type WriteRoute =
  | {
      readonly ok: true;
      /** The scope the write lands in: the caller's, else the destination's default. */
      readonly scope: Scope;
      /**
       * The project the write was routed to, ABSENT when it goes to the session's
       * own trees. Absent rather than filled in with the session's project, so that
       * "the caller named a destination" stays distinguishable from "the caller said
       * nothing" all the way to the door — {@link openWrite} reads the session's own
       * trees for the second case, and there is exactly one place that decides it.
       */
      readonly target?: WriteTarget;
    }
  | {
      readonly ok: false;
      /**
       * `UNKNOWN_PROJECT` (no project of this workspace goes by that name),
       * `AMBIGUOUS_PROJECT` (more than one does), or `SCOPE_UNAVAILABLE` (the scope
       * names a tree the destination does not have).
       */
      readonly code: string;
      /** The human-readable reason, one line. */
      readonly message: string;
    };

/**
 * Resolves a write's destination: the project the caller named (or the session's
 * own), and the scope inside it.
 *
 * The order is deliberate — the project first, then the scope over it. A scope is
 * only available or not with respect to a tree set, so checking it before the
 * project is known would check it against the wrong one: `public` is unavailable in
 * a session that landed outside a project and perfectly available in the project
 * that session's caller just named.
 */
export function routeWrite(
  session: Session,
  input: { readonly scope?: Scope | undefined; readonly project?: string | undefined },
): WriteRoute {
  let target: WriteTarget | undefined;
  if (input.project !== undefined) {
    const picked = pickProject(session, input.project);
    if (!picked.ok) return picked;
    target = picked.target;
  }

  const scope = input.scope ?? target?.scope ?? session.scope;
  const trees = target?.trees ?? session.trees;
  // A caller's scope may name a tree this destination does not have — `public` in a
  // session with no project. Refuse as data rather than throwing, so the server
  // shapes it into a tool error and the agent sees the write did not happen. A
  // destination's own default always resolves, so an omitted scope never hits this.
  if (chainRootForScope(trees, scope) === undefined) {
    return {
      ok: false,
      code: 'SCOPE_UNAVAILABLE',
      message: `no ${scope} tree here — a session outside a project has only the global scope`,
    };
  }
  return { ok: true, scope, ...(target !== undefined ? { target } : {}) };
}

/** The project a name picks out of the workspace, or why it picks none. */
type Picked =
  | { readonly ok: true; readonly target: WriteTarget }
  | { readonly ok: false; readonly code: string; readonly message: string };

/**
 * The project a `project` argument names, by TWO spellings — the whole path, or the
 * directory's own name.
 *
 * The path is the exact answer and is checked first: it is what the session reports
 * about itself (the opening read names the projects by path), so a caller echoing
 * back what it was told always resolves, and a path cannot be ambiguous because two
 * projects cannot be one directory. The bare name is the convenient one, and it is
 * what an agent has when a person says "record that in nferural" — so it is
 * accepted, and refused when it fits more than one project.
 *
 * A path counts as a path only when it is ABSOLUTE, and that is not fussiness. This
 * server's working directory is whatever the host spawned it with and has nothing to
 * do with the projects — the module this list comes from exists because of that. So
 * resolving a relative argument against the process's cwd would sometimes produce a
 * real project's path by accident, and the accident is precisely the case the bare
 * name refuses: a workspace with two `api` directories where `api` resolved against
 * one parent silently picks that one. A relative path therefore falls through to the
 * name match, which does not find it, and the refusal shows the caller both
 * spellings it could have used.
 *
 * A path is matched WHOLE and never walked up. The cascade walks up — a package of a
 * monorepo is a place to work — and this deliberately does not: adopting a nearby
 * project for an argument that missed is how a write lands in a project nobody named,
 * and every path this could walk up from is a path the caller can spell exactly. The
 * refusal names the projects, so a subdirectory earns a list rather than a guess.
 */
function pickProject(session: Session, name: string): Picked {
  const projects = session.workspaceProjects;
  if (isAbsolute(name)) {
    // `resolve` so a trailing slash, a `.` or a `..` still matches the one spelling
    // the list holds — the same directory, written two ways.
    const wanted = resolve(name);
    const found = projects.find((project) => project.dir === wanted);
    if (found !== undefined) return { ok: true, target: found };
    return { ok: false, code: 'UNKNOWN_PROJECT', message: noSuchProject(name, projects) };
  }

  const matches = projects.filter((project) => basename(project.dir) === name);
  const only = matches[0];
  if (only !== undefined && matches.length === 1) return { ok: true, target: only };
  if (matches.length > 1) {
    return { ok: false, code: 'AMBIGUOUS_PROJECT', message: severalProjects(name, matches) };
  }
  return { ok: false, code: 'UNKNOWN_PROJECT', message: noSuchProject(name, projects) };
}

/**
 * What a refusal says when no project of this workspace goes by that name: the ones
 * that do, in full.
 *
 * Naming them is the whole value of the sentence. The caller passed a name because
 * it believes the work belongs somewhere other than where the session landed, and it
 * is right about that; what it got wrong is a spelling. A refusal that only said "not
 * a project" would leave it with one move — omit the argument — which puts the fact
 * back in the project the name was passed to avoid.
 */
function noSuchProject(name: string, projects: readonly WriteTarget[]): string {
  if (projects.length === 0) {
    return (
      `project "${oneLine(name)}" is not a project this session can write to — this ` +
      'session resolved to no project, so there is none to name'
    );
  }
  return (
    `project "${oneLine(name)}" is not a project this session can write to — these are, ` +
    `by full path or by the directory name at its end: ${namedProjects(projects)}`
  );
}

/**
 * What a refusal says when a name fits more than one project: which ones, and that
 * the full path settles it.
 *
 * It says how to succeed rather than only what went wrong, because the caller cannot
 * derive it: from where the agent stands, the name it used is the name of the project
 * — that two directories share it is a fact about the person's disk that only this
 * session can see.
 */
function severalProjects(name: string, matches: readonly WriteTarget[]): string {
  return (
    `project "${oneLine(name)}" names ${matches.length} of this workspace's projects — ` +
    `${namedProjects(matches)} — so it does not say which; pass the full path of the one meant`
  );
}

/**
 * The projects' paths, quoted, on one line — the ONE spelling of this list, shared
 * by the refusals here and by the sentence the opening read tells the agent.
 *
 * Shared because the two are read together: an agent is told the list, passes one of
 * the names back, and reads the refusal when it does not fit. Two spellings of one
 * list would make the same project look like two different things across the two
 * messages.
 *
 * Quoted so the boundary between two paths stays visible: a directory name may hold
 * a comma, and an unquoted list would then read as one more project than there are.
 * And each through {@link oneLine}, for the reason every refusal is one line — a
 * directory name may hold a newline, and the second half of a broken refusal has the
 * shape of a whole refusal about something nobody asked.
 */
export function namedProjects(projects: readonly WorkspaceProject[]): string {
  return projects.map((project) => `"${oneLine(project.dir)}"`).join(', ');
}
