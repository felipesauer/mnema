/**
 * WHAT THE BARE NAME OFFERS — the doors, and the page they are drawn as.
 *
 * `mnema` with nothing after it used to print the catalogue: thirty verbs at once,
 * with the options above them. That is the right answer for somebody who knows what they
 * are looking for and the wrong one for somebody who has just typed the name of a program.
 * So the name ASKS, and this is what it asks with.
 *
 * NOTHING HERE DRAWS AND NOTHING HERE READS. It is a function from two facts — what the
 * program declared, and whether there is a project in this directory — to a list of doors
 * and a list of lines. Every case about what the bare name offers is therefore a case with
 * no terminal in it, which is the same division `repl/editing.ts` makes between what a row
 * SAYS and where it lands.
 *
 * THE OPTIONS ARE A FUNCTION OF THE DIRECTORY, because the question is *what do you want
 * to do HERE*. Offering "open the console" where there is no record is offering a door onto
 * an empty room, and somebody who runs `mnema` in a directory with no project almost always
 * wants to start one. So the first door is the console in a project and `init` outside one,
 * and the second door — the catalogue — is the same in both: it is the answer this
 * invocation used to give, kept, one keystroke away.
 *
 * WHAT EACH DOOR SAYS IT DOES IS THE VERB'S OWN SENTENCE, read off the declaration
 * commander routes with ({@link whatItDeclares}). A door that carried its own copy of that
 * sentence would be a second description of one verb, and the day the verb's changed the
 * menu would go on advertising the old one — which is the shape this surface has spent
 * three deliveries removing. The catalogue's line is this file's, because the catalogue is
 * not a verb: it is what `--help` prints, and there is no declaration to read it off.
 *
 * AND THE ROWS ARE THE SAME TABLE THE LIST OF WORDS IS. The mark is a COLUMN
 * (`repl/palette.ts` says why: a hue is a second axis over it, and a mark works in
 * monochrome and for a reader who does not separate two tones), the columns are the two
 * functions every list of this product is built out of (`presentation/items.ts`), and which
 * word is picked is the one reading of that question there is ({@link thePicked}). What is
 * NOT here is the window and the account of what had no room: those exist because a
 * vocabulary is longer than a screen, and there are two doors.
 */

import { aside, subjectLine } from '../presentation/detail.js';
import { asPick, type Column, column, itemLine } from '../presentation/items.js';
import type { Line } from '../presentation/line.js';
import type { Render } from '../presentation/render.js';
import { NOBODY, PICK, thePicked } from '../repl/palette.js';
import { INIT_VERB } from '../wiring/init.js';
import { REPL_VERB } from '../wiring/repl.js';
import type { Declared } from '../wiring/verb.js';

/**
 * WHAT THE NAME ASKS, beside the name itself.
 *
 * *Here* is load-bearing rather than conversational: the two doors below are a function of
 * this directory, so a question that left it out would be asking something the answer does
 * not depend on.
 */
const THE_QUESTION = 'what would you like to do here?';

/** What the first door is called, in a project and outside one. */
const OPEN_THE_CONSOLE = 'open the console';
const ESTABLISH_A_PROJECT = 'establish a project here';

/** What the second door is called, and what it does — the one line no verb declares. */
const SEE_WHAT_THE_VERBS_DO = 'see what the verbs do';
const THE_CATALOGUE = 'every verb this product has, and what each one takes';

/**
 * How the catalogue is asked for: the flag commander answers with the help.
 *
 * IT IS THE FLAG AND NOT THE `help` VERB, and the two are not the same line. `mnema --help`
 * prints the catalogue on stdout and exits zero, which is a caller getting exactly what they
 * asked for; the bare name prints the same text on stderr and exits one, because nothing was
 * asked. A door that ran the second would be a menu whose every choice failed.
 */
const THE_HELP_FLAG = '--help';

/** The gap between a door's name and what it does. One column of the table, so `column` pads it. */
const AFTER_THE_WORD = 1;

/** How wide the column the mark sits in is: as wide as the mark, and read off the mark. */
const AS_WIDE_AS_THE_MARK = [...PICK].length;

/**
 * THE THREE CLAUSES OF THE ROW UNDER THE DOORS — a KEY, and what that key gives, in the
 * shape every hint on this surface has (`repl/session.ts`, `pickingTips`).
 *
 * ENTER CHOOSES, AND THE LIST OF WORDS SAYS *Enter fills the row*. The words differ because
 * the keys do different things, and saying so is the whole point of a hint: a pick in the
 * console puts a word on a line the caller is still writing, and a pick here is the answer.
 * What may NOT differ is how the keys MOVE, and it does not — the arrows walk this list with
 * the function they walk that one with ({@link theNextPicked}).
 *
 * The arrows are one clause because they are one affordance, drawn as the glyphs a keyboard
 * has — UPWARDS ARROW U+2191 and DOWNWARDS ARROW U+2193, spelled by their code points like
 * every unusual byte in this repository.
 */
const ARROWS_MOVE = '\u2191\u2193 moves';
const RETURN_CHOOSES = 'Enter chooses';
const ESCAPE_LEAVES = 'Esc leaves';

