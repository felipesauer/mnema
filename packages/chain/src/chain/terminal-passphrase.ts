/**
 * Asking a person for the key's passphrase at the terminal they are sitting at, with nothing
 * echoed — the second place a passphrase can come from, after the environment variable.
 *
 * IT ASKS ONLY WHERE SOMEBODY CAN ANSWER. Both the input and the error stream have to be a
 * terminal: an agent's server, a hook, a pipe and a CI job have neither, so none of them is ever
 * made to wait for a line nobody will type — which is why the first version of the passphrase
 * left a prompt out, and why leaving it out for those is still right.
 *
 * IT READS SYNCHRONOUSLY, because the key is opened where it signs, deep inside a write that is
 * not asynchronous; the raw mode is set for the bytes of one line and put back whatever happens.
 * The question and the newline after the answer go to the error stream, so a verb's output stays
 * what it was and can be piped.
 *
 * WHAT IS PURE IS {@link collectLine}: the bytes in, the line (or the abandonment) out, so the
 * keys that matter — enter, backspace, the end of input, ^C — are asserted on bytes and not on a
 * terminal.
 */

import { readSync, writeSync } from 'node:fs';
import type { ReadStream } from 'node:tty';

const CTRL_C = 0x03;
const CTRL_D = 0x04;
const BACKSPACE = 0x7f;
const BACKSPACE_OLD = 0x08;
const ENTER = 0x0d;
const NEWLINE = 0x0a;

/**
 * The line the bytes spell, or `undefined` when the person abandoned it (^C) or the input ended
 * with nothing typed. `next` gives one byte at a time and `undefined` at the end of input. A
 * backspace takes back one whole character, not one byte of a multi-byte one.
 */
export function collectLine(next: () => number | undefined): string | undefined {
  const typed: number[][] = [];
  let current: number[] = [];
  for (;;) {
    const byte = next();
    if (byte === undefined || byte === CTRL_D) {
      return typed.length === 0 && current.length === 0 ? undefined : finish(typed, current);
    }
    if (byte === CTRL_C) return undefined;
    if (byte === ENTER || byte === NEWLINE) return finish(typed, current);
    if (byte === BACKSPACE || byte === BACKSPACE_OLD) {
      if (current.length > 0) current = [];
      else typed.pop();
      continue;
    }
    current.push(byte);
    // A character is whole when its lead byte's length is reached, so a backspace takes back one
    // character and never half of one.
    if (isComplete(current)) {
      typed.push(current);
      current = [];
    }
  }
}

/** Whether `bytes` are one whole UTF-8 character. */
function isComplete(bytes: readonly number[]): boolean {
  const lead = bytes[0] ?? 0;
  const length = lead < 0x80 ? 1 : lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : 2;
  return bytes.length >= length;
}

function finish(typed: readonly (readonly number[])[], rest: readonly number[]): string {
  return Buffer.from([...typed.flat(), ...rest]).toString('utf-8');
}

/** Whether there is a terminal to ask at: the input and the error stream are both one. */
export function aTerminalCanAnswer(): boolean {
  return process.stdin.isTTY === true && process.stderr.isTTY === true;
}

/**
 * Asks `question` at the terminal and returns what was typed, or `undefined` when there is no
 * terminal to ask at, the answer was abandoned, or nothing was typed.
 */
export function askOnTheTerminal(question: string): string | undefined {
  if (!aTerminalCanAnswer()) return undefined;
  const input = process.stdin as ReadStream;
  const one = Buffer.alloc(1);
  writeSync(2, question);
  input.setRawMode(true);
  try {
    const line = collectLine(() => {
      for (;;) {
        try {
          return readSync(0, one, 0, 1, null) === 1 ? one[0] : undefined;
        } catch (error) {
          // A terminal stream Node put in non-blocking mode says "try again" until a key comes.
          if ((error as NodeJS.ErrnoException).code !== 'EAGAIN') return undefined;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
        }
      }
    });
    return line === undefined || line === '' ? undefined : line;
  } finally {
    input.setRawMode(false);
    writeSync(2, '\n');
  }
}
