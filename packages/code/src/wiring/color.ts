/**
 * WHICH RENDERER, decided once.
 *
 * Every verb that prints receives a {@link Render} and none of them chooses it: the
 * answer depends on the caller's terminal, their flag and their environment, which is
 * one question with one answer per invocation. Asked at each of the hundred-odd places
 * that print, it would be a hundred chances to disagree — and `chosen-once.test.ts`
 * is what refuses a `wiring/` file that names a renderer instead of taking one.
 *
 * THE PRECEDENCE IS THE CONVENTIONAL ONE, and it is not ours to invent — a person who
 * knows what `NO_COLOR` does to ripgrep, fd, cargo, gh, bat and delta has to be right
 * about what it does here:
 *
 *   1. `--color`, WHEN IT IS EXPLICIT — `never` or `always`. The request of THIS
 *      invocation, and nothing overrides it: `never` is last-resort quiet for a caller
 *      whose terminal lies about what it can render, and `always` is what makes
 *      `mnema … --color=always | less -R` work from inside a script whose environment
 *      the caller did not choose. `auto` is not a request, it is the absence of one,
 *      and it falls through to everything below.
 *   2. `NO_COLOR` — set and non-empty turns style off, per no-color.org, which is also
 *      why the value is never read: the standard is that presence is the signal, and a
 *      tool that acted on `NO_COLOR=0` differently from `NO_COLOR=1` would be the tool
 *      that broke the promise.
 *   3. `FORCE_COLOR` — forces style on where it would otherwise be off, and it decides
 *      BOTH ways: `0` is off, because that is what node and chalk made that value mean,
 *      and a caller who typed it meant off even on a terminal.
 *   4. Otherwise the terminal answers: style when the destination is one, plain when it
 *      is a pipe, a file or a CI log.
 *
 * RUNG ONE USED TO BE HALF OF ITSELF, and correcting it is the one behaviour change in
 * this file's history. The premise written here was that `--color=never` outranked
 * `NO_COLOR` but `--color=always` did NOT — the flag won going quiet and lost going
 * loud. What falsified it is the market the rest of this file defers to: git, ripgrep,
 * fd, ls, bat and delta all let an explicit `--color` beat the environment in BOTH
 * directions, because a caller typing a flag now is being more specific than a variable
 * exported in their shell profile. And no-color.org, the authority for rung two, speaks
 * only about the variable and does not discuss flags at all — so the ordering was never
 * something it said. The asymmetry was ours, it was not conventional, and the honest
 * reading of "the flag is this invocation's own request" is that it holds either way.
 * `chosen-once.test.ts` asserts the inversion by name.
 *
 * AND THERE IS A SECOND QUESTION HERE NOW: whether the line FOLDS. It is the same shape
 * of decision — one answer per invocation, resolved from what the process can see and
 * handed down — so it is resolved in the same place, out of the same value: a terminal
 * that said how wide it is gets the renderer that folds between words with a hanging
 * indent (`presentation/folded.ts`), and a pipe, a file, a CI log and the recorded
 * transcript get exactly the bytes they got before. It is NOT a fifth rung of the
 * precedence above and it must not be read as one: the flag and the two variables are
 * about COLOUR, and a caller who typed `--color=never` on a terminal asked for no colour,
 * not for the badly folded line their terminal would otherwise give them. See
 * {@link chooseRenderer} for how the two compose.
 *
 * NOTHING HERE READS THE ENVIRONMENT. The inputs arrive as a value ({@link
 * Capability}), read at the entry where the process actually is (`cli.ts`), which is
 * what lets the precedence be asserted case by case as a pure function — and what lets
 * the golden drive the whole program with output injected and land on plain BY THIS
 * RULE rather than by a fixture forcing it.
 *
 * `--color` is the option's name, and `NO_COLOR` and `FORCE_COLOR` are the variables',
 * because that is what the market standardised. The name is now literal as well as
 * conventional: what this surface spends the capability on used to be WEIGHT alone, and
 * `presentation/styled.ts` says what falsified that — the refusal and the gate's verdict
 * carry a severity, so the flag turns bold, dim AND two hues on and off. The name was
 * right before it was accurate, which is the argument for taking a market's name rather
 * than describing your own implementation: `--style` would have been more literal in
 * October and wrong in November, and it is one nobody's fingers know either way.
 */

import { foldedAt } from '../presentation/folded.js';
import { renderPlain } from '../presentation/plain.js';
import type { Render } from '../presentation/render.js';
import { renderStyled } from '../presentation/styled.js';

