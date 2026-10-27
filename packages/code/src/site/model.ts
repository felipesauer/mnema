/**
 * What the record page shows, as ONE pure function of the record's ordered events.
 *
 * `pageModel` takes the events of the public tree in the record's own order and returns the
 * decisions (each with the notes and the addresses that belong to it), the notes that belong to
 * no decision, the timeline and the counts. `mnema site` calls it on the machine that writes the
 * page. It reads no file and names no `node:` module, so the same function can run over the same
 * events somewhere else; nothing in it is worded for a reader (the page does that).
 *
 * THE RULES ARE THE PRODUCT'S, NOT RESTATED HERE. Whether a decision governs now is
 * `decisionDisposition`; the notes are what `projectKnowledge` and `projectObservations` serve
 * (the first writer of an id is the note's author, a retraction applies only by the identity that
 * wrote the note); the links are the ones that still stand (`projectLinks`); an `ADR-<n>` label two
 * decisions carry is `adrCollisions`'s to say. A copy of any of these in this file would be a
 * second reading of a rule that already has one.
 *
 * WHO DID IT IS WORDED ONE WAY. An act with no agent on its envelope is `A_PERSON`, the word
 * `mnema show` prints; with one it is `agent <which>`. The `which` is read off the EVENT (a
 * note's projection does not keep it). The page never says a name: the identity (`mnid:...`)
 * is what the record holds, and it is not one.
 *
 * Only decisions and the notes about them are modelled. A task, a handoff, a run, an event of a
 * key or an identity, and a pattern are not on the page; their lines are in the raw events, which
 * the page draws from the files it carries.
 */

import { ADDRESS_RELATIONS, type CatalogEvent, transitionProse } from '@mnema/chain';
import { decisionDisposition } from '@mnema/context';
import {
  adrCollisions,
  type DecisionState,
  type LinkEdge,
  projectDecisions,
  projectKnowledge,
  projectLinks,
  projectObservations,
} from '@mnema/core';
import { A_PERSON } from '../one-line.js';

/** One move a decision went through, as the record says it. */
export interface DecisionMove {
  readonly at: string;
  readonly action: string;
  readonly before: string | null;
  readonly to: string;
  readonly who: string;
  readonly which?: string;
  /** What the move said, as the record prints a proof; absent when it carried none. */
  readonly said?: string;
}

/** A note taken back, with when, by whom and why. The note itself is not changed by it. */
export interface NoteRetractionFacts {
  readonly at: string;
  readonly who: string;
  readonly which?: string;
  readonly reason: string;
}

/** An observation or a memory, with what the page shows of it. */
export interface PageNote {
  readonly id: string;
  readonly kind: 'observation' | 'memory';
  /** The topic of an observation; a memory has none. */
  readonly topic?: string;
  /** What an observation is about, as the record wrote it; a memory has none. */
  readonly about?: string;
  readonly text: string;
  readonly at: string;
  readonly who: string;
  readonly which?: string;
  readonly retracted?: NoteRetractionFacts;
}

/** A relation the record states from one thing to another, as written. */
export interface PageLink {
  readonly rel: string;
  readonly target: string;
}

/** A decision, with what the page shows of it. */
export interface PageDecision {
  readonly id: string;
  readonly adr: string;
  /** Whether the `ADR-<n>` label names this decision alone on the page, so it may be an anchor. */
  readonly adrIsUnique: boolean;
  readonly title: string;
  readonly rationale: string;
  readonly alternatives?: string;
  readonly state: string;
  /** Whether the record says it governs now (never decided here). */
  readonly inForce: boolean;
  readonly supersedes?: string;
  readonly supersededBy?: string;
  readonly createdAt: string;
  readonly recordedBy?: { readonly who: string; readonly which?: string };
  readonly acceptedBy?: { readonly who: string; readonly which?: string };
  readonly moves: readonly DecisionMove[];
  /** The notes that belong to it, in the record's order. */
  readonly notes: readonly PageNote[];
  /** The paths it is addressed at (`governs` and the other address relations), as written. */
  readonly addresses: readonly PageLink[];
  /** Every other relation that stands between it and something that is not one of its notes. */
  readonly linkedTo: readonly PageLink[];
}