/** What separates the words of a hint from the next. The surface's own separator. */
const BETWEEN_CLAUSES = ' · ';

/**
 * ONE DOOR: what a reader picks, what it does, and THE LINE IT RUNS.
 *
 * The line is the whole of what choosing does, and that is the guarantee rather than an
 * implementation note: every door is a line this CLI could have been given at a shell, so
 * nothing can happen through this door that could not happen by typing. It also means the
 * choice needs no idea of what a console or an `init` IS — it hands the line to the same
 * entry every invocation goes through.
 *
 * It is structurally a `CompletionWord` — a word and what it is — which is what lets the
 * list of words' own arrows walk it without a shape of its own ({@link theNextPicked}).
 */
export interface Door {
  /** What a reader picks. The key the arrows move by, so it is what a pick NAMES. */
  readonly word: string;
  /** What it does, in the words of whatever declares it. */
  readonly description: string;
  /** The line it runs — what the caller would have typed to get the same thing. */
  readonly argv: readonly string[];
}

/**
 * THE DOORS, given what this program declared and whether there is a project here.
 *
 * Two, always: the one that depends on the directory, and the catalogue. A third would be a
 * menu rather than a question, and the catalogue is where everything else already is.
 */
export function theDoors(verbs: readonly Declared[], inProject: boolean): readonly Door[] {
  const first = inProject
    ? { word: OPEN_THE_CONSOLE, verb: REPL_VERB }
    : { word: ESTABLISH_A_PROJECT, verb: INIT_VERB };
  return [
    {
      word: first.word,
      description: whatItDeclares(verbs, first.verb),
      argv: [first.verb],
    },
    { word: SEE_WHAT_THE_VERBS_DO, description: THE_CATALOGUE, argv: [THE_HELP_FLAG] },
  ];
}

/**
 * What a verb's own declaration says it does — the sentence `mnema --help` prints beside it.
 *
 * A verb this program does not declare says nothing, which is the same answer the list of
 * words gives a word with no gloss (`repl/complete.ts`): what is offered is what can be
 * chosen, and a menu with an opinion about the declaration would be a second declaration.
 * That it is never empty for the two verbs offered here is asserted rather than assumed —
 * an empty column is exactly what a rename would leave behind.
 */
function whatItDeclares(verbs: readonly Declared[], verb: string): string {
  return verbs.find((declared) => declared.command.name() === verb)?.command.description() ?? '';
}

/**
 * THE WHOLE PAGE, as the rows a screen draws: what is being asked, the doors, and the keys
 * that answer — with the breath between them.
 *
 * ONE COMPOSITION AND IT IS COMPLETE, which is what keeps the drawing from arranging
 * anything: the layout receives strings in the order they are read, so a blank row is a row
 * of this page rather than a decision taken where the page is placed. It is the same
 * division the list of words keeps (`repl/palette.ts`, `paletteFor`) — composed here, cut
 * here, rendered here, and placed there.
 *
 * `name` is the program's own, read off the declaration rather than spelled here — the one
 * place this file could otherwise have written the product's name down a second time.
 */
export function theChoicePage(
  name: string,
  doors: readonly Door[],
  picked: string,
  render: Render,
): readonly string[] {
  const said = (line: Line): string => render(line);
  return [
    said(subjectLine(name, THE_QUESTION)),
    A_BLANK_ROW,
    ...theDoorRows(doors, picked).map(said),
    A_BLANK_ROW,
    said(theKeys()),
  ];
}

/** One row of breath. It is a row of the page, so it is counted with the others. */
const A_BLANK_ROW = '';

/**
 * The doors as rows of one table: a mark column, the name, and what it does.
 *
 * The left column is as wide as the widest name IN THIS LIST, so the second column sits
 * where the first one ends rather than under a gap left by a word that is not here.
 */
export function theDoorRows(doors: readonly Door[], picked: string): readonly Line[] {
  const width = doors.reduce((most, door) => Math.max(most, door.word.length), 0) + AFTER_THE_WORD;
  return doors.map((door) =>
    itemLine([markFor(doors, door.word, picked), column(door.word, width), door.description]),
  );
}

/**
 * The mark for one row: the glyph on the picked door, and a blank column on every other.
 *
 * The picked one says what it IS and the others do not, which is the whole of what the role
 * buys: a blank column is padding — it holds the table open — and a renderer told it was a
 * mark would wrap two spaces in the escapes that paint one. The bytes of an unmarked row are
 * the bytes it would have had with no mark in the table at all.
 */
function markFor(doors: readonly Door[], word: string, picked: string): string | Column {
  return word === thePicked(doors, picked)
    ? asPick(column(PICK, AS_WIDE_AS_THE_MARK))
    : column(NOBODY, AS_WIDE_AS_THE_MARK);
}

/**
 * THE KEYS THAT ANSWER, as the row under the doors.
 *
 * It says nothing about the record and takes no argument, so it is the same line at every
 * moment this page is on the screen. Exported so a case can tell this row from a door
 * without retyping it — a retyped row goes stale the day the words change.
 */
export function theKeys(): Line {
  return aside([ARROWS_MOVE, RETURN_CHOOSES, ESCAPE_LEAVES].join(BETWEEN_CLAUSES));
}
