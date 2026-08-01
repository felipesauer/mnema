/**
 * FORM B — one thing in detail: a line naming the subject, then the facts about
 * it, indented under it.
 *
 * Three of the CLI's readings are this form (`show`, `focus`, `resume`), and so is
 * every WRITE's report: `Created task …` followed by what the door replaced,
 * `Initialized mnema project at …` followed by the identity and the keys. The
 * subject line answers "what is this", the indented lines answer "what is true
 * about it", and the indentation is what makes the second sort belong to the
 * first — a fact at column zero reads as a new subject.
 *
 * The two halves are separate functions rather than one block builder because they
 * are used apart as often as together: a write prints its own headline (it is a
 * sentence, not a subject with parts) and then indents one notice under it, while
 * `show` composes a subject out of parts and then indents four facts. A single
 * `block(headline, facts)` would have to take an empty list half the time.
 *
 * Nothing here collapses whitespace, and for form B that is not a compromise but
 * the rule: a fact printed on a line of its OWN is not in the one-line-per-item
 * class. A newline in a record's title makes the output ugly; it forges nothing,
 * because there is no list of one-line items around it for the second half to
 * imitate.
 */

/** The two spaces a fact is indented under its subject by. */
const INDENT = '  ';

/** What separates the parts of a subject line: what it is, then where it lives. */
const PART_GAP = '  ·  ';

/**
 * The subject line: the parts that identify one thing, separated so the eye reads
 * them as one heading rather than as columns of a table (which is what the two
 * spaces of form A mean). `show` names the kind, the id and the tree; `refs` names
 * the id and what it turned out to be.
 */
export function subjectLine(...parts: readonly string[]): string {
  return parts.join(PART_GAP);
}

/**
 * One fact about the subject above, indented under it. It is also what form C's
 * EVIDENCE line is — an issue under a verdict is indented exactly like a fact
 * under a subject, and calling it two things would be inventing a distinction the
 * output does not make.
 *
 * `depth` is 2 in exactly one place, and it earns it: the command `key request`
 * tells the person to run on the OTHER machine. Set off from the sentence that
 * introduces it, it is visibly a line to be TYPED rather than read — which is what
 * a person scanning for the thing to copy is looking for. Flattened it becomes the
 * third line of a paragraph, and the one piece of that output the reader has to
 * act on stops looking different from the prose around it.
 *
 * That is not the nesting a list uses. {@link itemLine} has no depth at all: an
 * item is an item, and the one reading that used a second level to mean "this
 * belongs to the group above" says it in words now. Here the second level marks a
 * LITERAL, not a rank, and one use is the honest count of how often output has
 * something to be typed verbatim.
 */
export function fact(text: string, depth = 1): string {
  return `${INDENT.repeat(depth)}${text}`;
}
