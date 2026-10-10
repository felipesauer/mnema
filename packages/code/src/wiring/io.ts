/**
 * Where the CLI writes, and how it signals failure.
 *
 * The port is injected so the whole program can be driven in a test without
 * spawning a process or writing to the real streams — which is what lets the
 * golden compare every line the surface produces, in the order the streams would
 * have received them.
 *
 * It is a PORT and not a formatter: nothing here decides what a line says. The
 * shape of a line belongs to `presentation/`, which returns lines and writes
 * none, and the wiring here is what puts them on a stream.
 */

import { neutralized } from '../one-line.js';
import { PAINTING } from '../presentation/styled.js';

/** Every sequence the painted renderer writes, as one pattern — built from its constants. */
const OUR_PAINT = new RegExp(
  PAINTING.map((sequence) => sequence.replace(/[\\[\].*+?^${}()|]/g, '\\$&')).join('|'),
  'g',
);

/** Where the CLI writes, and how it signals failure — injected for testing. */
export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** Records a non-zero exit intent (1 unless a code is given) without killing the process under test. */
  readonly fail: (code?: number) => void;
  /**
   * Everything on the standard input, for the one verb a host feeds a payload to
   * (`before-a-write`). Absent is empty — the in-process harness has no input to give, and a
   * verb that read the real stream there would wait on a pipe its test runner never closes
   * (it did: the suite hung on the first run of that verb in process).
   */
  readonly input?: () => Promise<string>;
  /**
   * Whether a PERSON is at this invocation: standard input and standard error are both a
   * terminal. A host's hook, a pipe and a script are none of that. It is a SIGNAL, not a lock: a
   * caller that fakes a terminal looks like a person, and what that gains is a link, which sends
   * nothing — the send is the person's Submit on GitHub. Absent is false —
   * the in-process harness has no person, and the only things that ask are the ones that
   * must not happen without one (the offer of a report, and the link that sends it).
   */
  readonly aPersonIsHere?: boolean;
  /**
   * Asks the person one question at the terminal and returns the line they typed. Absent where
   * there is no terminal to ask at — the in-process harness, a pipe — and an act that needs an
   * answer treats absence as a refusal.
   */
  readonly ask?: (question: string) => Promise<string>;
}

/**
 * The port with every control byte of a line made visible before it is written — the last
 * sink of the one rule, for the lines the renderers never saw.
 *
 * THE RENDERERS NEUTRALIZE THE PARTS OF A LINE (`presentation/plain.ts`) and the rule of
 * the line neutralizes what it collapses, and neither reaches a line that was never a `Line`: a
 * record's body printed verbatim, a header above a list, a JSON document, a sentence a
 * wiring file joined with a template literal. Those reach this port as strings, and a rule
 * that had to be remembered at each of them would be the rule that is missed at the next
 * one. So it is applied here too, once, at the only door the surface writes through —
 * `buildProgram` wraps the port it is given, which is why a test that drives the program
 * in process meets the same rule the binary does.
 *
 * WHAT PASSES UNCHANGED, and only when this invocation paints: the few sequences `styled.ts`
 * writes for bold, dim and colour. In a pipe, a file or a CI log — where the painting is off
 * and a sequence could only be an attack — nothing passes, and the port is strict. On a
 * terminal, a sequence in an unrendered string that spells the same bytes as the painting
 * passes too; that is the one residue, and it is cosmetic (a colour on a word), where every
 * sequence that moves the cursor, clears the screen, sets a title or opens a link is
 * escaped. The parts of a rendered line never reach it: the renderer neutralized their text
 * BEFORE painting it.
 */
export function neutralizing(port: CliIo, paints: () => boolean): CliIo {
  return {
    ...port,
    out: (line) => port.out(printable(line, paints())),
    err: (line) => port.err(printable(line, paints())),
  };
}

/**
 * `line`, with each control byte escaped — except, when this invocation paints, the
 * sequences this product paints with. Asked per write because the answer is the renderer's,
 * which is resolved after the port is wrapped.
 */
function printable(line: string, painted: boolean): string {
  if (!painted) return neutralized(line);
  let out = '';
  let from = 0;
  for (const painting of line.matchAll(OUR_PAINT)) {
    out += neutralized(line.slice(from, painting.index)) + painting[0];
    from = painting.index + painting[0].length;
  }
  return out + neutralized(line.slice(from));
}

/** The real streams, and a non-zero exit code on failure. */
export const processIo: CliIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  fail: (code) => {
    process.exitCode = code ?? 1;
  },
  aPersonIsHere: process.stdin.isTTY === true && process.stderr.isTTY === true,
  ask: async (question) => {
    const { createInterface } = await import('node:readline/promises');
    const lines = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    try {
      return await lines.question(question);
    } finally {
      lines.close();
    }
  },
  input: async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks).toString('utf-8');
  },
};

/**
 * Writes a report — every line a presentation function returned, in order.
 *
 * Every read that prints for a person goes through this, which is what makes "one
 * line per item" a property of the array a printer builds rather than of how many
 * times a verb remembered to call `out`.
 */
export function writeLines(io: CliIo, lines: readonly string[]): void {
  for (const line of lines) io.out(line);
}
