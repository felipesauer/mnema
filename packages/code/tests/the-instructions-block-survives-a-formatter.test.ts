/**
 * THE BLOCK SURVIVES THE FORMATTER THAT REFLOWS IT.
 *
 * A Markdown formatter with `proseWrap: "always"` breaks the block's long lines at the print width,
 * and the block it left was refused as "somebody's edit" by every check that compared the text
 * between the markers byte for byte. The block is judged by its words and its shape (the lines of a
 * paragraph or of one list item are one), so a reflow is not an edit, and a changed word still is.
 *
 * These tests run the real prettier, the one this package pins, over files mnema wrote.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as prettier from 'prettier';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkInstructions,
  removeInstructions,
  writeInstructions,
} from '../src/commands/instructions.js';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mnema-block-formatter-'));
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

const put = (path: string, text: string): void => {
  mkdirSync(join(project, path, '..'), { recursive: true });
  writeFileSync(join(project, path), text, 'utf-8');
};
const get = (path: string): string => readFileSync(join(project, path), 'utf-8');
const stateOf = (path: string): string | undefined =>
  checkInstructions(project).find((file) => file.path === path)?.found.state;

const format = (text: string, proseWrap: 'always' | 'never' | 'preserve') =>
  prettier.format(text, { parser: 'markdown', proseWrap, printWidth: 80 });

describe.each(['always', 'never', 'preserve'] as const)(
  'prettier with proseWrap %s',
  (proseWrap) => {
    it('leaves the block of AGENTS.md current, and a write leaves the file as the formatter made it', async () => {
      put('AGENTS.md', '# Rules\n\nUse tabs.\n');
      writeInstructions(project, ['AGENTS.md']);
      const formatted = await format(get('AGENTS.md'), proseWrap);
      put('AGENTS.md', formatted);

      expect(stateOf('AGENTS.md')).toBe('current');
      const [again] = writeInstructions(project, ['AGENTS.md']);
      expect(again?.did).toBe('unchanged');
      expect(get('AGENTS.md')).toBe(formatted);
    });

    it('takes the reflowed block out and leaves the person’s words', async () => {
      put('AGENTS.md', '# Rules\n\nUse tabs.\n');
      writeInstructions(project, ['AGENTS.md']);
      put('AGENTS.md', await format(get('AGENTS.md'), proseWrap));

      const [removed] = removeInstructions(project);
      expect(removed?.did).toBe('removed');
      expect(get('AGENTS.md')).toBe('# Rules\n\nUse tabs.\n');
    });

    it('refuses the reflowed block when one word of it was changed', async () => {
      put('AGENTS.md', '# Rules\n\nUse tabs.\n');
      writeInstructions(project, ['AGENTS.md']);
      const formatted = await format(get('AGENTS.md'), proseWrap);
      expect(formatted).toContain('`bootstrap`');
      put('AGENTS.md', formatted.replace('`bootstrap`', '`bootstraps`'));

      expect(stateOf('AGENTS.md')).toBe('edited');
      const [written] = writeInstructions(project, ['AGENTS.md']);
      expect(written?.did).toBe('refused');
    });

    it('holds the files wholly mnema’s current after the formatter has run over them', async () => {
      writeInstructions(project);
      for (const path of [
        '.claude/rules/mnema-instructions.md',
        '.github/instructions/mnema-instructions.instructions.md',
      ]) {
        put(path, await format(get(path), proseWrap));
        expect(stateOf(path)).toBe('current');
      }
    });
  },
);

describe('what is still an edit after a reflow', () => {
  it.each([
    ['a list item taken out', (text: string) => text.replace(/^- A subagent records.*\n/m, '')],
    [
      'two paragraphs joined',
      (text: string) => text.replace('\n\nWhere the tools', ' Where the tools'),
    ],
    [
      'a list item run into the one above it',
      (text: string) => text.replace('\n- A decision is born', ' - A decision is born'),
    ],
    ['a word added', (text: string) => text.replace('call `bootstrap`', 'never call `bootstrap`')],
    [
      'an example command changed',
      (text: string) => text.replace('mnema decision record', 'mnema decision recorded'),
    ],
    [
      'an example command no longer indented as code',
      (text: string) => text.replace('    mnema decision supersede', '  mnema decision supersede'),
    ],
  ])('%s', async (_name, change) => {
    put('AGENTS.md', '# Rules\n');
    writeInstructions(project, ['AGENTS.md']);
    const formatted = await format(get('AGENTS.md'), 'always');
    const edited = change(formatted);
    expect(edited).not.toBe(formatted);
    put('AGENTS.md', edited);
    expect(stateOf('AGENTS.md')).toBe('edited');
  });
});
