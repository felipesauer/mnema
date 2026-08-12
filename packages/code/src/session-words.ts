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
 *
 * THERE WERE THREE OF THEM AND THERE IS ONE, and the two that went are the two a KEY
 * already answered. `/help` said what the session runs, and the list a slash opens says the
 * same thing beside every word of it, in the place the answer is needed rather than in a
 * report that scrolls away; `/exit` left, and {@link THE_KEY_THAT_LEAVES} has always done
 * that — it is the one keystroke this surface never had to teach. A word that is a second
 * way to reach what a key already gives is a second vocabulary to keep in step, and the
 * palette is what made both of them redundant rather than an argument about taste
 * (`repl/palette.ts`, and `tests/a-palette-for-the-words.test.ts` for what the list holds).
 *
 * WHAT STAYS IS THE ONE WORD NO KEY ANSWERS. `/clear` is an action of the SESSION and not a
 * verb of the record — nothing else on this surface starts the page over — so the rule that
 * every verb is reached through the list does not reach it: it is not one.
 */

/** What tells a word of the SESSION from a verb of the product. */
export const PREFIX = '/';

/**
 * THE KEY THAT ENDS THE SESSION, spelled once for the three places that name it: the row of
 * hints under the prompt, the refusals that tell a caller where to run a write, and the
 * declaration's own help.
 *
 * It is here rather than in the session because of the third reader, which is the same
 * argument the words above are here for: `mnema repl --help` is built before anything under
 * `repl/` is loaded, and a help that named a different key from the one the session answers
 * to is the defect this module exists to prevent. There is nothing to keep in step, because
 * there is one spelling.
 *
 * IT IS NOT ONE OF THE WORDS, and that is why it is a constant of its own rather than an
 * entry in {@link WHAT_EACH_WORD_DOES}: nothing is typed, so the gate has nothing to answer
 * to and the list has nothing to offer. What ends the input is the end of the input
 * (`repl/editing.ts`).
 */
export const THE_KEY_THAT_LEAVES = 'Ctrl-D';

/** Start the page over. What was on it is not destroyed — it is one scroll up. */
export const CLEAR = `${PREFIX}clear`;

/**
 * What each of them does, in the order the help lists them.
 *
 * THE WORDS ARE THE KEYS, and that is the whole shape: a list of words beside a table of
 * descriptions is two things to keep in step, and the one that goes stale is the
 * description — a word added to the list with nothing to say about it prints as a bare
 * token in `mnema repl --help`. Here a word that has no gloss cannot exist, because it
 * would have nothing to be a key of.
 *
 * ONE ENTRY IS NOT A DEGENERATE TABLE. What this shape buys is that the help, the gate and
 * the list all read the same rows, and that property is worth exactly as much with one row
 * as with three — the day a second word is worth having, it is added here and the three
 * readers have it.
 */
export const WHAT_EACH_WORD_DOES: Readonly<Record<string, string>> = {
  [CLEAR]: 'start the page over (what was on it stays in the scrollback)',
};

/**
 * The words the session answers to itself, in the order {@link WHAT_EACH_WORD_DOES}
 * gives them.
 *
 * This is the list the gate is total over and the list a Tab offers, so a word that is
 * not here is a word nothing answers to.
 */
export const SESSION_WORDS: readonly string[] = Object.keys(WHAT_EACH_WORD_DOES);
