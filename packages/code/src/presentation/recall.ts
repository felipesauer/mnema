/**
 * The notes a session opens with — markdown for a reader that never asked for it.
 *
 * It is the second text of that moment, beside the document `mnema brief` prints, and the
 * two answer different questions: the document says what GOVERNS, out of the committed
 * record; this says what was NOTED, out of every tree this machine holds for the project.
 * A note governs nothing, so it is in no line of the document — and until this text
 * existed, a memory or an observation an agent recorded here reached no later session at
 * all unless it went looking.
 *
 * IT STATES WHAT IS, AND IT NAMES THE DOOR, AND THAT IS ALL IT DOES. Every line is a fact
 * about the record — what these notes are, whose text they are, where they came from, how a
 * note gets in — because text a hook puts in front of a model is read as context when it is
 * written as fact, and as a command to be wary of when it is not (the host says so in its
 * own guidance for hook context). The door is named the way the document names its own: the
 * tool and what it does, never that anybody ought to call it.
 *
 * ONE LINE PER NOTE, AND THE LINE IS THE INDEX'S. What stands for a memory is the start of
 * its content and what stands for an observation is its topic — the line `search` already
 * serves for each, cut where it already cuts — so this text is the same economy the rest of
 * the record's reads run on: the NAME in the pushed text, the body one `read_record` away.
 * Every field goes through {@link oneLine} here, where the line is built, for the reason the
 * document's bullets do: a note is text an actor typed, and one holding a newline would end
 * its own bullet and start a note nobody wrote.
 *
 * "CUT WHERE IT ALREADY CUTS" WAS TRUE OF ONE KIND OF THE TWO. The index cuts a memory's line
 * and serves an observation's topic whole, so this text carried a topic of any length into a
 * channel with a measured ceiling (`within-a-hook.ts`). The topic is now cut here, by the index's own
 * excerpt rule (see {@link observationLine}): the line is still the index's, and the length is
 * the one the index already gives the other kind.
 *
 * A MEMORY'S LINE IS NOT BOLD AND AN OBSERVATION'S IS. The topic is a name somebody chose;
 * the start of a memory is an excerpt nobody chose, and the index says so of it — presenting
 * it in the weight of a name would claim a choice that was never made.
 *
 * A LINE THAT HOLDS A CREDENTIAL IS WITHHELD, AND THIS IS THE ONE PLACE THE PRODUCT DOES IT.
 * Every surface screens what goes IN — a credential in a recognized format is replaced
 * before it is written — and the reads serve the record as it is, because what it held
 * before the door existed is `mnema exposure`'s to find, not a read's to hide. A PUSHED
 * channel is different in the one respect that matters: nobody asked, and the text leaves
 * this machine with every session that opens. So a note whose line still carries a
 * credential the door would have recognized — written before the door, or by anything else
 * holding a key — is handed over as the fact that it exists, with its id, and never as the
 * value. It asks {@link detectSecrets}, which answers with CLASSES and never with the value,
 * so nothing here can print what it found; the rewriting half of the door stays on the
 * writing side, where the core keeps it.
 *
 * THE ORDER IS SAID, IN ONE LINE, EVERY TIME. The notes that share a word with what this
 * session touches come first and the newest fill the rest (`commands/recall.ts`), and with
 * nothing touched the list is the newest alone; a reader cannot tell the two apart from the
 * lines, so the text says which it is ({@link orderLine}), and under each heading where
 * the near part ends ({@link nearCount}). What was touched is said as counts of where the
 * words came from, never as the words.
 *
 * NOTHING AT ALL WHEN NOTHING IS RECORDED, which is the one way this differs from the
 * document's skeleton. The document is a file compared with `diff`, and a heading that
 * disappeared would make its first entry read as a rewrite; this is not a file, and a
 * session in a project with no notes loses nothing by being handed no text. It is the rule
 * the edit push has — nothing arrives where there is nothing to say — and the server's own
 * instructions are what tell a reader that notes arrive here at all. When only ONE of the
 * two kinds is empty it says so in words, because then there is a text and an absent
 * heading in it would read as a kind this record does not keep.
 */

import type { PertinentSearch, RecordHit, RecordSearch } from '@mnema/context';
import { detectSecrets, excerptOf } from '@mnema/core';
import { oneLine } from '../one-line.js';
import { recordFraming } from '../record-framing.js';
import type { SessionTouch } from '../what-the-session-touches.js';
import { fitWhole } from './within-a-hook.js';

/** The heading: what the text IS. */
const TITLE = '# What was noted here';

/** What the content is and whose text it is — the channel's declaration, from one place. */
const WHAT_THIS_IS = recordFraming('recall-document');

/**
 * Where the notes come from, and what a line of one is.
 *
 * It names the three trees because they are the difference from the document the reader
 * was handed beside this one, which carries the committed tree alone — a reader holding
 * both would otherwise take a note kept on this machine for something the team was told.
 */
