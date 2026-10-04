/**
 * The page's `Buffer` against the spellings the verifier asks of it, each compared with
 * Node's own `Buffer` over the same input.
 */

import { describe, expect, it } from 'vitest';
import { Buffer as PageBuffer } from './buffer.js';

describe('the page Buffer', () => {
  it('spells bytes the way Node does: hex, base64 and UTF-8, in both directions', () => {
    const text = 'decisão ✓ — 4 bytes: \u0000ÿ';
    const node = Buffer.from(text);
    const page = PageBuffer.from(text);
    expect(Array.from(page)).toEqual(Array.from(node));
    expect(page.toString('hex')).toBe(node.toString('hex'));
    expect(page.toString('base64')).toBe(node.toString('base64'));
    expect(PageBuffer.from(node.toString('base64'), 'base64').toString('utf-8')).toBe(text);
    expect(Array.from(PageBuffer.from(node.toString('hex'), 'hex'))).toEqual(Array.from(node));
    expect(page.toString('utf-8', 2, 6)).toBe(node.toString('utf-8', 2, 6));
    expect(() => PageBuffer.from('abc', 'hex')).toThrow(/hex/);
    expect(PageBuffer.byteLength(text)).toBe(Buffer.byteLength(text));
  });

  it('joins, compares and searches as Node does', () => {
    const joined = PageBuffer.concat([PageBuffer.from('ab'), PageBuffer.from([99, 10, 100])]);
    expect(joined.toString()).toBe('abc\nd');
    expect(joined.lastIndexOf(10)).toBe(3);
    expect(joined.lastIndexOf(10, 2)).toBe(-1);
    expect(joined.equals(PageBuffer.from('abc\nd'))).toBe(true);
    expect(joined.equals(PageBuffer.from('abc\ne'))).toBe(false);
    expect(PageBuffer.compare(PageBuffer.from('a'), PageBuffer.from('b'))).toBe(
      Buffer.compare(Buffer.from('a'), Buffer.from('b')),
    );
    expect(PageBuffer.compare(PageBuffer.from('ab'), PageBuffer.from('a'))).toBe(1);
    expect(joined.subarray(1, 3).toString()).toBe('bc');
  });

  it('reads and writes the integers the witness code asks of it', () => {
    const bytes = PageBuffer.alloc(8);
    expect(bytes.writeUInt32BE(0x01020304, 0)).toBe(4);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([1, 2, 3, 4]);
    expect(bytes.readUInt32LE(0)).toBe(Buffer.from([1, 2, 3, 4]).readUInt32LE(0));
    expect(bytes.writeUIntBE(0x0a0b0c, 4, 3)).toBe(7);
    expect(Array.from(bytes.subarray(4, 7))).toEqual([10, 11, 12]);
    expect(PageBuffer.isBuffer(bytes)).toBe(true);
    expect(PageBuffer.isBuffer(new Uint8Array(1))).toBe(false);
  });
});
