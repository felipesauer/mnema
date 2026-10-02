/**
 * What the passphrase prompt reads from a terminal, asserted on bytes: the keys a person presses
 * and the line that comes out. The terminal itself is not driven here — `aTerminalCanAnswer` is
 * false under a test runner, which is also the case that matters most: nothing waits for a line.
 */

import { describe, expect, it } from 'vitest';
import { askOnTheTerminal, aTerminalCanAnswer, collectLine } from './terminal-passphrase.js';

/** A source of bytes that ends when they do. */
function typing(...keys: (string | number)[]): () => number | undefined {
  const bytes = keys.flatMap((key) =>
    typeof key === 'number' ? [key] : [...Buffer.from(key, 'utf-8')],
  );
  let at = 0;
  return () => bytes[at++];
}

describe('collectLine', () => {
  it('reads up to the enter, and not the enter', () => {
    expect(collectLine(typing('correct horse', 0x0d, 'ignored'))).toBe('correct horse');
    expect(collectLine(typing('a b', 0x0a))).toBe('a b');
  });

  it('takes back one whole character at a backspace, never half of one', () => {
    expect(collectLine(typing('abc', 0x7f, 'd', 0x0d))).toBe('abd');
    expect(collectLine(typing('a', 'é', 0x7f, 'b', 0x0d))).toBe('ab');
    expect(collectLine(typing('日本', 0x7f, 0x0d))).toBe('日');
  });

  it('abandons on ^C, and says nothing was typed at an end of input with nothing before it', () => {
    expect(collectLine(typing('half', 0x03))).toBeUndefined();
    expect(collectLine(typing())).toBeUndefined();
    expect(collectLine(typing(0x04))).toBeUndefined();
  });

  it('gives what was typed when the input ends mid-line', () => {
    expect(collectLine(typing('no newline'))).toBe('no newline');
  });
});

describe('the prompt', () => {
  it('asks nobody where there is no terminal, so nothing waits for a line', () => {
    expect(aTerminalCanAnswer()).toBe(false);
    expect(askOnTheTerminal('Passphrase: ')).toBeUndefined();
  });
});
