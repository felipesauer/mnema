/**
 * HOW WIDE TEXT IS ON A SCREEN — the one authority over columns, and it is the one the
 * layout library draws by.
 *
 * IT WAS `[...text].length` AND THAT IS A COUNT OF CODE POINTS, not of columns. The debt this
 * closes was written down as *East Asian Ambiguous glyphs counted as one column (7 of them),
 * none of which appears in the vocabulary* — and measuring it found the note false in the
 * direction that matters far less and true nowhere near the real defect. There are fifteen
 * Ambiguous characters in this product's own source, the em dash appears 1625 times and the
 * banner's full block 140; and under that, a class the debt did not see at all. Measured on
 * the built binary before this module existed:
 *
 *   | line              | widthOf | columns on any terminal |
 *   |-------------------|--------:|------------------------:|
 *   | `decisão`         |       7 |                       7 |
 *   | `決定を記録する`      |       7 |                      14 |
 *   | `é` (e + U+0301)  |       2 |                       1 |
 *   | one CSI sequence  |      11 |                       0 |
 *
 * East Asian WIDE is not ambiguous: those are two cells in every terminal there is, and a
 * record's content is the CALLER'S — a decision titled in Japanese is ordinary, and it broke
 * the arithmetic of the frame today, everywhere. The arguable half of the debt was hiding a
 * half that is not arguable at all.
 *
 * SO THE AUTHORITY IS THE ONE THAT DRAWS. The frame comes apart when OUR count and the
 * RENDERER'S disagree — not when ours disagrees with the truth of some terminal. Agreeing with
 * whoever draws is reachable and testable; agreeing with every terminal is neither. The layout
 * library this console is built on measures with `string-width` (`ink`'s own dependency, and
 * the same version), so that is what is asked here, and it is declared as this package's own
 * dependency rather than reached for through a neighbour's closure — an explicit edge is worth
 * more than an accident of resolution.
 *
 * AND THE CONVENTION FOR AMBIGUOUS IS THE AUTHORITY'S, DECLARED RATHER THAN CHOSEN. Those
 * characters are one cell or two depending on the reader's locale and font, and this product
 * cannot know which — what it can do is not disagree with itself. `string-width` treats them as
 * NARROW by default, which is the recommendation of the standard that defines the class
 * (UAX #11: *if the context cannot be established reliably, they should be treated as narrow
 * characters by default*), so on this surface an em dash, a box rule, the guide down the margin
 * and the banner's blocks are one column each. A terminal in a CJK locale draws them two wide
 * and the drawing is then twice as wide as this thinks — that risk is unchanged by this module
 * and is now the WHOLE of the remaining debt, where before it was hiding the Wide class under
 * it. `width.test.ts` asserts the convention on those exact glyphs, so the day the authority
 * changes its default, this surface is told.
 *
 * WHAT ASKS: everything. The width of a composed line (`plain.ts`, `widthOf`), where a line
 * BREAKS (`folded.ts`), how many rows the roll gives a line (`repl/scrolling.ts`), how wide the
 * column of a table is (`items.ts`, `repl/palette.ts`, `choice/doors.ts`, `wiring/repl.ts`),
 * and where the caret sits on the row being typed (`repl/console.ts`). Every one of those used
 * to count for itself; `tests/one-width-per-frame.test.ts` refuses a surface where any of them
 * counts again.
 */

import stringWidth from 'string-width';

/** One escape byte, written as an escape so no control byte enters a source file. */
const ESC = '\u001b';

/** What an escape has to be followed by to be a control sequence: `ESC [`. */
const CSI = '[';

/**
 * What ENDS a control sequence — any character from `@` to `~`.
 *
 * The range is the standard's own (a CSI sequence is the introducer, then parameter and
 * intermediate bytes, then one final byte in that range), so a sequence this file has never
 * heard of is still skipped whole rather than half-counted. Both ends are printable, which is
 * why this pattern can be written literally.
 *
 * IT LIVED IN `folded.ts` AND IT IS HERE because the fold was not the only thing that had an
 * opinion about where a sequence ends: `withoutSequences` walked it, and `repl/scrolling.ts`
 * counted what was left. One reading, and {@link glyphsOf} is where it is.
 */
const ENDS_A_SEQUENCE = /[@-~]/;

/**
 * How this text is broken into the units a screen shows.
 *
 * A GRAPHEME AND NOT A CODE POINT, which is the half a naive implementation gets wrong in the
 * other direction: `e` followed by COMBINING ACUTE ACCENT is one thing on a screen and two code
 * points, and a fold that broke between them would put an accent alone at the start of a row.
 * It is the same segmentation the authority itself measures by, so the parts and the whole
 * cannot disagree (`width.test.ts` asserts exactly that: the widths of the glyphs sum to the
 * width of the text, over every shape this surface builds).
 */
const GLYPHS = new Intl.Segmenter();

