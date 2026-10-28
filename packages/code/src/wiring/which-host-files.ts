/**
 * The one question `mnema init` and `mnema instructions` put to a person at a terminal: which of the
 * files an agent host reads the mnema instructions are written into.
 *
 * IT USES WHAT THE PROGRAM ALREADY HAS: `io.aPersonIsHere` says there is somebody to ask (the caller
 * checks it, and a script, a pipe and a host's shell are never asked), and `io.ask` is the line the
 * person types. The files and the hosts that read each are the ones `INSTRUCTIONS_TARGETS` names, so
 * the question lists no host the page of the reference does not (`the-init-asks-which-host-files-to-write
 * .test.ts` holds the two to each other), and puts none of them first by name: the order is the one the
 * table has.
 *
 * THE ANSWER IS NUMBERS. An empty answer is every file, which is what the verb wrote before it asked.
 * An answer that is not understood is asked once more, and then refused (`HOST_FILES_NOT_UNDERSTOOD`)
 * with nothing written. Ctrl-C and Ctrl-D reject the read with `ABORT_ERR` (measured on the built binary
 * under a pty: both, at once, in the Node versions this product supports); that is a person who changed
 * their mind, and it is a `cancelled` answer, not an error.
 */

import { CHOOSABLE_INSTRUCTIONS } from '../instructions-block.js';
import { fact } from '../presentation/detail.js';
import type { Render } from '../presentation/render.js';
import type { CliIo } from './io.js';

/** What the person said, or that they said nothing and left. */
export type HostFilesAnswer =
  | { readonly kind: 'chosen'; readonly files: readonly string[] }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unclear' };

/** The paths the person can choose among, in the order they are listed. */
const OFFERED = CHOOSABLE_INSTRUCTIONS.map((target) => target.path);

/** What an answer can be, said when it is not one. */
export const EXPECTED = `the numbers 1 to ${OFFERED.length} separated by spaces, "all", or Enter for all`;

/** The code of the refusal a person gets who answered twice with nothing the list holds. */
export const HOST_FILES_NOT_UNDERSTOOD = 'HOST_FILES_NOT_UNDERSTOOD';

/** The lines above the prompt: each offered file with the hosts that read it. */
export function hostFilesQuestion(): readonly string[] {
  return [
    'Which files should the mnema instructions be written into? Each is read by the hosts named after it.',
    ...CHOOSABLE_INSTRUCTIONS.map(
      (target, at) => `  ${at + 1}. ${target.path}: ${target.readers ?? ''}`,
    ),
    'A CLAUDE.md, .claude/CLAUDE.md or GEMINI.md that already exists gets them whichever you choose.',
  ];
}

/** The prompt itself, on the line the person types on. */
export const HOST_FILES_PROMPT = `Numbers separated by spaces, or Enter for all ${OFFERED.length} [${OFFERED.map((_, at) => at + 1).join(' ')}]: `;

/**
 * The paths a typed answer means, in the order they are listed, or `undefined` when it is not an answer
 * to the question: an empty line and `all` are every file; otherwise numbers from the list.
 */
export function readHostFilesAnswer(typed: string): readonly string[] | undefined {
  const said = typed.trim().toLowerCase();
  if (said === '' || said === 'all') return OFFERED;
  const numbers = said.split(/[\s,]+/);
  const picked = new Set<string>();
  for (const word of numbers) {
    const at = /^\d+$/.test(word) ? Number(word) : 0;
    const path = OFFERED[at - 1];
    if (path === undefined) return undefined;
    picked.add(path);
  }
  return OFFERED.filter((path) => picked.has(path));
}

/** Whether a rejected read is the person leaving it (Ctrl-C, Ctrl-D) and not a failure. */
export function isCancelled(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ABORT_ERR';
}

/**
 * Puts the question to the person at the terminal: twice at most. The caller has already decided there
 * is somebody to ask and an `ask` to ask with.
 */
export async function askWhichHostFiles(
  io: CliIo & { readonly ask: NonNullable<CliIo['ask']> },
  render: Render,
): Promise<HostFilesAnswer> {
  for (const line of hostFilesQuestion()) io.err(render(fact(line)));
  for (let turn = 0; turn < 2; turn += 1) {
    let typed: string;
    try {
      typed = await io.ask(HOST_FILES_PROMPT);
    } catch (error) {
      if (isCancelled(error)) return { kind: 'cancelled' };
      throw error;
    }
    const files = readHostFilesAnswer(typed);
    if (files !== undefined) return { kind: 'chosen', files };
    if (turn === 0) {
      io.err(render(fact(`"${typed.trim()}" is not on the list: ${EXPECTED}.`)));
    }
  }
  return { kind: 'unclear' };
}
