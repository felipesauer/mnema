/**
 * BYTES ARRIVE IN CHUNKS AND A CHARACTER DOES NOT — the one place a stream is turned back
 * into text.
 *
 * ⚠️ IT IS HERE BECAUSE EVERY READER DID IT ITSELF, AND ALL OF THEM WERE WRONG. A `data`
 * event hands over however many bytes happened to be readable, and five places wrote
 * `bytes += chunk.toString('utf-8')` — one decode per chunk. A character that spans a chunk
 * boundary is then decoded as two halves, and each half becomes the replacement character.
 *
 * WHAT THAT COST, MEASURED. The glyph the console's rules are drawn out of is `─` and it
 * is THREE bytes, so a boundary inside one leaves TWO characters where there was one: the
 * row is a column wider than the terminal, the terminal folds it, and the page has a row
 * nobody drew. Caught by dumping the screen of a failing run — a rule 100 columns across came
 * back 101 characters long — and it is every symptom a whole family of intermittent failures
 * had: a caret one row below the prompt (`expected 22 to be 21`), a page one row taller
 * (`expected 25 to be 24`), a row above the prompt that is not a rule, a rule that "stops
 * short" at one column. Six cases across three files, red in about eight runs of the suite in
 * ten and only visible in one in three, because the lost character had to land on a row some
 * assertion was looking at.
 *
 * SO THE DECODER KEEPS ITS STATE, which is the whole of the fix: half a character at the end
 * of a chunk is HELD until the rest of it arrives. `tests/the-screen-says-what-it-was-drawn-at.test.ts`
 * pins it on a glyph cut in two by hand rather than on a chunk boundary that has to be waited
 * for — a race does not answer a single run, and the arithmetic does.
 *
 * AND THE PAGE STILL REFUSES A STREAM THAT LOST ONE (`support/screen.ts`). The guard is not
 * redundant now that this exists: it is what says, out loud, that this stopped working.
 */

import { StringDecoder } from 'node:string_decoder';

/** Anything that hands bytes over in chunks — a stream, or a case standing in for one. */
export interface Arrives {
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
}

/** Everything that has arrived, and how to start reading another stream into it. */
export interface Arriving {
  /**
   * Reads one stream into the text, with a decoder of its OWN.
   *
   * Per stream rather than shared, because a character never spans two of them: a partial
   * sequence held for one stream may not be finished by a byte that came off another, which
   * is a way of turning two correct streams into one wrong string.
   */
  readonly from: (stream: Arrives) => void;
  /** Everything that has arrived so far, decoded across the chunk boundaries. */
  readonly text: () => string;
}

/** A collector that decodes across chunk boundaries rather than one chunk at a time. */
export function decodedWhole(): Arriving {
  let text = '';
  return {
    from: (stream) => {
      const decoder = new StringDecoder('utf8');
      stream.on('data', (chunk) => {
        text += decoder.write(chunk);
      });
    },
    text: () => text,
  };
}