/**
 * TEXT MADE ENTIRELY OF PRINTABLE ASCII — the one range this file may answer about without
 * asking, and the range the authority's own fast path uses.
 *
 * Space to tilde, which is every character every report of this product is made of and every
 * word of its vocabulary. See {@link theGlyphsOfPlainText} for what it buys and what it is not.
 */
const ONLY_PRINTABLE_ASCII = /^[\u0020-\u007e]*$/;

/** One unit of some text: the bytes a screen receives, and how many columns they take. */
export interface Glyph {
  /** The bytes themselves — one grapheme, or a whole control sequence. */
  readonly bytes: string;
  /** How many columns it occupies: none for a sequence or a combining mark, one or two else. */
  readonly width: number;
  /**
   * Whether it is a control SEQUENCE rather than something a caller wrote.
   *
   * IT IS NOT THE SAME QUESTION AS `width === 0`, and a first draft of this file that treated the
   * two as one dropped every newline out of {@link withoutSequences}: a break occupies no column
   * either, and it is a character a screen puts a row boundary at rather than an escape nobody
   * wrote. So what is a sequence is said here rather than inferred from a number, which is what
   * lets the fold ask about columns and the console ask about escapes without either one
   * answering the other's question (`folded.test.ts` holds the break case on the bytes).
   */
  readonly sequence: boolean;
}

/**
 * HOW MANY TEXTS ARE REMEMBERED, and what happens at the ceiling.
 *
 * MEASURING IS NOT CHEAP AND THE SAME TEXT IS MEASURED OVER AND OVER, which is the shape of
 * this surface rather than an accident of one caller: the console redraws a whole page per
 * frame, and the drawing of the name is chosen by measuring four CONSTANT forms at every size
 * the window passes through. Measured on the built binary, before this map existed — one row of
 * the biggest drawing, forty-seven glyphs, none of them ASCII: **38.6 µs**, against **418 ns**
 * for the count of code points it replaced, and **244 µs** for the whole drawing. The three
 * cases that walk a grid of terminal sizes timed out.
 *
 * WHAT IS EXPENSIVE IS THE FIRST ANSWER ABOUT A STRING, and the authority's own fast path
 * already makes printable ASCII free (**83 ns** for a line of a report, which is faster than
 * the count it replaced). So what this holds is the rest: the glyphs of the art, the rules and
 * the marks, and the rows of a page that is redrawn unchanged.
 *
 * THE CEILING IS EMPTIED RATHER THAN EVICTED FROM. A record's content is a caller's, so the
 * set of strings this can be asked about is unbounded and a map without a ceiling is a leak in
 * a session that runs all day. Emptying is the policy a cache may have when every entry is
 * equally cheap to recompute — there is no order among these to keep — and it is a policy
 * rather than an absence: `width.test.ts` fills it past the ceiling and asserts the answers are
 * the same on both sides of the emptying.
 */
const A_CEILING = 4096;

/** What has been measured already — see {@link A_CEILING} for why it is bounded. */
const MEASURED = new Map<string, number>();

/**
 * HOW MANY COLUMNS SOME TEXT TAKES — the answer, and the only place it is worked out.
 *
 * Escapes cost nothing, because a terminal draws none of them: a painted line and its plain
 * twin are the same number of columns and different numbers of bytes, and measuring the bytes
 * would make a drawing that fits shrink for having colour switched on.
 *
 * IT IS REMEMBERED, and the memory changes no answer: what comes back for a text is what the
 * authority said about it the first time (see {@link A_CEILING} for the cost that bought it).
 */
export function widthOfText(text: string): number {
  const known = MEASURED.get(text);
  if (known !== undefined) return known;
  const width = stringWidth(text);
  if (MEASURED.size >= A_CEILING) MEASURED.clear();
  MEASURED.set(text, width);
  return width;
}

/** How many texts are remembered right now — for the case that proves the ceiling holds. */
export function howManyAreRemembered(): number {
  return MEASURED.size;
}

/**
 * SOME TEXT AS THE GLYPHS A SCREEN GIVES IT, each with its own width.
 *
 * A CONTROL SEQUENCE IS ONE GLYPH OF NO WIDTH, which is why this exists beside
 * {@link widthOfText} rather than being a loop over it: asked glyph by glyph, the bytes of a
 * sequence would each be measured on their own and `[`, `3`, `5` and `m` are four columns of
 * text nobody draws. Held together, the sum of the parts is the width of the whole — the
 * property everything that folds rests on.
 *
 * WHO ASKS: the renderer that folds, which needs to know where each unit ends so it can break
 * between them (`folded.ts`), and the drawing of the name, which inks a mask mark by mark
 * (`banner.ts`).
 */
