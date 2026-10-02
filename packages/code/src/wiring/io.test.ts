import { describe, expect, it } from 'vitest';
import { PAINTING } from '../presentation/styled.js';
import { type CliIo, neutralizing } from './io.js';

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const [BOLD] = PAINTING;

/** A port that remembers what it was handed, on each stream. */
function recording(): { port: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { port: { out: (l) => out.push(l), err: (l) => err.push(l), fail: () => {} }, out, err };
}

const ATTACK = `title ${ESC}[2J${ESC}]0;pwned${BEL} end`;

describe('the port every line of the program is written through', () => {
  it('makes the control bytes of a line visible on BOTH streams', () => {
    const { port, out, err } = recording();
    const safe = neutralizing(port, () => false);
    safe.out(ATTACK);
    safe.err(ATTACK);
    expect(out).toEqual(['title \\u001b[2J\\u001b]0;pwned\\u0007 end']);
    expect(err).toEqual(out);
  });

  it('is strict where nothing is painted: not even the product’s own bold passes', () => {
    const { port, out } = recording();
    neutralizing(port, () => false).out(`${BOLD}a${ESC}[22m`);
    expect(out[0]).not.toContain(ESC);
  });

  it('lets the product’s own painting through where it paints, and nothing else', () => {
    const { port, out } = recording();
    neutralizing(port, () => true).out(`${BOLD}painted${ESC}[22m ${ATTACK}`);
    const line = out[0] as string;
    expect(line.startsWith(`${BOLD}painted${ESC}[22m `)).toBe(true);
    expect(line.slice(`${BOLD}painted${ESC}[22m `.length)).toBe(
      'title \\u001b[2J\\u001b]0;pwned\\u0007 end',
    );
  });

  it('keeps what the port is for: the exit signal and the input are the wrapped port’s own', () => {
    let failed = 0;
    const port: CliIo = {
      out: () => {},
      err: () => {},
      fail: () => failed++,
      input: async () => 'x',
    };
    const safe = neutralizing(port, () => false);
    safe.fail();
    expect(failed).toBe(1);
    expect(safe.input).toBe(port.input);
  });
});
