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
 *   1. `--color=never` — the explicit request of THIS invocation, which nothing may
 *      override. It is last-resort quiet: the answer for a caller whose terminal lies
 *      about what it can render.
 *   2. `NO_COLOR` — set and non-empty turns style off whatever else says, per
 *      no-color.org, which is also why the value is never read: the standard is that
 *      presence is the signal, and a tool that acted on `NO_COLOR=0` differently from
 *      `NO_COLOR=1` would be the tool that broke the promise.
 *   3. `--color=always` and `FORCE_COLOR` — force style ON where it would otherwise be
 *      off, which is what makes `mnema … --color=always | less -R` work. `FORCE_COLOR=0`
 *      is the one value that does the opposite, because that is what node and chalk
 *      made it mean and a caller who set it meant "off".
 *   4. Otherwise the terminal answers: style when the destination is one, plain when it
 *      is a pipe, a file or a CI log.
 *
 * NOTHING HERE READS THE ENVIRONMENT. The three inputs arrive as a value ({@link
 * Capability}), read at the entry where the process actually is (`cli.ts`), which is
 * what lets the precedence be asserted case by case as a pure function — and what lets
 * the golden drive the whole program with output injected and land on plain BY THIS
 * RULE rather than by a fixture forcing it.
 *
 * `--color` is the option's name, and `NO_COLOR` and `FORCE_COLOR` are the variables',
 * because that is what the market standardised. What this surface spends the capability
 * on is WEIGHT and not hue (see `presentation/styled.ts` for why), so the flag turns
 * bold and dim on and off. A flag named `--style` would be more literal and would be
 * one nobody's fingers know.
 */

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
 * twenty-five instead, it would be twenty-five flags with one name, and the reader of
 * one verb's help would have no reason to think the next verb agreed.
 */
export const COLOR_HELP =
  'when to use bold and dim: auto (a terminal only), always (also in a pipe), never. ' +
  'NO_COLOR and FORCE_COLOR are honored; --color=never wins. Style never changes what ' +
  'a line says.';

/** The three things the answer depends on, read where the process is. */
export interface Capability {
  /** What this invocation asked for on the command line. */
  readonly when: ColorWhen;
  /** The environment, for the two conventional variables. Never mutated. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Whether the destination is a terminal — false for a pipe, a file, a test. */
  readonly isTty: boolean;
}

/**
 * The renderer a capability asks for. Pure, total, and the whole precedence.
 *
 * The order of the branches IS the documented order above; a rung moved is a rung that
 * would have to be moved in the doc and in `chosen-once.test.ts`, which asserts each
 * pair against the other.
 */
export function chooseRenderer(capability: Capability): Render {
  const { when, env, isTty } = capability;
  if (when === 'never') return renderPlain;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return renderPlain;
  if (when === 'always') return renderStyled;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0') return renderStyled;
  return isTty ? renderStyled : renderPlain;
}

/**
 * The renderer every verb is handed: the answer to {@link chooseRenderer}, resolved on
 * the first line anything prints and at most once per invocation.
 *
 * Late because it has to be: the wiring is built before commander parses, so `--color`
 * does not exist yet when the verbs are registered. Once, because the answer cannot
 * change inside one command — a report whose first half was styled and second half was
 * not would be one line's worth of doubt about every other line.
 */
export function rendererFor(read: () => Capability): Render {
  let chosen: Render | undefined;
  return (line) => {
    chosen ??= chooseRenderer(read());
    return chosen(line);
  };
}
