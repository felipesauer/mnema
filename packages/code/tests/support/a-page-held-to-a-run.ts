/**
 * A PAGE HELD TO A RUN — the two readings every case shares that holds what a page or a
 * recording shows to a run of the binary today.
 *
 * WHY THIS FILE EXISTS AS A FILE. Both were written inside
 * `the-first-record-a-page-shows-is-the-one-printed.test.ts`, the first case that held a page's
 * `#>` lines to the binary. The front page then grew more of the same: the opening document it
 * quotes and the two recordings it plays (`the-recordings-are-what-the-binary-draws.test.ts`).
 * Two spellings of what counts as minted, or of what a cut may leave out, is how one of the
 * cases comes to let a stale line through — so the two readings live here, unchanged, and every
 * such case asks them.
 *
 * WHAT THE MACHINE MINTS. A run makes up an id per write, prints the day it ran and makes its
 * keys on the spot, so no second run prints them again. Both sides are read with each replaced
 * by what it is ({@link asMinted}) — and through the same function, so neither side can be made
 * to agree by a replacement the other did not get. The order is part of the reading: an id is
 * read before a run of hex, or the hex would take the id apart and leave its dashes behind.
 *
 * THE ONE MARK OF A CUT. `…` inside a line stands for what the page shortened, and a line that is
 * `…` alone for one or more whole lines left out ({@link accountsFor}). Anything else a page
 * leaves out, or adds, is a line that does not account for what was printed.
 */

/** A record's id, as every write prints it. */
const AN_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** The day a run happened, as the record prints it. */
const A_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

/** A key's fingerprint, an identity, a digest — any run of lower-case hex eight long or longer. */
const HEX = /[0-9a-f]{8,}/g;

/** Some text with what the machine minted replaced by what it is: `<uuid>`, `<date>`, `<hex>`. */
export function asMinted(text: string): string {
  return text.replace(AN_ID, '<uuid>').replace(A_DATE, '<date>').replace(HEX, '<hex>');
}

/** The mark of a cut: inside a line, what was shortened; alone on a line, lines left out. */
export const CUT = '…';

/** A shown line as a pattern over one printed line: literal, except where it marks a cut. */
function patternOf(shown: string): RegExp {
  const literal = shown.split(CUT).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${literal.join('.*?')}$`);
}

/**
 * Whether the lines a page shows account for every line printed, in order, with {@link CUT}
 * the only way to leave anything out. A line that is the mark alone stands for ONE OR MORE
 * lines: a mark where nothing was cut would say something the page did not do.
 */
export function accountsFor(shown: readonly string[], printed: readonly string[]): boolean {
  const memo = new Map<string, boolean>();
  const from = (i: number, j: number): boolean => {
    const key = `${i},${j}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let answer: boolean;
    if (i === shown.length) {
      answer = j === printed.length;
    } else if (shown[i]?.trim() === CUT) {
      answer = false;
      for (let k = j + 1; k <= printed.length && !answer; k += 1) answer = from(i + 1, k);
    } else {
      answer =
        j < printed.length &&
        patternOf(shown[i] as string).test(printed[j] as string) &&
        from(i + 1, j + 1);
    }
    memo.set(key, answer);
    return answer;
  };
  return from(0, 0);
}