/** One act in the record's order. */
export interface TimelineEntry {
  readonly kind: 'decision-recorded' | 'decision-moved' | 'note-recorded' | 'note-retracted';
  readonly at: string;
  readonly who: string;
  readonly which?: string;
  /** The id of what it is about: the decision's, or the note's. */
  readonly subject: string;
  /** The `ADR-<n>` label of a decision act. */
  readonly adr?: string;
  /** The action and the state it reached, for a move. */
  readonly action?: string;
  readonly to?: string;
  /** The topic of an observation. */
  readonly topic?: string;
}

/** What the page counts. */
export interface PageCounts {
  readonly decisions: number;
  readonly inForce: number;
  /** Notes shown: each once, whether it sits under a decision, under several, or alone. */
  readonly notes: number;
  readonly timeline: number;
}

/** Everything the page's lists are written from. */
export interface PageModel {
  readonly decisions: readonly PageDecision[];
  /** The notes that belong to no decision. */
  readonly otherNotes: readonly PageNote[];
  readonly timeline: readonly TimelineEntry[];
  readonly counts: PageCounts;
}

/** How an act is said: a person when no agent carried it out, otherwise the agent by name. */
export function actWording(which?: string): string {
  return which === undefined ? A_PERSON : `agent ${which}`;
}

const whichOf = (event: { readonly which?: string | undefined }): { which?: string } =>
  event.which !== undefined ? { which: event.which } : {};

/**
 * The notes the record serves, in the stream's order, each with the agent that wrote it. A
 * writing the projection did not apply (another identity writing an id that already had a
 * first writer) is not here; the one it applied is told by its author and its time.
 */
function notesOf(events: readonly CatalogEvent[]): PageNote[] {
  const memories = projectKnowledge(events);
  const observations = projectObservations(events);
  const notes: PageNote[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (event.kind === 'memory.captured') {
      const memory = memories.get(event.subject);
      if (
        memory === undefined ||
        memory.who !== event.who ||
        memory.capturedAt !== event.at ||
        seen.has(memory.id)
      ) {
        continue;
      }
      seen.add(memory.id);
      notes.push({
        id: memory.id,
        kind: 'memory',
        text: memory.content,
        at: memory.capturedAt,
        who: memory.who,
        ...whichOf(event),
        ...(memory.retracted !== undefined ? { retracted: memory.retracted } : {}),
      });
    } else if (event.kind === 'observation.recorded') {
      const observation = observations.get(event.subject);
      if (
        observation === undefined ||
        observation.who !== event.who ||
        observation.recordedAt !== event.at ||
        seen.has(observation.id)
      ) {
        continue;
      }
      seen.add(observation.id);
      notes.push({
        id: observation.id,
        kind: 'observation',
        topic: observation.topic,
        about: observation.about,
        text: observation.text,
        at: observation.recordedAt,
        who: observation.who,
        ...whichOf(event),
        ...(observation.retracted !== undefined ? { retracted: observation.retracted } : {}),
      });
    }
  }
  return notes;
}

/** Whether `link` stands between `one` and `other`, in either direction. */
function joins(link: LinkEdge, one: string, other: string): boolean {
  return (
    (link.subject === one && link.target === other) ||
    (link.subject === other && link.target === one)
  );
}

