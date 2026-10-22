/**
 * What a task is, in prose, and where it stands: the description it was opened with, the hand-over
 * it last went through, the notes written about it, who has it and what happened last.
 *
 * A task event carries only a title and a handoff event only the two agent labels. The prose that
 * belongs with them is recorded in the same call as an observation about the task (topics
 * {@link DESCRIPTION_TOPIC} and {@link BRIEF_TOPIC}), so a reader assembles the story from the
 * task's own history and its notes. Two reads need it and they ask different questions of it:
 *
 *   - {@link taskStory} answers `read_record` and `show` for ONE task, whole: the description, the
 *     last handoff with its brief, and the notes, newest first, cut at {@link NOTES_SHOWN} with the
 *     count the cut left out.
 *   - {@link taskStanding} answers the opening read for EACH live task, one line each: who has it
 *     and the most recent thing that happened to it. It is a name and a line, never the body: the
 *     body is the first read's.
 *
 * BOTH LOOK IN EVERY TREE THEY ARE GIVEN, because an observation lives in the tree its writer chose
 * and the task in the one its kind names: a note an agent wrote privately about a task the team
 * holds is still a note about that task. Each answer carries the tree its notes came from only
 * through the ids it hands over, which the id-keyed read then places.
 *
 * WHO HAS A TASK is the `to` of its last handoff, and failing that whoever started it: the agent
 * that executed the `start`, or the identity that authorized it when no agent did. A task nobody
 * has handed over or started has no owner, and says so by saying nothing.
 */

import {
  BRIEF_TOPIC,
  DESCRIPTION_TOPIC,
  excerptOf,
  type HandoffProjection,
  type ObservationProjection,
  type ProjectionCache,
} from '@mnema/core';

/**
 * How a task started by a person with no agent is said to be had: the record holds the identity as a
 * 64-digit anchor, which says nothing to a reader and costs an opening context forty tokens per task.
 */
const A_PERSON = 'a person';

/** How many notes a task's story serves before it says how many it left out. */
export const NOTES_SHOWN = 8;

/** One note about a task, named and cut to a line. */
export interface TaskNote {
  /** The observation's id: the key `read_record` takes for the whole text. */
  readonly id: string;
  readonly topic: string;
  /** The first of its words, on one line and cut at the index's own width. */
  readonly line: string;
  /** When it was recorded. */
  readonly at: string;
}

/** A task's prose and the hand-over it last went through. */
export interface TaskStory {
  /** What the task is, as it was opened: the latest note on the `description` topic, whole. */
  readonly description?: { readonly id: string; readonly text: string; readonly at: string };
  /** The last handoff, and the brief recorded with it when there is one, whole. */
  readonly handoff?: {
    readonly from: string;
    readonly to: string;
    readonly at: string;
    readonly brief?: { readonly id: string; readonly text: string };
  };
  /**
   * The other notes about the task, newest first. `total` is how many there are in all: a list
   * shorter than it was cut, and says so. The description and the brief above are not repeated.
   */
  readonly notes: { readonly total: number; readonly items: readonly TaskNote[] };
}

/** Who has a task and the most recent thing that happened to it, each as a short phrase. */
export interface TaskStanding {
  /** The agent that has the task (`a person` when a person started it), and how that was known. */
  readonly owner?: { readonly name: string; readonly via: 'handoff' | 'start' };
  /** The most recent note or move, on one line. */
  readonly lastFact?: { readonly at: string; readonly line: string };
}

/** Every observation about a task in `caches`, oldest first (ties by id). */
function notesAbout(caches: readonly ProjectionCache[], id: string): ObservationProjection[] {
  return caches
    .flatMap((cache) => cache.listObservationsAbout(id))
    .sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0));
}

/** Every handoff of a task in `caches`, oldest first. */
function handoffsOf(caches: readonly ProjectionCache[], id: string): HandoffProjection[] {
  return caches
    .flatMap((cache) => cache.listHandoffs(id))
    .sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0));
}

