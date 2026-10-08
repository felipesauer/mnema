import { describe, expect, it } from 'vitest';
import { readFrontmatter } from '../src/frontmatter.js';

describe('the frontmatter reader', () => {
  it('reads top-level key: value lines and drops the quotes around a value', () => {
    expect(
      readFrontmatter('---\nname: ok\ndescription: "Does a thing."\ntools: \'Read\'\n---\nbody'),
    ).toEqual({
      ok: true,
      fields: { name: 'ok', description: 'Does a thing.', tools: 'Read' },
    });
  });

  it('keeps an indented continuation as part of the key above it, whitespace collapsed', () => {
    const read = readFrontmatter(
      '---\nname: ok\ndescription: >\n  one\n  two\nmetadata:\n  owner: someone\n---\n',
    );
    expect(read).toEqual({
      ok: true,
      fields: { name: 'ok', description: '> one two', metadata: 'owner: someone' },
    });
  });

  it('reads a CRLF file and one that opens with a byte-order mark', () => {
    expect(readFrontmatter('﻿---\r\nname: ok\r\n---\r\n')).toEqual({
      ok: true,
      fields: { name: 'ok' },
    });
  });

  it.each([
    ['no frontmatter', 'just a body', 'does not begin'],
    ['a block never closed', '---\nname: ok\n', 'never closed'],
    ['a key twice', '---\nname: a\nname: b\n---\n', 'appears twice'],
    ['a line it cannot place', '---\nnot a pair\n---\n', 'not a key: value line'],
  ])('refuses %s', (_what, text, why) => {
    const read = readFrontmatter(text);
    expect(read.ok).toBe(false);
    expect(read.ok ? '' : read.why).toContain(why);
  });
});
