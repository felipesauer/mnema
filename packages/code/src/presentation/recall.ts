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
 * NOTHING AT ALL WHEN NOTHING IS RECORDED, which is the one way this differs from the
 * document's skeleton. The document is a file compared with `diff`, and a heading that
 * disappeared would make its first entry read as a rewrite; this is not a file, and a
 * session in a project with no notes loses nothing by being handed no text. It is the rule
 * the edit push has — nothing arrives where there is nothing to say — and the server's own
 * instructions are what tell a reader that notes arrive here at all. When only ONE of the
 * two kinds is empty it says so in words, because then there is a text and an absent
 * heading in it would read as a kind this record does not keep.
 */

import type { RecordHit, RecordSearch } from '@mnema/copilot';
import { detectSecrets } from '@mnema/core';
import { oneLine } from '../one-line.js';
import { recordFraming } from '../record-framing.js';

/** The heading: what the text IS. */
const TITLE = '# What was noted here lately';

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
  'machine’s own and the personal one — newest first, one line each; `read_record` with an',
  'id serves the whole of one.',
];

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
 * The declaration of a cut, when the index held more than it served.
 *
 * The number is the index's own `total` and the door is the read that reaches past it, so a
 * reader told "these are the newest" is also told how many there are and how to reach the
 * rest — a list cut without saying so reads as the whole of it.
 */
function cutAt(search: RecordSearch, kind: 'memory' | 'observation'): string[] {
  const printed = search.hits.length;
  if (search.total <= printed) return [];
  return [
    `${search.total} are recorded here, and these are the ${printed} newest; \`search\` with`,
    `\`kind\` \`${kind}\` serves the rest.`,
    '',
  ];
}

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

/** One observation: its topic, in the weight of a name, and the id that reads the rest. */
function observationLine(hit: RecordHit): string {
  if (holdsACredential(hit.title)) return withheld(hit);
  return `- **${oneLine(hit.title)}** · \`${oneLine(hit.id)}\``;
}

/** One section: the heading with how many are PRINTED under it, then the notes or the none. */
function section(
  heading: string,
  search: RecordSearch,
  kind: 'memory' | 'observation',
  none: string,
  line: (hit: RecordHit) => string,
): string[] {
  return [
    `## ${heading} (${search.hits.length})`,
    '',
    ...(search.hits.length === 0 ? [none] : [...cutAt(search, kind), ...search.hits.map(line)]),
  ];
}

/**
 * The whole text, as lines — or NO lines at all when neither kind holds anything, which is
 * what makes the plugin's handler hand a session nothing.
 */
export function recallDocument(notes: {
  readonly memories: RecordSearch;
  readonly observations: RecordSearch;
}): string[] {
  if (notes.memories.hits.length === 0 && notes.observations.hits.length === 0) return [];
  return [
    TITLE,
    '',
    ...WHAT_THIS_IS,
    '',
    ...WHERE_THEY_COME_FROM,
    '',
    ...HOW_A_NOTE_ENTERS,
    '',
    ...section('Memories', notes.memories, 'memory', NO_MEMORY, memoryLine),
    '',
    ...section('Observations', notes.observations, 'observation', NO_OBSERVATION, observationLine),
  ];
}
