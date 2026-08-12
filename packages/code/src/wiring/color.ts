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
 *   4. Otherwise THE DESTINATION answers, and it answers with two facts rather than one:
 *      style when the destination is a terminal AND that terminal did not say it is
 *      `dumb`, plain for a pipe, a file, a CI log, and for the terminal that said so.
 *      `TERM=dumb` is the field's way of saying *this thing prints text and nothing else*
 *      — it is what a shell inside an editor exports, what a build runner exports, and
 *      what every library that paints already honours — so a device that declared it is
 *      not a destination that can show style, whatever `isTTY` says about the file
 *      descriptor. It is the LAST rung, under both variables, exactly as it is in the
 *      market: a caller who set `FORCE_COLOR` asked for colour on a terminal that says it
 *      cannot, and asking beats declaring.
 *
 * RUNG FOUR USED TO BE HALF OF ITSELF TOO, and this file's own words are what found it.
 * It read *the terminal answers: style when the destination is one*, and one paragraph of
 * `repl/painting.ts` said, as a declared consequence, that *this product's precedence never
 * reads `TERM` at all*. That consequence was a hole rather than a decision: the layout
 * library honours `TERM=dumb` and this rule did not, so a `dumb` terminal got a page half
 * painted — a hundred and ninety-two style sequences from this renderer and none from the
 * library — and handing our answer to that library turned it into a page fully painted on a
 * terminal that had declared it cannot paint. Both are the same disagreement, resolved to
 * opposite sides. The rung above is the agreement: measured on a real `dumb` terminal, three
 * hundred and twelve style sequences became NONE, and `--color=always` still paints there
 * because rung one is the caller's own request. `chosen-once.test.ts` asserts it against the
 * rung above it and against the one it replaced.
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
 * AND THERE IS A SECOND QUESTION HERE NOW: whether the line FOLDS. It is resolved in the
 * same place and out of the same value — a terminal that said how wide it is gets the
 * renderer that folds between words with a hanging indent (`presentation/folded.ts`), and a
 * pipe, a file, a CI log and the recorded transcript get exactly the bytes they got before.
 *
 * IT IS NOT THE SAME SHAPE OF DECISION AS THE FOUR ABOVE, AND THIS SAID IT WAS. The
 * sentence read *one answer per invocation, resolved from what the process can see and handed
 * down*, and the four things the precedence reads cannot change under a running process while
 * the fifth can: a caller drags the corner of their window. For a verb that prints and exits
 * the difference never shows, and for the SESSION it showed as a page carrying two widths at
 * once (see {@link rendererFor} for what was measured). So the colour is one answer per
 * invocation and the WIDTH is one answer per screen the bytes are going to
 * ({@link rendererAtEachWidth}). It is still NOT a fifth rung of the
 * precedence above and it must not be read as one: the flag and the two variables are
 * about COLOUR, and a caller who typed `--color=never` on a terminal asked for no colour,
 * not for the badly folded line their terminal would otherwise give them. See
 * {@link chooseRenderer} for how the two compose.
 *
 * AND THE ANSWER HAS A SECOND CONSUMER NOW, WHICH IS NOT ONE OF OURS. Everything above is
 * about the lines this product COMPOSES; the interactive page also has edges, a mark and a
 * title that a layout library draws, and that library resolves their colour by its own
 * detection. Its detection has no entry for `NO_COLOR` at all — measured on a real terminal,
 * a session with the variable set wrote thirty-two accents and not one byte from the
 * renderer above — so a page obeyed the caller in half and the library in the other half.
 * The precedence did not move and no bridge was invented: the answer this file already
 * reaches is handed to the library through the channel the library does read, once, before
 * a byte of it is loaded ({@link paintsAtAll}, and `repl/painting.ts` for the channel).
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
import type { Line } from '../presentation/line.js';
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
 * twenty-eight instead, it would be twenty-eight flags with one name, and the reader of
 * one verb's help would have no reason to think the next verb agreed.
 */
