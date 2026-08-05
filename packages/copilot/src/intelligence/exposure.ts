/**
 * exposure: which records hold something shaped like a credential — and never
 * what it is.
 *
 * The content door defends what ARRIVES. It cannot defend what is already there,
 * and every record written before it existed was written with no defense at all.
 * In a public tree that past is what decides the damage, because it is committed
 * and it clones, so the question "what is already in here?" has to be answerable
 * without opening every record by hand.
 *
 * IT REPORTS WHERE, NEVER WHAT. Each finding carries the record's id, its kind,
 * the tree it lives in, when it was written and the CLASS of credential found —
 * and no part of the value, not truncated and not partly masked. A report that
 * listed credentials would turn the remedy into a second disclosure: into a CI
 * log, a terminal scrollback, a screenshot, a pasted bug report. That is enforced
 * by the shape rather than by discipline — the detector this calls returns classes
 * and nothing else (see `detectSecrets`), so there is no value here to print even
 * by accident, in the human summary or in the JSON.
 *
 * IT SCANS THE WHOLE EVENT GENERICALLY. Every string anywhere in an event —
 * envelope and payload alike — goes through the detector, rather than a per-kind
 * list of the fields that hold text. Two reasons, and the second is the one that
 * matters: a transition's proof lives in a nested `fields` object that no
 * projection exposes whole, so a field-by-field reader would miss exactly the
 * notes and reasons a person types fastest; and a new kind of event is covered the
 * day it is added, with nobody having to remember this file exists.
 *
 * THE ENVELOPE IS IN THE SWEEP, and leaving it out was a hole rather than a
 * saving. `which` — the executing agent — is one of the two envelope fields a
 * caller supplies (the other is the pinned `run`, an id by contract that no write
 * operation proves), and a payload-only scan answered "nothing recognizable" about
 * a record whose envelope held a credential on disk. That is the exact failure the audit exists
 * to prevent, one level up: not a record written unprotected, but the report
 * declaring it clean. The other envelope fields cost nothing to include — an
 * anchor, a fingerprint, a v7 id and an ISO instant match no known-prefix pattern,
 * which the known-prefix rule is precisely what makes safe (an entropy rule would
 * have flagged all of them, which is why there is none).
 *
 * WHAT IT FINDS AND WHAT IT DOES NOT are the detector's, exactly: recognized
 * formats, and nothing else. A password in prose or a proprietary token is not
 * here, and an empty report means "nothing recognizable", never "nothing".
 *
 * It reads the raw event stream rather than the projections, for the reason the
 * other intelligence reads do: the question is about the FACTS as written, and a
 * projection keeps the current state rather than the text of every event.
 *
 * ## One record, or every project of a workspace
 *
 * {@link exposure} folds whatever it is given into one report — the answer when the
 * trees are one record. {@link workspaceExposure} is the same fold over the trees of
 * every project, and it splits the answer the way the SHAPE of each half demands:
 * the findings MERGE, each labelled with the project to rotate in, and the
 * denominator DECOMPOSES, one count per record. Both call one fold, so a single
 * report and one entry of a decomposition cannot come to disagree.
 */

import { detectSecrets, type Scope, type SecretClass } from '@mnema/core';
import type { CatalogEvent } from './events.js';

/** One tree's events, and which tree they are — the scope every finding carries. */
export interface ScopedEvents {
  /** The tree these events were read from. */
  readonly scope: Scope;
  /**
   * The PROJECT that tree belongs to, when it belongs to one — the directory whose
   * credentials a finding tells someone to rotate.
   *
   * Absent for the machine-global tree, and that absence is the fact rather than a
   * gap: the global tree belongs to no project and is the same tree for all of
   * them, so naming whichever project a read reached it through would say "rotate
   * this here" about a codebase that never held the value.
   */
  readonly project?: string;
  /** The tree's events, in the order the chain proves. */
  readonly events: readonly CatalogEvent[];
}

/** One record that holds something shaped like a credential. */
export interface ExposedRecord {
  /** The event's subject — the entity to look up, or the fact's own id. */
  readonly id: string;
  /** What kind of event it is (`memory.captured`, `task.transitioned`, …). */
  readonly kind: string;
  /** The tree it lives in — a public one is committed and clones. */
  readonly scope: Scope;
  /**
   * The project whose tree holds it — WHERE to rotate, which is the point of the
   * whole report. Absent for the machine-global tree (see {@link
   * ScopedEvents.project}), and absent throughout when the sources are one record
   * and there is no other project to tell it from.
   *
   * Across projects the scope alone cannot answer: three repositories all have a
   * `public` tree, and a finding that said only `public` would name a role three
   * codebases share while a person needs the one to go and change a key in.
   */
  readonly project?: string;
  /** When it was written. */
  readonly at: string;
  /**
   * The classes found in it, distinct and sorted. NOT the values, and there is no
   * field here that could carry one.
   */
  readonly classes: readonly SecretClass[];
}

/** What the record holds, as a report a person can act on. */
export interface Exposure {
  /** The records that hold something, oldest first. Empty when none do. */
  readonly findings: readonly ExposedRecord[];
  /** How many events were read to answer — the denominator of the report. */
  readonly scanned: number;
}

/** How much of ONE record was read, and which record it is. */
export interface ProjectScan {
  /**
   * The project whose trees were read — absent for the machine-global tree, which
   * belongs to no project and is the same tree for all of them.
   */
  readonly project?: string;
  /** How many of its events were read — this record's denominator. */
  readonly scanned: number;
}

