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

import type { Column } from './items.js';
import type { Line } from './line.js';

/**
 * The subject line: the parts that identify one thing, separated so the eye reads
 * them as one heading rather than as columns of a table (which is what the two
 * spaces of form A mean). `show` names the kind, the id and the tree; `refs` names
 * the id and what it turned out to be.
 *
 * They are parts of a heading and nothing more specific: both callers pass what
 * identifies the thing and then where it lives, and neither says so anywhere a
 * renderer could read.
 */
export function subjectLine(...parts: readonly string[]): Line {
  return { indent: 0, parts: parts.map((text) => ({ role: 'subject', text })) };
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
 *
 * Its text is one FIELD — the same role an item's column takes — because a fact and
 * an item of one field are the same line, which is asserted rather than assumed
 * (`forms.test.ts`). The depth is the line's, so the two cannot disagree about how
 * far in one level is: there is one constant now, in the renderer.
 */
export function fact(text: string, depth = 1): Line {
  return { indent: depth, parts: [{ role: 'field', text }] };
}

/**
 * One fact that ends in a workflow STATE: the fact, then the position as its own part.
 *
 * It is {@link fact} with the state taken out of the sentence, and the split is the whole
 * of it — `show` printed `` `${title} (${state})` `` as a single field, so nothing could
 * paint the position without painting the title with it. The separator is the space the
 * concatenation already held (see `plain.ts`), which is why the bytes are unchanged and
 * the golden is the acceptance test for this.
 *
 * The state arrives as a COLUMN a caller already composed (`asState`, in `state.ts`),
 * never as a bare string: what a position means to a reader is decided in one place, and a primitive
 * that took the string would be a second place able to decide it differently.
 *
 * No `depth`: the one fact printed a level deeper is a command to type, and it has no
 * state in it.
 */
export function statedFact(text: string, state: Column): Line {
  return { indent: 1, parts: [{ role: 'field', text }, state] };
}
