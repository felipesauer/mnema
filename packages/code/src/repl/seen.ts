/**
 * THE RECORDS THIS SESSION HAS ALREADY NAMED — so that one of them can be typed back.
 *
 * IT CAME OUT OF A DEAD END, MEASURED AT THE PROMPT. `search` prints
 * `019fdf20-c630-7fa1-b418-5a0750d396e0`, and `show 019fdf20-c630` answers *No record
 * here*: only the whole 36 characters resolve, and so does neither the alias `show` itself
 * prints nor any prefix of the id. At a shell that is survivable, because a value on the
 * screen is a value to select and paste. In a console you TYPE, and an identifier you can
 * read and cannot use is an identifier the surface is showing for nothing.
 *
 * WHAT IS REMEMBERED IS WHAT THE PAGE SAID, AND NOTHING IS EVER READ TO FILL IT. This
 * grows from lines that have already landed, which is the whole of why a Tab over an id is
 * affordable: `complete.ts` refused to offer ids because the only way to know one is to
 * read the record, and a menu of the record goes stale between keystrokes. Neither
 * objection reaches this — nothing is opened, and what a session has SAID cannot go stale,
 * because it cannot be unsaid. The count that proves this surface reads exactly once, when
 * it opens, is the same one it always was (`tests/the-name-and-the-hints.test.ts`).
 *
 * WHAT IT HANDS BACK IS THE WHOLE ID. There is no short form for an entity id anywhere in
 * this product, deliberately (`src/anchors.ts`: a short value that looks like the real one
 * becomes a trap the moment somebody pastes it where the real one goes). Completing
 * invents no form at all — the 36 characters are typed FOR the caller — so that decision
 * is untouched and the dead end above is what closes.
 *
 * THE GLOSS IS THE REST OF THE LINE THE ID WAS ON, and that is measurement rather than
 * comfort. An id is a v7 UUID, so it begins with the millisecond it was minted, and the
 * records of one session were minted close together: `019fdf20-c630`, `019fdf20-c5bb`,
 * `019fdf20-c8f2`. Ambiguity is the COMMON case here, not the exception, and a list of
 * bare UUIDs would be a list a reader cannot choose from. The rest of the row already
 * carries the kind, the scope, the date and the title, because that is what the row was
 * for.
 *
 * THE FIRST MENTION IS THE ONE THAT NAMES IT. A record shown twice is one entry, and it
 * keeps the line it was first shown on: a `search` hit says the kind, the date and the
 * title, and the `show` that follows says less about it in more rows. Costing one entry
 * per RECORD rather than per mention is the same choice from the other side.
 *
 * IT IS NOT PRUNED, AND THE COST IS THE ANSWER RATHER THAN A LIMIT. An entry is an id and
 * one row of text: measured at about 250 bytes of heap each, so a session that named ten
 * thousand distinct records holds about 2.5 MB, and the largest answer this product can
 * give is 200 records (`SEARCH_MAX_LIMIT`) — fifty of those, all disjoint, to get there. A
 * bound would be a threshold no session reaches, which is a mechanism that can never be
 * shown to do anything; the honest form is the number.
 */

import { type MintedId, mintedIdsIn } from '@mnema/core';
import type { CompletionWord } from '../completion/tree.js';
import { withoutSequences } from '../presentation/folded.js';

/** What separates the words of a gloss. One space, however the row was spaced. */
const BETWEEN_WORDS = ' ';

/** What a session remembers having named, and what it answers a Tab with. */
export interface Seen {
  /**
   * Remember every record named on a line the page has just landed.
   *
   * It takes the line as BYTES, because that is what lands: a line reaches the page
   * already rendered, and inside a terminal that renderer paints and folds. What is
   * scanned is what the screen shows ({@link withoutSequences}), so an id is found where a
   * reader sees one.
   */
  readonly saw: (line: string) => void;
  /**
   * The records this session has named that `word` could still become, each beside the
   * line it was named on, in the order the session named them.
   *
   * IN THE SESSION'S OWN ORDER, and not sorted. What a Tab lists is read directly under
   * the rows it came from, and those rows are on the screen in the order the reads
   * answered; sorting UUIDs by their bytes would hand back the same set in an order the
   * caller has never seen. (`complete.ts` sorts the WORDS of the declarations for the
   * opposite reason: their own order is the order `--help` lists them in, which puts the
   * writes first.)
   */
  readonly matching: (word: string) => readonly CompletionWord[];
}

/**
 * A session's memory of what it has named: empty, and filled only by lines that land.
 *
 * One value per session, held by the console that lands the lines and read by the
 * completer that offers them (`session.ts` wires both to this one object) — so what a Tab
 * offers cannot come to be a different set from what the page said.
 */
export function whatTheSessionShowed(): Seen {
  /** Every record named so far, by id, each with the rest of the line it was named on. */
  const glosses = new Map<string, string>();
  return {
    saw: (line) => {
      const shown = withoutSequences(line);
      for (const found of mintedIdsIn(shown)) {
        if (glosses.has(found.id)) continue;
        glosses.set(found.id, restOfTheLine(shown, found));
      }
    },
    matching: (word) =>
      [...glosses]
        .filter(([id]) => id.startsWith(word))
        .map(([id, description]) => ({ word: id, description })),
  };
}

/**
 * What a row said BESIDES the id on it: the rest of the characters, with every run of
 * whitespace collapsed to one space.
 *
 * COLLAPSED BECAUSE A ROW IS A TABLE AND A GLOSS IS NOT. The line an id came from is
 * padded into columns and indented under a heading, and a folded one carries the break and
 * the hanging indent with it; kept verbatim, those become a description with a gap in the
 * middle or a newline inside a row of a menu. Nothing is dropped — every word of the row
 * survives, in its order — and nothing is shortened here either: how much of a description
 * a terminal has room for is the palette's question, and it answers it with a mark saying
 * there was more (`palette.ts`).
 */
function restOfTheLine(line: string, found: MintedId): string {
  const rest = line.slice(0, found.at) + line.slice(found.at + found.id.length);
  return rest
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .join(BETWEEN_WORDS);
}
