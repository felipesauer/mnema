/**
 * THE BARE NAME, ASKING — the doors on the screen, the arrows moving through them, and the
 * one line the caller chose.
 *
 * IT ANSWERS WITH A LINE AND RUNS NOTHING. What comes back is an argv the entry then hands
 * to the same `run` every invocation of this binary goes through, so the whole of what this
 * door can do is the whole of what could be typed — there is no path into the product that
 * only exists inside a menu. It is also why nothing here knows what a console or an `init`
 * is: it knows two words and which of them the caller landed on.
 *
 * NOTHING IS WRITTEN BY ASKING. What it reads is where the session is standing
 * (`repl/standing.ts`: one `readdir` and one small file, no chain opened, no writer opened)
 * and what the program declared. A caller who presses Escape leaves a record with exactly as
 * many events in it as it had — which is asserted against the record rather than reasoned
 * about, and with teeth, in `tests/the-bare-name-asks.test.ts`.
 *
 * THE ARROWS ARE THE LIST OF WORDS' ARROWS. `theNextPicked` is the function the console's
 * palette moves its mark with, and it is called here with this list — so the ends HOLD
 * rather than wrap, a step is a step, and there is one answer in this product to *where does
 * an arrow leave the pick*. A second reducer would be a second thing for a finger to learn.
 *
 * AND A CHUNK IS NOT A KEY. A terminal hands over whatever arrived since it was last read,
 * so a fast keyboard or a paste is several keystrokes in one string; `keystrokesOf` is the
 * reading that turns one into the other, and it is the console's, for the reason it exists
 * there (`repl/editing.ts`, measured on a chord followed by two commands).
 *
 * THE DECISION ABOUT COLOUR REACHES THE LAYOUT LIBRARY BEFORE A BYTE OF IT IS LOADED, and
 * the order of the two lines that do it is the mechanism rather than tidiness: that library
 * reads the channel once while its own module graph is being loaded, so a call after the
 * import would be said to nobody (`repl/painting.ts`). This is the second door onto that
 * library and it obeys the same rule as the first, which is enumerated rather than promised
 * (`tests/one-authority-over-colour.test.ts`).
 */

import { buildProgram } from '../cli.js';
import { type Keystroke, keystrokesOf } from '../repl/editing.js';
import type { Leaving } from '../repl/leaving.js';
import { theLibraryIsTold } from '../repl/painting.js';
import { theNextPicked, thePicked } from '../repl/palette.js';
import { standing } from '../repl/standing.js';
import { paintsAtAll } from '../wiring/color.js';
import type { CliIo } from '../wiring/io.js';
import { type Door, theChoicePage, theDoors } from './doors.js';
import type { Screen } from './screen.js';

/** Which way an arrow moves the pick: one door back, or one door on. */
const A_DOOR_BACK = -1;
const A_DOOR_ON = 1;

/** What asking needs: where to write, the two ends of the terminal, and the ways out. */
export interface ChoiceRequest {
  /**
   * Where a verb of this program would write.
   *
   * Nothing here prints — the page goes to the layout, and what the caller chose is printed
   * by the line they chose. It travels because the program is BUILT with it, and a program
   * built with a port nobody hands it would answer a refusal onto the wrong stream the day
   * one is reachable from here.
   */
  readonly io: CliIo;
  /** Where the keystrokes come from. */
  readonly input: NodeJS.ReadStream;
  /** The page the choice is drawn on. */
  readonly output: NodeJS.WriteStream;
  /** Every way this process can stop, so the terminal is given back in all of them. */
  readonly leaving: Leaving;
}

/**
 * Asks, and answers with the line the caller chose — or with nothing when they left.
 *
 * NOTHING IS NOT AN ERROR, and the exit code says so: asking is not a failure, so a caller
 * who pressed Escape, Ctrl-C or Ctrl-D gets their prompt back with a zero. The three are one
 * answer because they are one intention — this is not what I wanted — and a menu that
 * distinguished them would be inventing a difference a finger does not make.
 *
 * THE PROGRAM IS BUILT HERE FOR ITS DECLARATIONS ALONE: the name it is registered under, and
 * what each verb says it does. It is a second build on this path and it is declarations only
 * — no adapter, no domain — which is exactly what the floor work made cheap
 * (`wiring/verb.ts`). What it buys is that the line a caller chooses goes through the same
 * `run` as every other invocation, with the same reading of what they typed, rather than
 * through a parser this door kept for itself.
 */
export async function theChoice(request: ChoiceRequest): Promise<readonly string[] | undefined> {
  const built = buildProgram(request.io);
  // WHETHER THERE IS A PROJECT HERE, asked of the one function that answers where a surface
  // of this product is standing. A second reading — looking for the directory, say — would be
  // a second idea of what a project IS, and this surface already has one.
  const doors = theDoors(built.verbs, standing().project !== undefined);
  const name = built.program.name();
  // THE FIRST DOOR IS PICKED BEFORE A KEY IS PRESSED, which is the one place this list
  // differs from the console's and it is a difference in what a Return MEANS. There, Return
  // hands the row over unless an arrow chose a word, so a mark before the first arrow would
  // promise a choice the key is not about to make; here Return is the only way to answer, so
  // a page that opened with nothing marked would be a question with no answer under the
  // cursor. Everything after this instant is `theNextPicked`'s.
  let picked = doors[0]?.word ?? '';

  theLibraryIsTold(paintsAtAll(built.render));
  const { openScreen } = await import('./screen.js');

  return await new Promise<readonly string[] | undefined>((resolve) => {
    let screen: Screen | undefined;
    let left = false;

    const page = (): readonly string[] => theChoicePage(name, doors, picked, built.render);

    /**
     * THE DOOR THE MARK IS ON — the same reading the mark itself is drawn by.
     *
     * A pick is a WORD and a word is picked exactly while the list holds it
     * ({@link thePicked}, and `repl/palette.ts` for the argument). Asked here rather than
     * compared inline, so what Return takes and what the row shows cannot become two
     * answers about one choice.
     */
    const theDoorPicked = (): Door | undefined => {
      const word = thePicked(doors, picked);
      return doors.find((door) => door.word === word);
    };

    /** The caller answered — with a line, or with nothing. The terminal goes back either way. */
    const leave = (chosen: readonly string[] | undefined): void => {
      if (left) return;
      left = true;
      screen?.close();
      resolve(chosen);
    };

    /** One key, and everything one key can do to this page. */
    const key = (stroke: Keystroke): void => {
      if (left) return;
      // ASKED FIRST AND OF THE WHOLE KEYSTROKE, because a control chord carries a character
      // too (Ctrl-D is `d`): a reducer that looked at the letter before the chord would read
      // the two ways out as somebody typing.
      if (stroke.ctrl) {
        if (stroke.input === 'c' || stroke.input === 'd') leave(undefined);
        return;
      }
      if (stroke.escape) {
        leave(undefined);
        return;
      }
      if (stroke.return) {
        leave(theDoorPicked()?.argv);
        return;
      }
      if (stroke.upArrow || stroke.downArrow) {
        picked = theNextPicked(doors, picked, stroke.upArrow ? A_DOOR_BACK : A_DOOR_ON);
        screen?.show(page());
      }
      // AND EVERY OTHER KEY DOES NOTHING, which is the arm that has to exist: a page that
      // threw on a function key would be a question that dies of one.
    };

    screen = openScreen({
      stdin: request.input,
      stdout: request.output,
      rows: page(),
      pressed: (stroke) => {
        for (const one of keystrokesOf(stroke)) key(one);
      },
      leaving: request.leaving,
    });
  });
}