/** The model of the page, from the events of the public tree in the record's own order. */
export function pageModel(events: readonly CatalogEvent[]): PageModel {
  const projected = projectDecisions(events);
  const collided = new Set(adrCollisions(projected.values()).map((collision) => collision.adr));
  const links = projectLinks(events);
  const notes = notesOf(events);
  const noteIds = new Set(notes.map((note) => note.id));

  const moves = new Map<string, DecisionMove[]>();
  for (const event of events) {
    if (event.kind !== 'decision.transitioned') continue;
    const said = transitionProse(event.payload.fields);
    const list = moves.get(event.subject) ?? [];
    list.push({
      at: event.at,
      action: event.payload.action,
      before: event.payload.from,
      to: event.payload.to,
      who: event.who,
      ...whichOf(event),
      ...(said !== '' ? { said } : {}),
    });
    moves.set(event.subject, list);
  }

  const owned = new Set<string>();
  const decisions: PageDecision[] = [...projected.values()].map((d) => {
    const mine = notes.filter(
      (note) => note.about === d.id || links.some((link) => joins(link, note.id, d.id)),
    );
    for (const note of mine) owned.add(note.id);
    const out = links.filter((link) => link.subject === d.id);
    const into = links.filter((link) => link.target === d.id && !noteIds.has(link.subject));
    const addresses = out
      .filter((link) => (ADDRESS_RELATIONS as readonly string[]).includes(link.rel))
      .map((link) => ({ rel: link.rel, target: link.target }));
    const linkedTo = [
      ...out.filter(
        (link) =>
          !(ADDRESS_RELATIONS as readonly string[]).includes(link.rel) && !noteIds.has(link.target),
      ),
      ...into,
    ].map((link) => ({
      rel: link.rel,
      target: link.subject === d.id ? link.target : link.subject,
    }));
    return {
      id: d.id,
      adr: d.adr,
      adrIsUnique: !collided.has(d.adr),
      title: d.title,
      rationale: d.rationale,
      ...(d.alternatives !== undefined ? { alternatives: d.alternatives } : {}),
      state: d.state,
      inForce: decisionDisposition(d.state as DecisionState) === 'in-force',
      ...(d.supersedes !== undefined ? { supersedes: d.supersedes } : {}),
      ...(d.supersededBy !== undefined ? { supersededBy: d.supersededBy } : {}),
      createdAt: d.createdAt,
      ...(d.recordedBy !== undefined ? { recordedBy: d.recordedBy } : {}),
      ...(d.acceptedBy !== undefined ? { acceptedBy: d.acceptedBy } : {}),
      moves: moves.get(d.id) ?? [],
      notes: mine,
      addresses,
      linkedTo,
    };
  });

  const timeline = timelineOf(events, projected, notes);
  const otherNotes = notes.filter((note) => !owned.has(note.id));
  return {
    decisions,
    otherNotes,
    timeline,
    counts: {
      decisions: decisions.length,
      inForce: decisions.filter((d) => d.inForce).length,
      notes: notes.length,
      timeline: timeline.length,
    },
  };
}

/** One entry per record of a decision, per move, per note and per retraction, in the record's order. */
function timelineOf(
  events: readonly CatalogEvent[],
  projected: ReturnType<typeof projectDecisions>,
  notes: readonly PageNote[],
): TimelineEntry[] {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const written = new Set<string>();
  const entries: TimelineEntry[] = [];
  for (const event of events) {
    const decision = projected.get(event.subject);
    if (event.kind === 'decision.recorded' && decision !== undefined) {
      entries.push({
        kind: 'decision-recorded',
        at: event.at,
        who: event.who,
        ...whichOf(event),
        subject: decision.id,
        adr: decision.adr,
      });
    } else if (event.kind === 'decision.transitioned' && decision !== undefined) {
      entries.push({
        kind: 'decision-moved',
        at: event.at,
        who: event.who,
        ...whichOf(event),
        subject: decision.id,
        adr: decision.adr,
        action: event.payload.action,
        to: event.payload.to,
      });
    } else if (event.kind === 'memory.captured' || event.kind === 'observation.recorded') {
      const note = byId.get(event.subject);
      if (
        note === undefined ||
        written.has(note.id) ||
        note.who !== event.who ||
        note.at !== event.at
      ) {
        continue;
      }
      written.add(note.id);
      entries.push({
        kind: 'note-recorded',
        at: event.at,
        who: event.who,
        ...whichOf(event),
        subject: note.id,
        ...(note.topic !== undefined ? { topic: note.topic } : {}),
      });
    } else if (event.kind === 'note.retracted') {
      const taken = byId.get(event.subject)?.retracted;
      if (
        taken === undefined ||
        taken.at !== event.at ||
        taken.who !== event.who ||
        taken.reason !== event.payload.reason
      ) {
        continue;
      }
      entries.push({
        kind: 'note-retracted',
        at: event.at,
        who: event.who,
        ...whichOf(event),
        subject: event.subject,
      });
    }
  }
  return entries;
}