/** The story of one task, or undefined when nothing was written beside it. */
export function taskStory(caches: readonly ProjectionCache[], id: string): TaskStory | undefined {
  const notes = notesAbout(caches, id);
  const handoffs = handoffsOf(caches, id);
  const lastHandoff = handoffs[handoffs.length - 1];
  const described = notes.filter((note) => note.topic === DESCRIPTION_TOPIC).pop();
  // THE BRIEF OF A HANDOFF IS THE FIRST `brief` NOTE RECORDED AT OR AFTER IT: the two are written in
  // one call, the handoff first, so a brief older than the handoff belongs to an earlier one.
  const briefed =
    lastHandoff === undefined
      ? undefined
      : notes.find(
          (note) => note.topic === BRIEF_TOPIC && note.recordedAt >= lastHandoff.recordedAt,
        );
  const rest = notes.filter((note) => note !== described && note !== briefed).reverse();
  if (described === undefined && lastHandoff === undefined && rest.length === 0) return undefined;
  return {
    ...(described !== undefined
      ? { description: { id: described.id, text: described.text, at: described.recordedAt } }
      : {}),
    ...(lastHandoff !== undefined
      ? {
          handoff: {
            from: lastHandoff.fromAgent,
            to: lastHandoff.toAgent,
            at: lastHandoff.recordedAt,
            ...(briefed !== undefined ? { brief: { id: briefed.id, text: briefed.text } } : {}),
          },
        }
      : {}),
    notes: {
      total: rest.length,
      items: rest.slice(0, NOTES_SHOWN).map((note) => ({
        id: note.id,
        topic: note.topic,
        line: excerptOf(note.text),
        at: note.recordedAt,
      })),
    },
  };
}

/**
 * Who has a task and what happened to it last, from the events that touch it in `caches`.
 *
 * The last fact is the newest of the task's moves and the notes standing about it (a note the
 * record took back is not one), each as `topic: first words` or `action → STATE: what it said`.
 * A move and a note in the same instant are ordered the way they were written: the note came
 * after, so it is the later.
 */
export function taskStanding(caches: readonly ProjectionCache[], id: string): TaskStanding {
  const handoffs = handoffsOf(caches, id);
  const lastHandoff = handoffs[handoffs.length - 1];
  let started: { readonly name: string } | undefined;
  let lastMove: { readonly at: string; readonly line: string } | undefined;
  const moves = caches
    .flatMap((cache) => cache.references(id))
    .filter((row) => row.role === 'subject' && row.event.kind === 'task.transitioned')
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.ord - b.ord));
  // What a move said is on the task's projection, which holds the prose of every move that
  // carried any, keyed by the move's action and instant.
  const proof = caches.flatMap((cache) => cache.getTask(id)?.proof ?? []);
  for (const row of moves) {
    if (row.event.kind !== 'task.transitioned') continue;
    const { action, to, from } = row.event.payload;
    if (action === 'start') started = { name: row.which ?? A_PERSON };
    const said = proof.find((one) => one.at === row.at && one.action === action)?.said;
    lastMove = {
      at: row.at,
      // The birth is the move out of nothing: "created", not an arrow from no state.
      line:
        from === null
          ? 'created'
          : `${action} → ${to}${said === undefined ? '' : `: ${excerptOf(said)}`}`,
    };
  }
  const notes = notesAbout(caches, id);
  const lastNote = notes[notes.length - 1];
  const lastFact =
    lastNote !== undefined && (lastMove === undefined || lastNote.recordedAt >= lastMove.at)
      ? { at: lastNote.recordedAt, line: `${lastNote.topic}: ${excerptOf(lastNote.text)}` }
      : lastMove;
  return {
    ...(lastHandoff !== undefined
      ? { owner: { name: lastHandoff.toAgent, via: 'handoff' as const } }
      : started !== undefined
        ? { owner: { name: started.name, via: 'start' as const } }
        : {}),
    ...(lastFact !== undefined ? { lastFact } : {}),
  };
}