const WHERE_THEY_COME_FROM = [
  'They come from every tree this machine holds for the project — the committed one, this',
  'machine’s own and the personal one — one line each; `read_record` with an id serves the',
  'whole of one.',
];

/**
 * The order the notes are in — ONE line, and it is always there, because a reader handed
 * a list is owed what the list is ordered by. With something this session touches, the
 * line names where the words came from, as counts and never as the words: a branch's name
 * or a path is text somebody chose, and this channel prints no text of a note's that it
 * does not have to, let alone of a file's.
 */
function orderLine(touched: SessionTouch): string {
  if (touched.words.length === 0) {
    return 'Newest first: nothing this session touches could be read here — no changed file, no task in progress, no branch name and no commit.';
  }
  return `Nearest first: the ones that share a word with what this session touches — ${whereTheWordsCameFrom(touched)} — closest first, then the newest.`;
}

/** The sources of the words, in the order they were read, joined as a sentence. */
function whereTheWordsCameFrom(touched: SessionTouch): string {
  const parts: string[] = [];
  if (touched.changed > 0)
    parts.push(`${counted(touched.changed, 'file')} changed in the working tree`);
  if (touched.tasks > 0) parts.push(`${counted(touched.tasks, 'task')} in progress`);
  if (touched.branch) parts.push('the name of the branch');
  if (touched.commits > 0)
    parts.push(`the files of the last ${counted(touched.commits, 'commit')}`);
  // "a, b and c": the last comma of the list is the one that becomes "and".
  return parts.join(', ').replace(/, (?=[^,]*$)/, ' and ');
}

/** `n` with its noun, the noun made plural by an `s` — true of the three nouns above. */
function counted(n: number, noun: string): string {
  return `${n} ${n === 1 ? noun : `${noun}s`}`;
}

/**
 * How a note gets in, and what becomes of it — the door, named once, as a fact.
 *
 * The two tools are the two a note is recorded with, and the last clause is what makes the
 * text worth reading: the note comes BACK, to the next session here. "With the mnema plugin"
 * is not a hedge — the plugin is what hands this text over, and a person running the verb
 * by hand is reading a description of what a session gets.
 */
const HOW_A_NOTE_ENTERS = [
  'A note enters this record with `capture_memory`, or with `record_observation` about one',
  'of its records by id, and with the mnema plugin the next session that opens here is',
  'handed it.',
];

/** What a kind with nothing recorded says, when the other kind has something. */
const NO_MEMORY = 'No memory is recorded here.';
const NO_OBSERVATION = 'No observation is recorded here.';

/**
 * The declaration of a cut, when the index held more than this text prints.
 *
 * The number is the index's own `total` and the door is the read that reaches past it, so a
 * reader told "these are the newest" is also told how many there are and how to reach the
 * rest — a list cut without saying so reads as the whole of it.
 *
 * `printed` IS WHAT IS PRINTED, NOT WHAT THE INDEX SERVED, and there are two cuts now. The index
 * serves the newest few of each kind, and a hook's copy of this text may stop earlier still,
 * at a whole note, to stay inside what a hook carries ({@link recallWithin}). Both keep the start
 * of the section's order and drop from its end — the newest with nothing touched, the nearest
 * and then the newest with something — so one sentence is true of either, and a section a hook
 * cut to nothing says how many there are rather than that there are none.
 */
function cutAt(
  search: RecordSearch,
  printed: number,
  kind: 'memory' | 'observation',
  near: boolean,
): string[] {
  if (search.total <= printed) return [];
  const these = near ? `${printed} of them` : `the ${printed} newest`;
  return [
    printed === 0
      ? `${search.total} are recorded here, and none of them is below; \`search\` with`
      : `${search.total} are recorded here, and these are ${these}; \`search\` with`,
    `\`kind\` \`${kind}\` serves the rest.`,
    '',
  ];
}

/**
 * Where the near part of a section ends — said, because the order line says the near ones
 * come first and a reader cannot see where "first" stops. Only when there was something to
 * be near: with no signal every line is there for being recent, and the order line says so.
 */
function nearCount(search: PertinentSearch, printed: number, near: boolean): string[] {
  if (!near || printed === 0) return [];
  // Counted among the lines PRINTED: a hook's copy drops from the end, and the near ones are
  // first, so what was cut is the newest part before any of the near.
  const n = Math.min(search.pertinent, printed);
  if (n === 0) return [NONE_NEAR, ''];
  if (n >= printed) return [ALL_NEAR, ''];
  if (n === 1) return [FIRST_NEAR, ''];
  return [`The first ${n} share a word with what this session touches.`, ''];
}

/** What {@link nearCount} says when no line, every line, or the first line alone is near. */
const NONE_NEAR = 'None of these shares a word with what this session touches.';
const ALL_NEAR = 'Every one of these shares a word with what this session touches.';
const FIRST_NEAR = 'The first of these shares a word with what this session touches.';

