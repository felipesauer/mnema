/**
 * TAB INSIDE THE SESSION — the same command tree three shells render, read by a fourth
 * consumer.
 *
 * `completion/tree.ts` walks the program once and answers with a VALUE: every command,
 * what can be typed after it, and the values a declaration enumerates. It was built
 * that way so it could have more than one consumer, and this is the second: nothing
 * here reads a `Command`, and nothing here knows what a verb is. A completer that
 * walked the program again would be a second answer to "what goes here", and the day
 * one of them learned about a new declaration the other would keep offering the old
 * surface — which is the defect the generated scripts exist to prevent, reappearing
 * inside the product.
 *
 * WHAT IT OFFERS IS WHAT THE SESSION RUNS, and that is one list rather than two.
 * {@link verbsOffered} is the gate's own answer, and it is what filters the top level
 * here: a Tab that offered `task` in a session that refuses `task` would be the surface
 * advertising what it will not do. It also refuses to descend — `task <TAB>` offers
 * nothing at all, rather than the subcommands of a verb this session cannot reach.
 *
 * ⚠️ IT SAID *WHAT IS NEVER OFFERED IS AN ID*, and it named exactly what would have to
 * change: an id is in no declaration, the only way to know one is to READ the record, and
 * inside a session that would be affordable for the first time — the floor is already
 * paid — and was still refused, because it is a different promise (a menu of the record,
 * which goes stale between keystrokes) and because it needed a decision nobody had taken.
 * The decision was taken, and it moves the PROMISE rather than the cost: what is offered
 * is the ids THIS SESSION HAS ALREADY SHOWN (`seen.ts`), which is not the record and
 * cannot go stale, because what has been said cannot be unsaid. Nothing here reads
 * anything — the offers come out of a value the page fills as lines land — and the count
 * that says this surface reads once, when it opens, is unchanged and is still the test
 * (`tests/the-name-and-the-hints.test.ts`).
 *
 * AND IT IS THE WHOLE ID, WHICH IS WHAT LEAVES `anchors.ts` INTACT. That module refuses
 * any short form for an entity id, because a short value that looks like the real one
 * becomes a trap the moment it is pasted where the real one goes. Completing invents no
 * form: what ends up on the row is the 36 characters, typed for the caller. So the
 * decision stands and what closes is the dead end it left in a console — where you read an
 * identifier on the screen and cannot type it back.
 *
 * AN ID IS NOT A VERB, so the top level never offers one. A line starts with a word this
 * session runs or a word it answers to itself; below that the caller is typing an
 * ARGUMENT, and an argument of this product is very often a record. The declaration's own
 * words go first there and the records come after them, so a level that has subcommands
 * still reads as its own menu rather than as a list of ids with a verb lost in it.
 *
 * WHAT IS OFFERED CARRIES WHAT IT IS, and it used to be a bare token. The tree has held a
 * word and its one-line description together since it was built — that is what makes the
 * generated scripts describe a verb — and everything on this path was throwing the second
 * half away, so a Tab that could not choose printed a row of names and left a reader to
 * guess. The words are handed on whole now, and the console shows both columns
 * (`palette.ts`). Nothing about WHAT is offered changed: the same candidates, in the same
 * order, and the same common prefix typed for the caller.
 *
 * A WORD WITH NOTHING TO SAY ABOUT IT IS STILL A WORD. A flag, an enumerated value and a
 * verb whose declaration describes it in no words all arrive with an empty description
 * rather than being left out — the offer is what can be TYPED here, and a menu that hid
 * what it could not annotate would be a completer with an opinion about the declaration.
 */

import { spellingsOf } from '../completion/lookups.js';
import type { CompletionNode, CompletionTree, CompletionWord } from '../completion/tree.js';

/**
 * What a Tab is answered with: the candidates, each with what it is, and the word they
 * replace.
 */
export type Completer = (line: string) => [hits: readonly CompletionWord[], word: string];

/** A node with nothing in it — what a level this session will not descend into offers. */
const NOTHING: CompletionNode = { path: '', commands: [], flags: [], values: [] };

/** Words a declaration enumerates without describing: what can be typed, and nothing more. */
function unexplained(words: readonly string[]): readonly CompletionWord[] {
  return words.map((word) => ({ word, description: '' }));
}

/**
 * The completer for a session: the tree, the words it offers at the top, the session's
 * own commands, and the records it has already named.
 *
 * `offered` and `session` arrive rather than being derived, so this file holds no
 * opinion about what a session accepts — it renders a menu of what it was told. The
 * one place that decides is `gate.ts`, which is also what decides whether the line is
 * then run.
 *
 * `shown` arrives for the same reason and for one more: it is the SESSION'S memory of
 * what it has put on the page (`seen.ts`), and a completer that went looking for records
 * itself would be the thing this file has always refused to be. What it is handed is a
 * question with an answer already in memory, never a door to the record.
 */