/** What a whole workspace holds: the findings merged, the denominators apart. */
export interface WorkspaceExposure {
  /**
   * Every record that holds something, across every project, oldest first — each
   * labelled with the project to rotate in. Empty when none do.
   *
   * MERGED, because a finding is an item: widening the search adds to the list and
   * changes nothing already in it. A report scoped to one project of a workspace
   * says "nothing recognizable" in the words it would use if that project were the
   * world, and the value it did not mention is on the same disk.
   */
  readonly findings: readonly ExposedRecord[];
  /**
   * How much was read, ONE COUNT PER RECORD: each project of the workspace, and the
   * machine-global tree. A record that held nothing is still HERE, at its count —
   * which is what makes an empty `findings` readable as "these records were read and
   * hold nothing recognizable" rather than as "nothing is exposed".
   *
   * DECOMPOSED, because a denominator is an aggregate: summed, it answers "how much
   * of this workspace was read" under the name of "how much of this record was read",
   * and a reader who divides by it is dividing by the wrong number. There is
   * deliberately no total beside the entries; adding them is the reader's act.
   */
  readonly scanned: readonly ProjectScan[];
}

/**
 * Scans every event of every tree handed in and reports the records that hold a
 * recognized credential format — ONE report over whatever it is given, which is the
 * right answer when the sources are one record (a project's trees, or a single tree).
 *
 * The order is oldest first, then by id: the oldest exposure is the one that has
 * had the longest to travel, so it is the one to rotate first. Pure — it folds the
 * streams it is given and reads nothing else.
 *
 * Given the trees of several PROJECTS its denominator would count a workspace under
 * the name of a record — {@link workspaceExposure} is that read.
 */
export function exposure(sources: readonly ScopedEvents[]): Exposure {
  const { findings, scans } = fold(sources);
  return { findings, scanned: scans.reduce((total, scan) => total + scan.scanned, 0) };
}

/**
 * The same scan over the trees of EVERY project a workspace holds: the findings in
 * one list, each saying which project to rotate in, and the denominator as one count
 * per record.
 *
 * This is the read the defect asked for. The content door screens what arrives and it
 * is scoped to a project, so a session that adopted one project of three defended
 * that one — while the record of the other two sat on the same disk, written before
 * the door existed or imported from elsewhere. Asked "is a credential already
 * recorded?", this answered about the adopted project and said `scanned: 300` beside
 * it, which reads as a search that covered the ground.
 *
 * It does NOT stop a leak, and no text here should suggest it does. The record is the
 * record: a search or a read of a neighbouring project serves the raw value, as it
 * always did, because that is what those reads are for. What this changes is that the
 * WARNING now reaches as far as the service does — the read that would say "rotate
 * this" stops being the only one that halts at a project boundary.
 *
 * The two halves split by the shape of what they carry, which is the same rule the
 * other workspace-spanning reads follow: items merge, aggregates decompose. Both
 * halves come out of the same fold as {@link exposure}, so the report a single record
 * gets and its entry here cannot disagree about a count.
 */
export function workspaceExposure(sources: readonly ScopedEvents[]): WorkspaceExposure {
  const { findings, scans } = fold(sources);
  return { findings, scanned: scans };
}

/**
 * The one fold: every stream swept for classes, the findings collected and ordered,
 * the events counted per record.
 *
 * Both reads above call THIS. A record contributes its count even when it holds
 * nothing — an entry missing from the decomposition would be indistinguishable from a
 * tree the read never opened, and this read exists to be trusted about where it
 * looked.
 */
function fold(sources: readonly ScopedEvents[]): {
  findings: ExposedRecord[];
  scans: ProjectScan[];
} {
  const findings: ExposedRecord[] = [];
  const counts = new Map<string | undefined, number>();

  for (const source of sources) {
    counts.set(source.project, (counts.get(source.project) ?? 0) + source.events.length);
    for (const event of source.events) {
      const classes = classesIn(event);
      if (classes.length === 0) continue;
      findings.push({
        id: event.subject,
        kind: event.kind,
        scope: source.scope,
        ...(source.project !== undefined ? { project: source.project } : {}),
        at: event.at,
        classes,
      });
    }
  }

  findings.sort(oldestFirst);
  const scans = [...counts.entries()]
    .map(([project, scanned]) => ({ ...(project !== undefined ? { project } : {}), scanned }))
    .sort(projectlessLast);
  return { findings, scans };
}

/**
 * Findings oldest first, then by id, then by tree, then by project — a TOTAL order,
 * so two calls over the same record answer in the same order whatever order the trees
 * were read in.
 *
 * Totality is worth the two extra keys here rather than left to a stable sort: an id
 * is a SUBJECT, not the event's own id, so one entity written twice in the same
 * instant is a real tie, and this answer goes into the prefix of an agent's prompt,
 * where a list that reshuffles between two identical calls reads as a record that
 * changed.
 */
function oldestFirst(a: ExposedRecord, b: ExposedRecord): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  const byId = compare(a.id, b.id);
  if (byId !== 0) return byId;
  const byScope = compare(a.scope, b.scope);
  if (byScope !== 0) return byScope;
  return compare(a.project ?? '', b.project ?? '');
}

/** Keeps the projectless record after the projects, leaving their order untouched. */
function projectlessLast(a: ProjectScan, b: ProjectScan): number {
  if (a.project === b.project) return 0;
  if (a.project === undefined) return 1;
  if (b.project === undefined) return -1;
  return 0;
}

/**
 * The distinct classes found anywhere in an event, sorted. Walks strings, arrays
 * and nested objects alike, so a proof field inside `fields` is reached without
 * this function knowing that `fields` exists — and so is the envelope's `which`,
 * without this function knowing there is an envelope.
 */
function classesIn(event: unknown): SecretClass[] {
  const found = new Set<SecretClass>();
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const secret of detectSecrets(value)) found.add(secret);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const item of Object.values(value)) walk(item);
    }
  };
  walk(event);
  return [...found].sort(compare);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
