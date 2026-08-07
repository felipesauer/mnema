/**
 * THE WORDS A SESSION ANSWERS TO ITSELF — one source, and the prefix that makes them
 * un-collidable.
 *
 * A session runs the verbs of this product, and it also answers to a few words of its
 * own. Those two sets share one line of input, so they need a rule that keeps them apart
 * forever rather than a precedence nobody asked for: every verb of this product is
 * lowercase letters and dashes, so a leading character that is neither means no word here
 * can ever shadow a verb, and no verb added later can shadow one of these.
 *
 * THE PREFIX IS A SLASH, AND IT USED TO BE A DOT. The dot was chosen for the property
 * above, which the slash has in exactly the same way — so what decided between them is
 * the reader: the consoles a person types a sentence into converge on `/`, and this is
 * one of those rather than a language REPL. The doc used to say the dot was "the spelling
 * `node`, `python` and `psql` all answer to", and that is what changed hands: those are
 * language prompts, and the thing this looks like is a conversational console. What did
 * NOT change is the keystroke that carries the muscle memory worth keeping — Ctrl-D still
 * leaves.
 *
 * IT IS ITS OWN MODULE BECAUSE TWO PLACES READ IT AND ONE OF THEM MAY NOT REACH THE
 * SESSION. `mnema repl --help` lists these words while commander is being configured, and
 * the session that answers to them is loaded only when the verb runs
 * (`tests/the-floor-is-the-declaration.test.ts` holds that boundary: nothing under
 * `repl/` is in the closure a `mnema --version` pays for). So the declaration read them
 * off nothing and typed them out instead, and a help that lists a word the gate does not
 * answer to is the defect that shape produces. One module, above both, reachable by the
 * declaration and by the gate.
 */

/** What tells a word of the SESSION from a verb of the product. */
export const PREFIX = '/';

/** Leave the session. Ctrl-D does the same, and always has. */
export const LEAVE = `${PREFIX}exit`;

/** What this session runs, and how to leave it. */
export const ABOUT = `${PREFIX}help`;

/**
 * What each of them does, in the order the help lists them.
 *
 * THE WORDS ARE THE KEYS, and that is the whole shape: a list of words beside a table of
 * descriptions is two things to keep in step, and the one that goes stale is the
 * description — a word added to the list with nothing to say about it prints as a bare
 * token in `mnema repl --help`. Here a word that has no gloss cannot exist, because it
 * would have nothing to be a key of.
 */
export const WHAT_EACH_WORD_DOES: Readonly<Record<string, string>> = {
  [ABOUT]: 'what this session runs',
  [LEAVE]: 'leave (so does Ctrl-D; Ctrl-C clears the line you are typing)',
};

/**
 * The words the session answers to itself, in the order {@link WHAT_EACH_WORD_DOES}
 * gives them.
 *
 * This is the list the gate is total over and the list a Tab offers, so a word that is
 * not here is a word nothing answers to.
 */
export const SESSION_WORDS: readonly string[] = Object.keys(WHAT_EACH_WORD_DOES);