/** What `--color` accepts. Closed, and commander refuses anything else. */
export const COLOR_WHENS = ['auto', 'always', 'never'] as const;

/** The `--color` value: when this invocation wants style. */
export type ColorWhen = (typeof COLOR_WHENS)[number];

/**
 * The help for `--color`, on the program rather than on a verb.
 *
 * It is one question about one invocation, and it is asked before the verb: `mnema
 * --color=never verify`, the way `git --no-pager log` is. Declared on each of the
 * twenty-seven instead, it would be twenty-seven flags with one name, and the reader of
 * one verb's help would have no reason to think the next verb agreed.
 */
export const COLOR_HELP =
  'when to use bold, dim and color: auto (a terminal only), always (also in a pipe), ' +
  'never. NO_COLOR and FORCE_COLOR are honored; an explicit --color beats both. Style ' +
  'never changes what a line says.';

/** What the answer depends on, read where the process is. */
export interface Capability {
  /** What this invocation asked for on the command line. */
  readonly when: ColorWhen;
  /** The environment, for the two conventional variables. Never mutated. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Whether the destination is a terminal — false for a pipe, a file, a test. */
  readonly isTty: boolean;
  /**
   * How wide the destination is, in columns — zero when it is not a terminal, and zero
   * when it is one that never said.
   *
   * IT IS THE FOURTH THING AND IT ANSWERS A SECOND QUESTION, not another rung of the one
   * above: whether to FOLD. A width nobody reported is not a width to guess at, which is
   * the posture the console's own arithmetic already takes about the same silence.
   */
  readonly columns: number;
}

/**
 * Which of the two renderers PAINTS this invocation. Pure, total, and the whole
 * precedence.
 *
 * The order of the branches IS the documented order above; a rung moved is a rung that
 * would have to be moved in the doc and in `chosen-once.test.ts`, which asserts each
 * pair against the other.
 */
function paintingFor(capability: Capability): Render {
  const { when, env, isTty } = capability;
  if (when === 'never') return renderPlain;
  if (when === 'always') return renderStyled;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return renderPlain;
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR === '0' ? renderPlain : renderStyled;
  return isTty ? renderStyled : renderPlain;
}

/**
 * The renderer a capability asks for: the one that paints it, folded when there is a
 * screen to fold it to.
 *
 * TWO QUESTIONS AND NOT ONE, and they are orthogonal on purpose. Whether to paint is the
 * precedence above — a flag, two variables, a terminal. Whether to FOLD is whether the
 * bytes are going to a screen of a known width, and nothing a caller says about colour
 * answers it: `--color=never` on a terminal is still a terminal, and
 * `--color=always | less -R` is still a pipe, whose width is the pager's business and not
 * ours. Composing them rather than adding a rung is what keeps a caller from losing the
 * fold by asking for no colour.
 *
 * A PIPE, A FILE, A CI LOG AND THE RECORDED TRANSCRIPT GET EXACTLY WHAT THEY GOT BEFORE,
 * byte for byte, and that is the invariant this composition exists to keep. It is the
 * destination where one line per item is a promise a script depends on — `wc -l`, `grep`,
 * `awk` — and the destination the golden holds. `chosen-once.test.ts` asserts it over the
 * whole space of inputs rather than case by case, because the failure would be silent
 * everywhere except in somebody's pipeline.
 */
export function chooseRenderer(capability: Capability): Render {
  const painting = paintingFor(capability);
  const { isTty, columns } = capability;
  return isTty && columns > 0 ? foldedAt(columns, painting) : painting;
}

/**
 * The renderer every verb is handed: the answer to {@link chooseRenderer}, resolved on
 * the first line anything prints and at most once per invocation.
 *
 * Late because it has to be: the wiring is built before commander parses, so `--color`
 * does not exist yet when the verbs are registered. Once, because the answer cannot
 * change inside one command — a report whose first half was styled and second half was
 * not would be one line's worth of doubt about every other line.
 *
 * ⚠️ THE WIDTH IS RESOLVED ONCE TOO, and for one caller that is a limit worth naming: the
 * SESSION is a single invocation that outlives the window it opened in, so a caller who
 * narrows their terminal mid-session gets lines folded to the width the session opened at
 * until they leave. What that costs is the fold being wrong for those lines — which is the
 * terminal folding them, the behaviour of every line before this existed — and what it
 * buys is the invariant above. Making it follow a resize is a change to what "once" means
 * here, and it belongs to whoever takes the console's own redraw next.
 */
export function rendererFor(read: () => Capability): Render {
  let chosen: Render | undefined;
  return (line) => {
    chosen ??= chooseRenderer(read());
    return chosen(line);
  };
}
