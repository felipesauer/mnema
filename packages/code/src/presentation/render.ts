/**
 * WHAT A RENDERER IS — the one seam between a line's parts and the bytes a stream
 * receives.
 *
 * There are two of them now (`plain.ts` and `styled.ts`) and the surface names
 * neither: every verb that prints receives one. That is the whole point of the type
 * existing as its own module. A read that imported a renderer would be a read that
 * decided how output looks, once per verb there is, and the decision is not the
 * read's to make — it is the caller's terminal, their flag and their environment,
 * which are resolved once at the entry (see `wiring/color.ts`) and handed down.
 *
 * `presentation/` therefore still asks nothing about where output is going: it
 * builds lines, and takes the function that turns one into bytes. `parts.test.ts`
 * refuses a module here that reaches for the answer itself.
 */

import type { Line } from './line.js';

/**
 * Turns one line into the bytes a stream receives.
 *
 * The contract both renderers keep, and the reason a caller can be handed either
 * without knowing which: the TEXT of the line is the same either way — a renderer
 * may add escapes around a part, never a character a reader can see. `styled.test.ts`
 * is where that is asserted, over every shape the surface builds.
 */
export type Render = (line: Line) => string;
