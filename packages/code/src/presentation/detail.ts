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
 * Nothing here collapses whitespace, and that is still the primitive's rule: a part's
 * text is TEXT, and what is in it is decided where the value enters the line.
 *
 * WHAT IT USED TO SAY WAS THAT FORM B IS EXEMPT — *a fact printed on a line of its OWN
 * is not in the one-line-per-item class; a newline in a record's title makes the output
 * ugly, and ugly is not forgery, because there is no list of one-line items around it
 * for the second half to imitate.* THE ARGUMENT SURVIVES FOR THE BODY AND NOT FOR THE
 * FACTS. A body really has no list around it, and `show` exists to serve it whole. The
 * facts above it are not a body: they are lines at ONE depth under a subject, so a
 * second line at that depth is a FACT the record does not hold — `about …`, `topic: …`,
 * `supersedes …` — which is the same forgery a list row is, with the subject standing in
 * for the header. What was too broad was reading "no list" off the FORM when it is a
 * property of the one field that is a paragraph. See `record.ts`, which collapses its
 * facts and not its bodies, and
 * `tests/the-line-a-reading-words-is-one-line.test.ts`, which reconciles the five.
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
 * An ASIDE: a line about the SURFACE rather than about the record.
 *
 * It is {@link fact}'s sibling and the difference is what it is about. A fact is
 * about the record; an aside is about the surface — the words a session answers
 * to, the key that leaves it, the directory it was opened in. Nothing about the
 * record is stated, so nothing here is a verdict, a count or a stored value, and
 * that is exactly what makes it the one line a reader should be able to skip past
 * once they know it.
 *
 * THIS USED TO SAY AN ASIDE WAS A LINE THAT SAYS WHAT THE READER CAN DO, and what
 * falsified it is the console's status line: the project a session was opened in
 * and the identity this installation recorded for it (`repl/standing.ts`). Neither
 * is something to do, both are about where the SESSION is standing rather than
 * about the record, and the whole of `standing.ts` is the argument that the record
 * is not consulted for either. What survived is the meaning — secondary, and you
 * may skip it — and what was too narrow was naming one KIND of such line as though
 * it were the only one.
 *
 * Which is why it takes the `detail` role: DIM is what this surface already means
 * by "secondary, and you may skip it" (see `styled.ts` — it is what an id and an
 * instant take, for the same reason). No role and no hue was invented for it; the
 * plain renderer writes the words and nothing else, so a reader in a pipe or on a
 * monochrome terminal loses nothing, because there was nothing only the weight
 * said.
 *
 * It sits at the same depth a fact does. The two are read together — a session's
 * opening says what it runs and then what to type — and a different indent would
 * say one of them belongs to the other.
 */
export function aside(text: string): Line {
  return { indent: 1, parts: [{ role: 'detail', text }] };
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
