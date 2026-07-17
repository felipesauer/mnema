import { createColors } from 'picocolors';

/**
 * Shared color palette for all CLI output.
 *
 * picocolors' default detection turns colors on whenever the `CI`
 * environment variable is set, even without a TTY — which injects
 * ANSI codes into piped output on CI runners. Gate on an actual
 * terminal instead; `NO_COLOR` and `FORCE_COLOR` still take
 * precedence when set.
 */
const colorsEnabled =
  process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== ''
    ? false
    : process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== ''
      ? true
      : process.stdout.isTTY === true;

export const pc = createColors(colorsEnabled);
