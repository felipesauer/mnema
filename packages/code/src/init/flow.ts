/**
 * THE QUESTIONS OF `mnema init`, ASKED ON THE SCREEN THE BARE NAME ALREADY USES: the trail from the first
 * screen to the one confirmation.
 *
 * IT DRAWS WITH WHAT THE PRODUCT HAS and adds nothing to it. A question is a page of rows handed to
 * `openScreen` (`choice/screen.ts`, which draws rows and reads keys and decides nothing), the keys go
 * through the reducers (`init/keys.ts`), and what is left on the page when a question is answered is
 * PRINTED, not drawn: the lines of the trail that stay in the scrollback are the same `Line`s the
 * renderer turns into bytes for every other report, so the colour and the fold are that renderer's and
 * the width is asked of nobody here (`tests/one-authority-over-colour.test.ts`,
 * `tests/one-width-per-frame.test.ts`).
 *
 * NOTHING IS WRITTEN BEFORE THE ONE CONFIRMATION, and not by this module at all: it returns what the
 * person answered, and the verb writes. A person who leaves at any step (Esc, Ctrl-C, Ctrl-D, or the
 * `Leave` of the plan) gets a line that says nothing was founded and a zero exit, as the bare name's
 * menu does, and the folder and the home are as they were (`the-init-asks-which-host-files-to-write.test.ts`
 * compares both, byte for byte, at every step).
 *
 * THE PLAN IS PRINTED AND THE CONFIRMATION IS DRAWN, which is the one place this departs from drawing a
 * whole screen: a plan of twenty rows is taller than a small terminal, and a page taller than its terminal
 * makes the library redraw the whole of it on every key. Printed, it is in the scrollback after the
 * confirmation, which is where a person goes to check what they agreed to.
 */

import { theScreens } from '../choice/asked.js';
import type { CompletionWord } from '../completion/tree.js';
import type { Line } from '../presentation/line.js';
import type { Render } from '../presentation/render.js';
import { type Keystroke, keystrokesOf } from '../repl/editing.js';
import type { Leaving } from '../repl/leaving.js';
import type { CliIo } from '../wiring/io.js';
import type { Around } from './detect.js';
import { HOST_ROWS, hostMark, type RowId, yoursMark } from './hosts.js';
import { onTheHosts, onTheOptions, type Step } from './keys.js';
import { theWidthOf } from './layout.js';
import { type Accepts, type Answers, instructionRows, type Machine, planOf } from './plan.js';
import {
  ACCEPTS_OPTIONS,
  acceptsAnswered,
  acceptsPage,
  agreedLines,
  confirmPage,
  HOSTS_QUESTION,
  hostItems,
  hostsAnswered,
  hostsPage,
  leftLine,
  PLAN_OPTIONS,
  planPage,
  theFirstScreen,
} from './screens.js';

/** Where a question is drawn and where its keys come from. */
export interface Terminal {
  readonly input: NodeJS.ReadStream;
  readonly output: NodeJS.WriteStream;
  /** Every way this process can stop, so the terminal is given back in all of them. Absent: the process's own. */
  readonly leaving?: Leaving;
}

/** What a question needs besides its own page. */
export interface Asking {
  readonly io: CliIo;
  readonly render: Render;
  readonly terminal: Terminal;
}

/** One question, as a state and what its page and its keys are. */
interface Question<State, Answer> {
  readonly initial: State;
  readonly page: (state: State, width: number) => readonly Line[];
  readonly on: (state: State, stroke: Keystroke) => Step<State, Answer>;
  /** What is left on the page once it is answered: the question's frame becomes these lines. */
  readonly answered: (answer: Answer, width: number) => readonly Line[];
  /** What is left on the page when the person leaves. */
  readonly left: readonly Line[];
}

/** What a question came to. */
export type Asked<Answer> =
  | { readonly kind: 'answered'; readonly answer: Answer }
  | { readonly kind: 'left' };

/**
 * The output with a note kept of the last character written to it, for the one thing the screen leaves to
 * whoever opened it: where the layout library runs in its screen-reader mode, the frame it leaves ends
 * without a line break, and the line printed after it was glued to its last row (`INK_SCREEN_READER=true`,
 * measured on the built binary). Every other mode ends the frame with one, and nothing is added there.
 */