/**
 * What stands where a note's line would carry a credential in a recognized format: the fact
 * that the note exists and why its text is not here, never the text.
 */
const WITHHELD =
  'its text is not handed over unasked: it holds a credential in a recognized format';

/** Whether a line may carry this note's own words, or has to stand in for them. */
function holdsACredential(title: string): boolean {
  return detectSecrets(title).length > 0;
}

/** The line a note gets when its own words cannot ride it: the stand-in, and the id. */
function withheld(hit: RecordHit): string {
  return `- ${WITHHELD} · \`${oneLine(hit.id)}\``;
}

/** One memory: the start of its content, and the id that reads the rest. */
function memoryLine(hit: RecordHit): string {
  if (holdsACredential(hit.title)) return withheld(hit);
  return `- ${oneLine(hit.title)} · \`${oneLine(hit.id)}\``;
}

/**
 * One observation: its topic, in the weight of a name, and the id that reads the rest.
 *
 * THE TOPIC IS CUT BY THE INDEX'S OWN RULE FOR A MEMORY'S LINE ({@link excerptOf}), and it used
 * to go out whole. The index serves a topic raw because it is the record's name for the note,
 * and a name somebody typed has no length — so twenty long ones carried this text past what a
 * hook hands a model, where twenty memories never could, because a memory's line was already
 * an excerpt. The same rule now bounds both lines of this text, from one place; the index and
 * `read_record` still serve the topic whole.
 *
 * The credential is asked of the WHOLE topic, before it is cut: a credential the excerpt split
 * in half would be a line that no longer looks like one and still carries most of it.
 */
function observationLine(hit: RecordHit): string {
  if (holdsACredential(hit.title)) return withheld(hit);
  return `- **${oneLine(excerptOf(hit.title))}** · \`${oneLine(hit.id)}\``;
}

/**
 * One section: the heading with how many are PRINTED under it, then the notes or the none.
 *
 * `shown` is how many of the index's hits are printed — all of them, unless a hook's copy
 * stopped earlier. What says "none" is the INDEX being empty, never the list being cut short.
 */
function section(
  heading: string,
  search: PertinentSearch,
  shown: number,
  kind: 'memory' | 'observation',
  near: boolean,
  none: string,
  line: (hit: RecordHit) => string,
): string[] {
  const hits = search.hits.slice(0, shown);
  return [
    `## ${heading} (${hits.length})`,
    '',
    ...(search.hits.length === 0
      ? [none]
      : [
          ...cutAt(search, hits.length, kind, near),
          ...nearCount(search, hits.length, near),
          ...hits.map(line),
        ]),
  ];
}

/** The notes this text reads from — the index's answer for each kind. */
interface Notes {
  readonly touched: SessionTouch;
  readonly memories: PertinentSearch;
  readonly observations: PertinentSearch;
}

/**
 * The whole text, as lines — or NO lines at all when neither kind holds anything, which is
 * what makes the plugin's handler hand a session nothing.
 */
export function recallDocument(notes: Notes): string[] {
  return composed(notes, notesIn(notes));
}

/**
 * The text for a hook: whole notes, in the text's own order — memories, then observations, each
 * in the order the order line names — up to what fits in `room`, by the rule the document's hook
 * copy is cut by ({@link fitWhole}).
 *
 * With every line an excerpt, twenty of each kind stay under what a hook carries, so this
 * returns {@link recallDocument} byte for byte on every record the index can hand it today; the
 * bound is `recall.test.ts`'s, at the longest line each kind can print. It is here so that the
 * day the lines or the counts grow, the text shortens at a whole note and says so in the words
 * each section already has ({@link cutAt}), instead of being replaced whole by a file path.
 */
export function recallWithin(notes: Notes, room: number): string[] {
  return fitWhole(notesIn(notes), room, (shown) => composed(notes, shown));
}

/** How many notes the index handed over, both kinds together. */
function notesIn(notes: Notes): number {
  return notes.memories.hits.length + notes.observations.hits.length;
}

/** The text with its first `shown` notes — the one shape both copies print. */
function composed(notes: Notes, shown: number): string[] {
  if (notes.memories.hits.length === 0 && notes.observations.hits.length === 0) return [];
  const near = notes.touched.words.length > 0;
  const memories = Math.min(shown, notes.memories.hits.length);
  return [
    TITLE,
    '',
    ...WHAT_THIS_IS,
    '',
    ...WHERE_THEY_COME_FROM,
    '',
    orderLine(notes.touched),
    '',
    ...HOW_A_NOTE_ENTERS,
    '',
    ...section('Memories', notes.memories, memories, 'memory', near, NO_MEMORY, memoryLine),
    '',
    ...section(
      'Observations',
      notes.observations,
      shown - memories,
      'observation',
      near,
      NO_OBSERVATION,
      observationLine,
    ),
  ];
}