export const COLOR_HELP =
  'when to use bold, dim and color: auto (a terminal only), always (also in a pipe), ' +
  'never. NO_COLOR and FORCE_COLOR are honored; an explicit --color beats both. Style ' +
  'never changes what a line says.';

/**
 * WHAT A TERMINAL SAYS WHEN IT CANNOT DO ANYTHING BUT PRINT TEXT.
 *
 * The exact value and nothing near it, which is what every library that paints matches on:
 * `dumb` is a name in the terminfo database and not a family, so a prefix test would take
 * `dumb-emacs-ansi` — a terminal that CAN paint — down with it. An unset `TERM` is not this
 * either: it is a caller whose environment says nothing, and silence is not a declaration.
 */
const CANNOT_PAINT = 'dumb';

/** What the answer depends on, read where the process is. */
export interface Capability {
  /** What this invocation asked for on the command line. */
  readonly when: ColorWhen;
  /**
   * The environment: the two conventional variables, and what the terminal says it IS.
   *
   * IT WAS *the two conventional variables*, and the third is a different KIND of thing
   * rather than a third of the same — which is why it sits at the bottom of the precedence
   * instead of beside them. `NO_COLOR` and `FORCE_COLOR` are a caller ASKING; `TERM` is the
   * device DECLARING. Never mutated.
   */
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
  // THE DESTINATION, IN BOTH OF THE THINGS IT SAYS: a file descriptor that is a terminal,
  // and a terminal that did not declare it cannot paint. One rung and one `&&`, because it
  // is one question — *can what is on the other end of this show style?* — and a `dumb`
  // terminal answering no is the same answer a pipe gives, for the same reason.
  return isTty && env.TERM !== CANNOT_PAINT ? renderStyled : renderPlain;
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
 * THE LINE THE RULE IS MEASURED ON: one part, in a role that always carries a weight.
 *
 * `label` is BOLD in the painting renderer and bare in the plain one
 * (`presentation/styled.ts`, `OPENED_BY`), and a part that opens nothing comes back
 * untouched — so a probe built out of a `field` would report *this rule does not paint*
 * about the renderer that paints everything. That is the one way {@link paintsAtAll} can
 * go quietly wrong, so it is pinned by a case rather than left to inspection
 * (`tests/one-authority-over-colour.test.ts`).
 *
 * Short on purpose: a rule the caller folds is still the rule, and a probe long enough to
 * break would be measuring the fold instead of the paint.
 */
const A_PAINTED_LINE: Line = { indent: 0, parts: [{ role: 'label', text: 'colour' }] };

/**
 * WHETHER A RULE PAINTS AT ALL — asked of the RULE, on bytes, and never of the capability
 * a second time.
 *
 * IT EXISTS BECAUSE THE DECISION HAS A SECOND CONSUMER NOW, and it is not one of ours: the
 * layout library draws the page's own edges, its mark and its title, and it decides their
 * colour by its own detection unless it is told (`repl/painting.ts` for what it reads and
 * why). Something has to hand it the answer this file already worked out.
 *
 * ASKED OF THE RENDERER RATHER THAN OF THE {@link Capability}, which is the whole shape of
 * it. A boolean resolved beside the renderer would be a SECOND spelling of one decision —
 * two readings of one rule is exactly how a surface comes to have two opinions about
 * colour, which is the defect this answer exists to close, and re-reading the capability
 * at another instant would be the second reading {@link rendererAtEachWidth} is built to
 * prevent. What comes back here is a measurement of the very renderer the invocation was
 * given, so the library and the page cannot disagree about what was decided.
 *
 * TOTAL OVER WHAT {@link chooseRenderer} RETURNS, painted or plain, folded or not: the
 * fold wraps whichever renderer it was handed and changes no escape, so a folded painting
 * answers the same as the painting inside it.
 */
export function paintsAtAll(render: Render): boolean {
  return render(A_PAINTED_LINE) !== renderPlain(A_PAINTED_LINE);
}

/**
 * HOW A LINE BECOMES BYTES ON A SCREEN OF A GIVEN WIDTH — the same answer as
 * {@link chooseRenderer}, asked for a width the caller names instead of the one the
 * process happens to be on.
 *
 * ASKED WITH NO WIDTH IT ANSWERS FOR THIS INVOCATION'S OWN TERMINAL, which is what a verb
 * that prints once and exits wants and is what {@link rendererFor} is made of. The two
 * doors are one rule, so a report and a page cannot come to disagree about what a fold is.
 */
export type RenderingAt = (columns?: number) => Render;

/**
 * The rule, ready to be asked at any width: WHICH RENDERER for a screen this wide.
 *
 * THE COLOUR IS STILL ONE ANSWER PER INVOCATION and only the WIDTH moves, which is the
 * whole shape of this. The flag, the two variables and whether the destination is a terminal
 * are read ONCE — a session whose first answer was painted and whose tenth was not would be
 * one line's worth of doubt about every line in the scrollback — and they are the four things
 * that cannot change under a process. How wide the screen is can, because a caller can drag
 * the corner of their window, and it is the one input {@link chooseRenderer} is asked again
 * with.
 *
 * ONE ENTRY IN THE MEMO, because there is one terminal: a page is drawn at one width at a
 * time, and a caller who drags back and forth pays one composition per width they stop at.
 * It is the same argument the console's own cache of the opening makes (`repl/console.ts`,
 * `theOpening`), and what it saves is the closure per LINE rather than per frame.
 *
 * NOTHING HERE READS A DEVICE. The width arrives as a number from whoever asked one — the
 * entry, for a verb that prints and exits, and the console for a page, which is the one place
 * on that surface that asks how wide the screen is (`repl/console.ts`, `theSize`).
 */
export function rendererAtEachWidth(read: () => Capability): RenderingAt {
  let capability: Capability | undefined;
  let last: { readonly columns: number; readonly render: Render } | undefined;
  return (columns) => {
    capability ??= read();
    const asked = capability;
    const wide = columns ?? asked.columns;
    if (last?.columns !== wide) {
      last = { columns: wide, render: chooseRenderer({ ...asked, columns: wide }) };
    }
    return last.render;
  };
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
 * IT SAID THE WIDTH WAS RESOLVED ONCE TOO, AND THAT IS TRUE HERE AND WAS FALSE ONE VERB
 * OVER. The paragraph named the limit and declared it acceptable: *the SESSION is a single
 * invocation that outlives the window it opened in, so a caller who narrows their terminal
 * mid-session gets lines folded to the width the session opened at until they leave* — and
 * what it cost was said to be the terminal folding those lines, which is what every line did
 * before there was a fold. WHAT FALSIFIED IT was a screen: a session opened at seventy columns
 * and maximised to two hundred drew its rules and its badge across the new terminal and folded
 * its CONTENT at seventy, so one frame carried two widths and the caller's report was a column
 * of text down the left of a wide window. Measured on a real pseudo-terminal, eleven
 * continuation rows on a page whose every other edge was two hundred wide.
 *
 * SO THE RULE HOLDS FOR A VERB THAT PRINTS AND EXITS AND NOT FOR A PAGE THAT IS REDRAWN. This
 * is the first, and it is the one the golden and the pipe depend on: `chosen-once.test.ts`
 * asserts that a pipe, a file, a CI log and the recorded transcript get exactly the bytes they
 * always got. The second asks {@link rendererAtEachWidth} for the width of the frame it is
 * drawing (`repl/console.ts`), and `one-width-per-frame.test.ts` is what says a frame no longer
 * holds two.
 */
export function rendererFor(at: RenderingAt): Render {
  return (line) => at()(line);
}