function watched(output: NodeJS.WriteStream): {
  readonly stream: NodeJS.WriteStream;
  readonly endsALine: () => boolean;
} {
  let last = '\n';
  const stream = new Proxy(output, {
    get(target, property) {
      if (property === 'write') {
        return (chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
          const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
          if (text.length > 0) last = text.slice(-1);
          return (target.write as (...all: unknown[]) => boolean)(chunk, ...rest);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { stream, endsALine: () => last === '\n' };
}

/**
 * Puts one question on the screen and answers when the person has: with the answer, or with the fact that
 * they left. The terminal goes back in both, and in every other way this process can stop
 * (`armLeaving`, in `choice/screen.ts`).
 */
export async function putTheQuestion<State, Answer>(
  asking: Asking,
  question: Question<State, Answer>,
): Promise<Asked<Answer>> {
  const { render, terminal } = asking;
  const openScreen = await theScreens(render);
  const leaving = terminal.leaving ?? (await import('../repl/leaving.js')).leavingProcess;
  const width = theWidthOf(render);
  const page = watched(terminal.output);
  const rows = (state: State): readonly string[] =>
    question.page(state, width).map((line) => render(line));
  return await new Promise<Asked<Answer>>((resolve) => {
    let state = question.initial;
    let settled = false;
    const settle = (result: Asked<Answer>): void => {
      if (settled) return;
      settled = true;
      // THE FRAME THE QUESTION LEAVES ON THE PAGE IS THE ANSWER. The layout library does not take its
      // rows back when it is unmounted: what was drawn last stays where it was drawn (measured on the
      // bare name's menu), so the last thing drawn is the line a person is to find in the scrollback.
      screen.show(
        (result.kind === 'answered' ? question.answered(result.answer, width) : question.left).map(
          (line) => render(line),
        ),
      );
      screen.close();
      if (!page.endsALine()) terminal.output.write('\n');
      resolve(result);
    };
    const onAKey = (stroke: Keystroke): void => {
      if (settled) return;
      const next = question.on(state, stroke);
      if (next.kind === 'left') {
        settle({ kind: 'left' });
        return;
      }
      if (next.kind === 'done') {
        settle({ kind: 'answered', answer: next.answer });
        return;
      }
      if (next.state !== state) {
        state = next.state;
        screen.show(rows(state));
      }
    };
    const screen = openScreen({
      stdin: terminal.input,
      stdout: page.stream,
      rows: rows(state),
      pressed: (stroke) => {
        for (const one of keystrokesOf(stroke)) onAKey(one);
      },
      leaving,
    });
  });
}

/** Prints lines of the trail to the page: what stays in the scrollback. */
export function printed(asking: Pick<Asking, 'io' | 'render'>, lines: readonly Line[]): void {
  for (const line of lines) asking.io.out(asking.render(line));
}

/** The marks a question opens with: the hosts found here, or every host where none was; the person's files all. */
export function defaultMarks(around: Pick<Around, 'detected' | 'files'>): ReadonlySet<string> {
  const hosts: readonly RowId[] =
    around.detected.size === 0
      ? HOST_ROWS.map((row) => row.id)
      : HOST_ROWS.filter((row) => around.detected.has(row.id)).map((row) => row.id);
  const yours = HOST_ROWS.flatMap((row) => row.yours).filter(
    (path) => around.files.get(path)?.exists === true,
  );
  return new Set([...hosts.map(hostMark), ...yours.map(yoursMark)]);
}

/**
 * The marks a list of hosts given as a flag means: those rows, and the person's files under them
 * where the row is in the list. `detected` is the hosts found here, none where nothing was.
 */
export function marksForHosts(
  around: Pick<Around, 'detected' | 'files'>,
  hosts: readonly RowId[],
  detected: boolean,
): ReadonlySet<string> {
  const chosen = detected
    ? HOST_ROWS.filter((row) => around.detected.has(row.id))
    : HOST_ROWS.filter((row) => hosts.includes(row.id));
  const marks = new Set<string>();
  for (const row of chosen) {
    marks.add(hostMark(row.id));
    for (const path of row.yours) {
      if (around.files.get(path)?.exists === true) marks.add(yoursMark(path));
    }
  }
  return marks;
}

/** The question of the hosts, asked: the marks the person left on, or that they left. */
export async function askTheHosts(
  asking: Asking,
  around: Pick<Around, 'detected' | 'files'>,
  initial: ReadonlySet<string>,
  question: string = HOSTS_QUESTION,
  left: readonly Line[] = [leftLine()],
): Promise<Asked<ReadonlySet<string>>> {
  const items = hostItems(around.files);
  return await putTheQuestion(asking, {
    initial: { marks: initial, picked: items[0]?.word ?? '' },
    page: (state, width) => hostsPage(around, state, width, question),
    on: (state, stroke) => onTheHosts(items, state, stroke),
    answered: (marks, width) => hostsAnswered(marks, instructionRows(around, marks), width),
    left,
  });
}

/** The question of who may accept: `yes` or `no`, or that the person left. */
async function askWhoMayAccept(asking: Asking, opening: Accepts): Promise<Asked<Accepts>> {
  const asked = await putTheQuestion<string, string>(asking, {
    initial: opening,
    page: acceptsPage,
    on: (picked, stroke) => onTheOptions(ACCEPTS_OPTIONS, picked, stroke),
    answered: (answer, width) => acceptsAnswered(answer as Accepts, width),
    left: [leftLine()],
  });
  return asked.kind === 'left' ? asked : { kind: 'answered', answer: asked.answer as Accepts };
}

/** The one confirmation: `found`, `change` or `leave`. */
async function askToGoAhead(asking: Asking): Promise<Asked<string>> {
  return await putTheQuestion(asking, {
    initial: PLAN_OPTIONS[0]?.word ?? 'found',
    page: confirmPage,
    on: (picked, stroke) => onTheOptions(PLAN_OPTIONS as readonly CompletionWord[], picked, stroke),
    answered: (answer) => (answer === 'found' ? agreedLines : [leftLine()]),
    left: [leftLine()],
  });
}

/** What the person decided, or that they left. */
export type Outcome =
  | { readonly kind: 'go'; readonly answers: Answers }
  | { readonly kind: 'left' };

/** What a run knows before it asks, and what a flag has already answered. */
export interface InitAsk {
  readonly cwd: string;
  readonly around: Around;
  readonly name: string;
  readonly version: string;
  readonly machine: Machine;
  /** Marks a flag already decided (`--hosts`, `--all-hosts`, `--yes`): that question is not asked. */
  readonly hostsGiven?: ReadonlySet<string>;
  /** The answer `--accepts` already gave: that question is not asked. */
  readonly acceptsGiven?: Accepts;
  /** The agent `--which` declared: its answer is its proposal. */
  readonly agent?: string;
  /** `--yes`: nothing is asked, and the plan is printed and not confirmed. */
  readonly yes: boolean;
}

function say(asking: Asking, lines: readonly Line[]): void {
  printed(asking, lines);
}

/**
 * Asks everything a founding needs a person for, in order, and ends with the plan and the one
 * confirmation. A question a flag answered is not asked, and `yes` asks none of them: the plan is
 * printed so that what was agreed to is on the page, and the founding goes ahead.
 */
export async function askInit(asking: Asking, request: InitAsk): Promise<Outcome> {
  const width = theWidthOf(asking.render);
  say(asking, theFirstScreen(request.around, request.name, request.version, width));
  const hostsAreAsked = request.hostsGiven === undefined && !request.yes;
  const acceptsIsAsked = request.acceptsGiven === undefined && !request.yes;
  let marks = request.hostsGiven ?? defaultMarks(request.around);
  let accepts: Accepts | undefined = request.acceptsGiven;
  for (;;) {
    if (hostsAreAsked) {
      const picked = await askTheHosts(asking, request.around, marks);
      if (picked.kind === 'left') return { kind: 'left' };
      marks = picked.answer;
    }
    if (acceptsIsAsked) {
      const picked = await askWhoMayAccept(asking, accepts ?? 'yes');
      if (picked.kind === 'left') return { kind: 'left' };
      accepts = picked.answer;
    }
    const answers: Answers = {
      marks,
      ...(accepts !== undefined ? { accepts } : {}),
      ...(request.agent !== undefined ? { agent: request.agent } : {}),
    };
    say(asking, planPage(planOf(request.cwd, request.around, answers, request.machine), width));
    if (request.yes) return { kind: 'go', answers };
    // The confirmation is asked again where the person chose to change answers a flag already gave: there
    // is nothing to change, and the one thing it must never do is found the project on a key that said no.
    for (;;) {
      const confirmed = await askToGoAhead(asking);
      if (confirmed.kind === 'left' || confirmed.answer === 'leave') return { kind: 'left' };
      if (confirmed.answer === 'found') return { kind: 'go', answers };
      if (hostsAreAsked || acceptsIsAsked) break;
    }
  }
}
