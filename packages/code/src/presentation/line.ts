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
 *   - `id` and `when` — the columns of {@link itemLine} a call site hands over
 *     KNOWING what they are. `search` passes a hit's id and the day it was written
 *     and used to throw both facts away by passing them as `field`; recovering them
 *     is not inventing a role, it is stopping the discard. And they are one pair
 *     rather than two decisions because the reason is one: YOU DO NOT READ AN ID OR
 *     A DATE, you copy one or skip past it. Dimming them is what makes the title
 *     beside them the thing the eye lands on, which is what `git log --oneline` does
 *     with a hash and `gh pr list` with a number.
 *   - `subject` — one part of {@link subjectLine}, which reads as a heading rather
 *     than as the columns of a table.
 *   - `clause` — one clause of a verdict that arrives in SEVERAL, after the first. The
 *     chain hands `verify` its one-line verdict as the clauses it is made of, and the
 *     call site that knows one clause from another is the one that received them apart;
 *     joining them back into a string here would throw that away again. It is a
 *     refinement of `detail` in the same sense the two columns below are refinements of
 *     `field`: a clause sits where a detail sits and reads as secondary, and what it
 *     needs of its own is the `; ` that separates it from the clause before it.
 *
 * THE TWO COLUMN ROLES ARE REFINEMENTS OF `field`, and that is a constraint and not a
 * preference. A separator is a function of the role ALONE (see `PRECEDED_BY`), so a
 * role that joined its neighbour one way inside a list and another inside a heading
 * could not exist. `id` and `when` take a column's two spaces — which is what keeps
 * the plain renderer's bytes, and therefore the recorded transcript, identical. It is
 * also why the id in `show`'s heading and the instants inside `show`'s facts stay
 * unmarked: neither is a column, and marking one would move a byte.
 *
 * WHAT IS STILL NOT HERE, and what falsified the premise that used to be. This list
 * used to say that "an id, a state, a verdict and an emphasis" were all things a
 * reader tells apart on sight and that not one of them was a role, because nothing in
 * the code told an id from a title. HALF OF THAT SURVIVED. What falsified the other
 * half is `styled.ts`: once a renderer could dim, `search.ts` passing `hit.id` and
 * `hit.at` as anonymous fields stopped being "nothing distinguishes them" and became
 * a call site discarding what it knew. A `state`, a tree and a title are still not
 * roles, and their reason is different in kind — they are CATEGORIES rather than
 * ranks, so telling them apart means one hue per value, and five hues in a list is
 * noise. The day someone wants them apart, the argument has to be legibility
 * MEASURED, not variety.
 *
 * The union is derived from this tuple so the roles can be walked at run time:
 * `parts.test.ts` calls every primitive and refuses a role no primitive produces.
 */
export const ROLES = ['label', 'detail', 'clause', 'field', 'id', 'when', 'subject'] as const;

/** What a part is on its line. Closed: see {@link ROLES} for what it excludes. */
export type Role = (typeof ROLES)[number];

/**
 * How bad the news on a part is, where the call site is the thing that knows.
 *
 * IT IS NOT A ROLE, and keeping the two apart is what stops the table of styles from
 * doubling. A verdict's label is still a label — it leads the line and it takes the
 * colon — and a severity is a second axis over that: `REFUSED` is a label that is bad
 * news, `ALLOWED` is the same label with the opposite news, and a dimmed id is
 * neither. So a part always has a role and has a severity only where something knows
 * one, and the renderer composes the two (see `styled.ts`).
 *
 * THERE IS A MIDDLE NOW, AND THIS IS WHAT FALSIFIED THE PREMISE THAT SAID THERE WAS
 * NONE. It read: *TWO VALUES AND NO MIDDLE — green and red are what a terminal has
 * always said, a `warning` would be the third, and this surface has none to say*. The
 * argument for it was `antipatterns`, which states "reopened tasks: 3" and deliberately
 * refuses to call it bad, because three reopenings may be a team learning something (see
 * `verdict.ts`). THAT ARGUMENT SURVIVED WHOLE — a count is still not news — and what
 * fell over it is `verify`'s `hash-chain-only`: the level of a record whose hash chain
 * holds and whose signatures were never checked, because none was there to check. Green
 * would be a pass over exactly the record the levels were introduced to stop calling
 * verified; red would fail a project between its first event and its first checkpoint,
 * which is a legitimate state, and a gate that always fails is a gate somebody switches
 * off. The middle is the only truthful hue it has, and the difference from the count is
 * that a level is a RANK on a closed scale, not one category among several.
 *
 * The list is ordered worst news last, which is the only thing its order says: nothing
 * reads a severity by index, and the tables that consume it are total over the union.
 * Severity stays OPTIONAL, and absent stays the common case — most of what this surface
 * prints is neither news nor a rank.
 */
export const SEVERITIES = ['good', 'warn', 'bad'] as const;

/** How bad a part's news is. Closed: see {@link SEVERITIES} for why it has a middle. */
export type Severity = (typeof SEVERITIES)[number];

/** One part of a line: what it is, and what it says. */
export interface Part {
  /** What this part is on the line — what a renderer punctuates and may paint. */
  readonly role: Role;
  /** What it says, verbatim. Not a line: a renderer never splits or joins it. */
  readonly text: string;
  /**
   * How bad this part's news is, where something knows. Absent everywhere else, and
   * absent is the common case: a colour a renderer chose without being told would be
   * the renderer judging the record.
   */
  readonly severity?: Severity;
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
