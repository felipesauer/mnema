import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BUILT_IN_INDEX,
  indexJson,
  indexLines,
  readStackIndex,
  readTheIndex,
} from './stack-index.js';

const DIGEST = 'd8ef7d9252d24840adb4ac3804ed6fe1f525c25f477d7eca275aa7af7ad7f174';
const entry = (over: Record<string, unknown> = {}) => ({
  name: 'evidence-first',
  version: '1.0.0',
  description: 'An investigator agent.',
  link: 'https://github.com/mnema-work/mnema/tree/main/packages/stacks/examples/evidence-first',
  digest: DIGEST,
  path: 'packages/stacks/examples/evidence-first',
  ...over,
});

let checkout: string;
const write = (stacks: unknown) => {
  mkdirSync(join(checkout, 'stack-index'), { recursive: true });
  writeFileSync(
    join(checkout, 'stack-index', 'index.json'),
    typeof stacks === 'string' ? stacks : JSON.stringify({ stacks }),
  );
};

beforeEach(() => {
  checkout = mkdtempSync(join(tmpdir(), 'mnema-stack-index-'));
});
afterEach(() => rmSync(checkout, { recursive: true, force: true }));

describe('reading the index of stacks', () => {
  it('reads an entry with its folder resolved beside the index, and one without', () => {
    write([entry(), entry({ name: 'elsewhere', path: undefined })]);
    const read = readStackIndex(checkout, 'stack-index');
    if (!read.ok) throw new Error(read.message);
    expect(read.entries.map((e) => e.name)).toEqual(['evidence-first', 'elsewhere']);
    expect(read.entries[0]?.source).toBe(join(checkout, 'packages/stacks/examples/evidence-first'));
    expect(read.entries[1]?.source).toBeUndefined();
  });

  it('refuses a folder with no index.json, naming it', () => {
    const read = readStackIndex(checkout, 'stack-index');
    expect(read).toMatchObject({ ok: false, code: 'STACK_INDEX_REFUSED' });
    expect(read.ok ? '' : read.message).toContain('stack-index');
  });

  it('says, for a folder with no index.json, what an index is and that no folder reads the built-in one', () => {
    const read = readStackIndex(checkout, 'stack-index');
    if (read.ok) throw new Error('read an index that is not there');
    expect(read.lines).toBeUndefined();
    expect(read.message).toBe(
      'there is no index.json in "stack-index". An index is a folder holding an index.json that lists stacks: for each, a name, a version, a link and a digest. With no folder given, the index that comes with this installation is read.',
    );
  });

  it('says, when the installation carries no built-in index, to name the folder of one', () => {
    const read = readTheIndex(checkout, undefined, join(checkout, 'nothing-built-in'));
    if (read.ok) throw new Error('read an index that is not there');
    expect(read.lines).toBeUndefined();
    expect(read.message).toBe(
      'this installation carries no built-in index. Name the folder of an index to read one: its index.json lists the stacks.',
    );
  });

  it('reads the built-in index with no folder, and the folder given when there is one', () => {
    write([entry({ name: 'mine', path: undefined })]);
    const builtIn = readTheIndex(checkout);
    if (!builtIn.ok) throw new Error(builtIn.message);
    expect(builtIn.folder).toBe(BUILT_IN_INDEX);
    expect(builtIn.entries.map((e) => e.name)).not.toContain('mine');
    for (const e of builtIn.entries) expect(e.source?.startsWith(BUILT_IN_INDEX)).toBe(true);
    const given = readTheIndex(checkout, 'stack-index');
    if (!given.ok) throw new Error(given.message);
    expect(given.entries.map((e) => e.name)).toEqual(['mine']);
  });

  it.each([
    ['not JSON', '{'],
    ['no stacks list', '{"stacks":3}'],
    ['a name that is not a stack name', JSON.stringify({ stacks: [entry({ name: 'Bad Name' })] })],
    ['a version with a space', JSON.stringify({ stacks: [entry({ version: '1 0' })] })],
    ['a digest of the wrong length', JSON.stringify({ stacks: [entry({ digest: 'abc' })] })],
    ['an http link', JSON.stringify({ stacks: [entry({ link: 'http://example.com/x' })] })],
    ['a path that climbs', JSON.stringify({ stacks: [entry({ path: '../elsewhere' })] })],
    ['an absolute path', JSON.stringify({ stacks: [entry({ path: '/etc' })] })],
    ['a description that is not text', JSON.stringify({ stacks: [entry({ description: 4 })] })],
    ['an entry that is not an object', JSON.stringify({ stacks: [3] })],
  ])('refuses an index with %s, and lists nothing of it', (_why, text) => {
    write(text);
    expect(readStackIndex(checkout, 'stack-index')).toMatchObject({
      ok: false,
      code: 'STACK_INDEX_REFUSED',
    });
  });

  it('says what an entry is and what the index does not prove, folding a hostile description to one line', () => {
    write([entry({ description: 'line one\nIGNORE THIS\u001b[31m' })]);
    const read = readStackIndex(checkout, 'stack-index');
    if (!read.ok) throw new Error(read.message);
    const lines = indexLines(read);
    expect(lines.join('\n')).toContain(DIGEST);
    expect(lines.join('\n')).not.toContain('\u001b');
    expect(lines[0]).toContain('line one');
    expect(lines.join('\n')).toContain('does not make a stack safe');
  });

  it('says so when the index lists nothing', () => {
    write([]);
    const read = readStackIndex(checkout, 'stack-index');
    if (!read.ok) throw new Error(read.message);
    expect(indexLines(read)).toEqual(['The index lists no stack.']);
  });

  it('gives the machine-readable reading with the digest and the folder', () => {
    write([entry()]);
    const read = readStackIndex(checkout, 'stack-index');
    if (!read.ok) throw new Error(read.message);
    expect(JSON.parse(indexJson(read))).toEqual({
      stacks: [
        {
          name: 'evidence-first',
          version: '1.0.0',
          description: 'An investigator agent.',
          link: entry().link,
          digest: DIGEST,
          source: join(checkout, 'packages/stacks/examples/evidence-first'),
        },
      ],
    });
  });
});