export function glyphsOf(text: string): readonly Glyph[] {
  const glyphs: Glyph[] = [];
  let at = 0;
  let from = 0;
  while (at < text.length) {
    if (text[at] === ESC && text[at + 1] === CSI) {
      theGlyphsOfPlainText(glyphs, text.slice(from, at));
      let end = at + 2;
      while (end < text.length && !ENDS_A_SEQUENCE.test(text[end] as string)) end += 1;
      glyphs.push({ bytes: text.slice(at, end + 1), width: 0, sequence: true });
      at = end + 1;
      from = at;
      continue;
    }
    at += 1;
  }
  theGlyphsOfPlainText(glyphs, text.slice(from));
  return glyphs;
}

/**
 * The glyphs of a run of text with no control sequence in it, appended in order.
 *
 * THE FAST PATH IS THE AUTHORITY'S OWN AND IT IS WRITTEN DOWN RATHER THAN INFERRED. Printable
 * ASCII is one column per character — that is the same shortcut `string-width` takes on the
 * whole string, spelled with the same range — and it is here because segmentation is what
 * measuring costs. Measured on the built binary: a painted row of a report through the
 * segmenter for every glyph is **14.0 µs** and **1.1 µs** with this, against **4.0 µs** for the
 * count of code points this file replaced.
 *
 * IT IS NOT A WIDTH TABLE, which is the line it is not allowed to cross: it knows one range of
 * one column and hands everything else — every accent, every rule, every wide glyph, every
 * emoji — to the authority. And it is not trusted either: `width.test.ts` asks both paths about
 * the same corpus and refuses a disagreement, so a shortcut that stopped being true of ASCII
 * goes red rather than quiet.
 */
function theGlyphsOfPlainText(glyphs: Glyph[], text: string): void {
  if (text === '') return;
  if (ONLY_PRINTABLE_ASCII.test(text)) {
    for (const character of text) glyphs.push({ bytes: character, width: 1, sequence: false });
    return;
  }
  for (const { segment } of GLYPHS.segment(text)) {
    glyphs.push({ bytes: segment, width: widthOfText(segment), sequence: false });
  }
}

/**
 * The text with every control sequence taken out — what a screen actually shows.
 *
 * IT IS THE PROMISE `styled.ts` MAKES, AS A FUNCTION — *strip the escapes and you have the
 * plain line, exactly*. It moved here from `folded.ts` with the walk it is made of, because a
 * second opinion about where a sequence ends is a second opinion about how wide a line is:
 * whatever this drops is exactly what {@link widthOfText} charges nothing for.
 *
 * WHO ASKS: the console, which reads the ids out of a line it has already turned into bytes
 * (`repl/seen.ts`). What a caller can name is what is on their screen, so what is scanned has
 * to be what the screen shows rather than what the stream carried.
 */
export function withoutSequences(text: string): string {
  return glyphsOf(text)
    .filter((glyph) => !glyph.sequence)
    .map((glyph) => glyph.bytes)
    .join('');
}

/**
 * HOW WIDE THE WIDEST OF SOME TEXTS IS — what a column of a table is worth.
 *
 * It exists so that the three tables on this surface ask one function rather than each writing
 * `Math.max(…, word.length)` for itself: the words of the session's list, the doors of the
 * bare name, and the words in the help. All three are the product's own vocabulary today and
 * every one of them is ASCII, so this changes not a byte of any of them — which is the point.
 * A vocabulary is a value, and the day one word of it is not ASCII the column is still the
 * width of the widest word rather than one that happens to be right.
 */
export function widestOf(texts: readonly string[]): number {
  return texts.reduce((most, text) => Math.max(most, widthOfText(text)), 0);
}

/**
 * The text with blanks after it until it is `width` columns wide — and never cut.
 *
 * A3: THE WRITING CALLS THE FUNCTION THE READING CALLS. It used to be `padEnd`, which pads to
 * a count of code UNITS — so a value two columns wide per glyph was padded as though it were
 * one, and the column after it started somewhere else on every row that held one. The pad is
 * the width the reading measures, less the width the reading measures, so the two cannot come
 * apart.
 *
 * It pads and never truncates: a value wider than the column pushes the rest of the line right,
 * which is ugly, where cutting it would be a lie.
 */
export function padTo(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - widthOfText(text)));
}

/**
 * AS MUCH OF THE TEXT AS FITS IN `width` COLUMNS — whole glyphs, and never a broken one.
 *
 * WHO ASKS: the console's list of words, which drops what a window is too narrow for and puts
 * a mark where it cut (`repl/palette.ts`). What it needs is a prefix that FITS, which a count
 * of code points is not: a cut at seven code points of a Japanese description leaves fourteen
 * columns in a column that has seven.
 *
 * A sequence costs nothing and comes along with the glyph it precedes, so a prefix cut here
 * never loses the escape that was opening what it kept.
 */
export function cutTo(text: string, width: number): string {
  let taken = 0;
  let kept = '';
  for (const glyph of glyphsOf(text)) {
    if (taken + glyph.width > width) break;
    taken += glyph.width;
    kept += glyph.bytes;
  }
  return kept;
}
