/**
 * What a line IS before anything decides how it looks: a depth, and a sequence of
 * PARTS each of which says what it is.
 *
 * The three terminal forms used to join their own parts and hand back a string, so
 * the two spaces between columns lived in `items.ts`, the `·` between the parts of
 * a heading in `detail.ts` and the colon after a verdict's label in `verdict.ts` —
 * three modules each holding a piece of how the surface is punctuated, and
 * `forms.test.ts` asserting that two of them agreed on the depth. A caller received
 * bytes, so anything that wanted to know which of them were a label and which the
 * thing it was about had nothing left to ask.
 *
 * Splitting the two apart costs a caller nothing and buys the question: a primitive
 * says what the parts of a line ARE, and a renderer turns them into the bytes (see
 * `plain.ts`). `presentation/` still returns lines and writes none, and it still
 * knows nothing about a terminal — a part carries no colour, no width and no escape
 * byte, only what it is.
 *
 * A part's text is TEXT, not a line: nothing here splits it, joins it or trims it. A
 * newline inside a field is the call site's problem, it is solved there with
 * `oneLine` on the fields that hold what an ACTOR wrote, and it is asserted there —
 * see `items.ts` for why the rule lives at the call site and
 * `one-line-per-item.test.ts` for what a list costs when it does not.
 */

/**
 * Every role a part can have, and the call site that already tells that kind of
 * field apart:
 *
 *   - `label` and `detail` — the two arguments of {@link statement}. The signature
 *     is where the distinction already lives: the label leads and takes the colon
 *     because a reader scanning a log for a refusal reads the first word.
 *   - `field` — one column of {@link itemLine}, and the whole text of a
 *     {@link fact}. Those two are the SAME line and `forms.test.ts` pins it, so
 *     telling them apart here would invent a difference the output does not make.
 *   - `subject` — one part of {@link subjectLine}, which reads as a heading rather
 *     than as the columns of a table.
 *
 * WHAT IS NOT HERE, and why the list is short. An id, a state, a verdict and an
 * emphasis are all things a reader tells apart on sight, and not one of them is a
 * role: nothing in the code tells an id apart from a title on an item line — the six
 * lists pass their fields positionally, in an array — and `column` marks a WIDTH, not
 * a kind of value. A role for something no caller distinguishes would be a value
 * plumbed to a renderer with nothing feeding it, which is a defect wearing the
 * clothes of a taxonomy. The day a caller distinguishes one, it gets a role then.
 *
 * The union is derived from this tuple so the roles can be walked at run time:
 * `parts.test.ts` calls every primitive and refuses a role no primitive produces.
 */
export const ROLES = ['label', 'detail', 'field', 'subject'] as const;

/** What a part is on its line. Closed: see {@link ROLES} for what it excludes. */
export type Role = (typeof ROLES)[number];

/** One part of a line: what it is, and what it says. */
export interface Part {
  /** What this part is on the line — what a renderer punctuates and may paint. */
  readonly role: Role;
  /** What it says, verbatim. Not a line: a renderer never splits or joins it. */
  readonly text: string;
}

/**
 * One line of output, as its parts — never as bytes.
 *
 * `indent` is a DEPTH and not a string, which is what keeps the width of one level
 * a single constant in the renderer rather than a literal repeated in every form.
 */
export interface Line {
  /** How many levels deep the line sits: 0 for a heading, 1 for an item or a fact. */
  readonly indent: number;
  /** The parts, in the order they read. Empty is a blank line. */
  readonly parts: readonly Part[];
}
