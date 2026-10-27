import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pathOfQuery, WHY_SCHEME, whyArgs, whyDocument, whyPath, whyQuery } from './why.js';

/** What the built command line printed for `mnema why -- src/a.ts` in a sample project. */
const PRINTED = readFileSync(new URL('./fixtures/why-a-file.txt', import.meta.url), 'utf8');
const AT = new Date('2026-10-27T14:03:09.482Z');

describe('the document of mnema why', () => {
  it('asks for the path after --, which is what makes a file named like an option a file', () => {
    expect(whyArgs('src/a.ts')).toEqual(['why', '--', 'src/a.ts']);
    expect(whyArgs('-x')).toEqual(['why', '--', '-x']);
    expect(whyArgs('--json')).toEqual(['why', '--', '--json']);
  });

  it('carries the path and the moment in the address, and gives back the path it was given', () => {
    for (const path of ['src/a.ts', '-x', 'a b/c&d=e.ts', 'a\nb', 'café/100%.ts']) {
      expect(pathOfQuery(whyQuery(path, 1_700_000_000_000)), path).toBe(path);
    }
    expect(WHY_SCHEME).toBe('mnema-why');
    expect(pathOfQuery('path=a')).toBeUndefined();
    expect(pathOfQuery('path=%ZZ&at=1')).toBeUndefined();
    expect(pathOfQuery('')).toBeUndefined();
  });

  it('names the tab by the last part of the path, on one line', () => {
    expect(whyPath('src/deep/a.ts')).toBe('/Why a.ts');
    expect(whyPath('a\nb.ts')).not.toContain('\n');
  });

  it('shows what the command line printed under a header that says what was asked and when', () => {
    const text = whyDocument('src/a.ts', { code: 0, stdout: PRINTED, stderr: '' }, AT);
    expect(text.startsWith('mnema why -- src/a.ts, read at 2026-10-27T14:03:09Z\n\n')).toBe(true);
    expect(text).toContain(PRINTED.trimEnd());
    expect(text.endsWith('\n')).toBe(true);
  });

  it('shows the refusal as it was said, and no line of what it did not print', () => {
    const text = whyDocument('src/a.ts', { code: 1, stdout: '', stderr: 'Not a project.\n' }, AT);
    expect(text).toContain('mnema refused: Not a project.');
    expect(text).not.toContain('rules in force');
    expect(whyDocument('x', { code: null, stdout: '', stderr: '' }, AT)).toContain(
      'mnema refused: no reason given',
    );
  });

  it('keeps a line break and a control character of the path out of the header', () => {
    const header = whyDocument('a\nb\u0007c.ts', { code: 0, stdout: 'ok', stderr: '' }, AT).split(
      '\n\n',
    )[0];
    expect(header).not.toContain('\n');
    expect(header).not.toContain('\u0007');
  });
});
