/**
 * WHERE THE `project` OF AN ANSWER IS SAID BY NAME — one function per tool, one line per
 * position.
 *
 * The seven tools that name a project in their answer do so in ten places. Each is
 * renamed here, on the typed answer, by position. A generic pass over any key called
 * `project` is wrong on purpose: it would descend into the timeline's `event`, the signed
 * payload, and serve a future kind's own `project` field altered. A position forgotten
 * here fails benignly — it serves the path, which every write still accepts.
 *
 * What the name is, and why a write takes it back, is {@link nameOfProject}.
 */

import type {
  RecordBody,
  RecordSearch,
  ReferenceGraph,
  TimelineEntry,
  WorkspaceAccountability,
  WorkspaceAntipatterns,
  WorkspaceExposure,
} from '@mnema/context';
import { nameOfProject } from './route.js';
import type { Session } from './session.js';

type Workspace = Pick<Session, 'workspaceProjects'>;

/** The same object with its `project`, when it has one, said by name. Key order unchanged. */
function named<T extends { readonly project?: string }>(workspace: Workspace, value: T): T {
  if (value.project === undefined) return value;
  return { ...value, project: nameOfProject(workspace, value.project) };
}

/** `search`: `hits[].project` and `hidden[].project`. */
export function searchNamed(workspace: Workspace, search: RecordSearch): RecordSearch {
  return {
    ...search,
    hits: search.hits.map((hit) => named(workspace, hit)),
    ...(search.hidden !== undefined
      ? { hidden: search.hidden.map((entry) => named(workspace, entry)) }
      : {}),
  };
}

/** `read_record`: `project`. */
export function recordNamed(workspace: Workspace, record: RecordBody): RecordBody {
  return named(workspace, record);
}

/** `audit_refs`: `nodes[].project` and `links[].project`. */
export function referencesNamed(workspace: Workspace, graph: ReferenceGraph): ReferenceGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => named(workspace, node)),
    links: graph.links.map((link) => named(workspace, link)),
  };
}

/** `audit_timeline`: `[].project`, one per entry — and never the `event` inside it. */
export function timelineNamed(
  workspace: Workspace,
  entries: readonly TimelineEntry[],
): readonly TimelineEntry[] {
  return entries.map((entry) => named(workspace, entry));
}

/** `audit_accountability`: `byProject[].project`. */
export function accountabilityNamed(
  workspace: Workspace,
  account: WorkspaceAccountability,
): WorkspaceAccountability {
  return { ...account, byProject: account.byProject.map((entry) => named(workspace, entry)) };
}

/** `audit_antipatterns`: `byProject[].project`. */
export function antipatternsNamed(
  workspace: Workspace,
  patterns: WorkspaceAntipatterns,
): WorkspaceAntipatterns {
  return { ...patterns, byProject: patterns.byProject.map((entry) => named(workspace, entry)) };
}

/** `audit_exposure`: `findings[].project` and `scanned[].project`. */
export function exposureNamed(workspace: Workspace, report: WorkspaceExposure): WorkspaceExposure {
  return {
    ...report,
    findings: report.findings.map((finding) => named(workspace, finding)),
    scanned: report.scanned.map((entry) => named(workspace, entry)),
  };
}