export function completerFor(
  tree: CompletionTree,
  offered: readonly string[],
  session: readonly CompletionWord[],
  shown: (word: string) => readonly CompletionWord[],
): Completer {
  const nodes = new Map(tree.nodes.map((node) => [node.path, node]));
  const root = nodes.get('') ?? NOTHING;

  // THE TOP LEVEL, WORDED ONCE. The gate answers with NAMES, because what a session may
  // run is a question about declarations and not about prose; what each of those verbs is
  // comes from the tree, which read it off the same declaration `--help` prints. A verb
  // the tree does not describe is offered undescribed rather than dropped.
  const describes = new Map(root.commands.map((child) => [child.word, child.description]));
  const top: readonly CompletionWord[] = [
    ...offered.map((word) => ({ word, description: describes.get(word) ?? '' })),
    ...session,
  ];

  /**
   * The node a caller is typing inside, walking only where this session may go — and
   * NOTHING AT ALL when the walk started with a verb this session refuses.
   *
   * ⚠️ IT ANSWERED WITH AN EMPTY NODE, and the two answers are no longer the same. An
   * empty node is a level with nothing declared in it, and a level now offers the records
   * the session has named as well; a verb this session cannot reach has no level to be
   * inside of, so `task <TAB>` has to keep offering nothing at all rather than becoming a
   * list of ids under a word the next line will refuse to run.
   */
  const nodeFor = (words: readonly string[]): CompletionNode | undefined => {
    let at = root;
    let path = '';
    for (const word of words) {
      if (word.startsWith('-')) continue;
      // The top level is filtered, and the filter is what stops the walk.
      if (path === '' && !offered.includes(word)) return undefined;
      const next = nodes.get(path === '' ? word : `${path} ${word}`);
      if (next === undefined) break;
      at = next;
      path = next.path;
    }
    return at;
  };

  return (line) => {
    const typed = line.split(/\s+/).filter((token) => token.length > 0);
    const word = /\s$/.test(line) ? '' : (typed.pop() ?? '');
    const node = nodeFor(typed);
    if (node === undefined) return [[], word];
    const starting = word.startsWith('-');
    const previous = typed.at(-1);

    // A flag that enumerates its values, and the caller is on the value. Asked first,
    // because `--scope <TAB>` offers three scopes and not the flags again.
    if (!starting && previous !== undefined && previous.startsWith('-')) {
      const values = node.flags.find(
        (flag) => flag.short === previous || flag.long === previous,
      )?.choices;
      if (values !== undefined && values.length > 0) {
        return [matching(unexplained(values), word), word];
      }
    }
    if (starting) return [matching(unexplained(spellingsOf(node)), word), word];

    // At the top level the offer is the session's: the reads, and the words the session
    // answers to itself. An id is not a word a line can start with, so no record is
    // offered here.
    if (node === root) return [matching(top, word), word];

    // Below it, whatever the declaration says goes there — and then the records this
    // session has already named, which is where an argument of this product usually
    // wants one. The declaration's words keep their own sorted block and the records
    // keep theirs, in the order the session showed them (`seen.ts`): concatenating two
    // answers rather than sorting one list is what stops a menu of subcommands from
    // being buried under ids that all begin with the same timestamp.
    const declared = matching([...node.commands, ...unexplained(node.values)], word);
    return [[...declared, ...shown(word)], word];
  };
}

/**
 * The candidates a word could still become, sorted, without repeats.
 *
 * Sorted because the order a Tab shows is the order a reader scans, and the tree's own
 * order is the order the HELP lists — which puts the writes first and is exactly the
 * wrong shape for a menu that holds none of them. Sorted BY THE WORD and by nothing
 * else, in the order a string comparison gives, which is the order the bare tokens came
 * out in before they carried a description.
 *
 * The first spelling of a repeated word wins, which is what keeps a described one from
 * being shadowed by the same word offered again from somewhere with nothing to say.
 */
function matching(words: readonly CompletionWord[], word: string): readonly CompletionWord[] {
  const found = new Map<string, CompletionWord>();
  for (const candidate of words) {
    if (!candidate.word.startsWith(word)) continue;
    if (!found.has(candidate.word)) found.set(candidate.word, candidate);
  }
  return [...found.values()].sort((one, other) =>
    one.word < other.word ? -1 : one.word > other.word ? 1 : 0,
  );
}
