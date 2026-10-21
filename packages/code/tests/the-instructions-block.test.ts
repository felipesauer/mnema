/**
 * The block of standing instructions (ADR-46): what it says, and what `mnema instructions` does to
 * the files a host reads. A file of the person's keeps every byte outside the markers; a block
 * somebody edited is refused and never overwritten; taking the block out leaves the file as it was
 * before it went in; the alpha's `MNEMA:START` block is replaced.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkInstructions,
  instructionsAreCurrent,
  removeInstructions,
  writeInstructions,
} from '../src/commands/instructions.js';
import { decisionFileAt } from '../src/decision-files.js';
import {
  beginMarker,
  INSTRUCTIONS_BLOCK,
  INSTRUCTIONS_BODY,
  INSTRUCTIONS_END,
  OWN_INSTRUCTIONS_FILES,
  withoutTheBlock,
} from '../src/instructions-block.js';
import { tellsWhatToDo } from '../src/record-framing.js';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mnema-instructions-'));
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

const at = (path: string) => join(project, path);
const put = (path: string, text: string) => {
  mkdirSync(dirname(at(path)), { recursive: true });
  writeFileSync(at(path), text, 'utf-8');
};
const text = (path: string) => readFileSync(at(path), 'utf-8');
const did = (files: ReturnType<typeof writeInstructions>) =>
  Object.fromEntries(files.map((file) => [file.path, file.did]));

const THEIRS = '# How we work here\n\nRun `make check` before a push.\n';

describe('the text of the block', () => {
  it('names the doors and when to use them, and tells nobody what to do about their code', () => {
    expect(tellsWhatToDo(INSTRUCTIONS_BODY)).toBeUndefined();
  });

  it('is conditioned on the tools being connected, so a fork without mnema reads it as inert', () => {
    expect(INSTRUCTIONS_BODY).toContain('Where the mnema tools are connected:');
    expect(INSTRUCTIONS_BODY).toContain(
      'Where the tools are not connected and the `mnema` command is installed',
    );
  });

  it('says the record changes with the work in the same line that says its files are not edited by hand', () => {
    const line = INSTRUCTIONS_BODY.split('\n').find((one) => /never edit/i.test(one)) as string;
    expect(line).toContain('Commit `.mnema/` with the work it describes');
    expect(line).toContain('the record changes as the work does');
  });

  it('names every door it says to use, and the shell command where they are not connected', () => {
    for (const door of [
      '`bootstrap`',
      '`governing_rules`',
      '`record_decision`',
      '`capture_memory`',
      'born `proposed`',
      'A subagent records no decision',
      '`mnema decision record',
    ]) {
      expect(INSTRUCTIONS_BODY).toContain(door);
    }
  });
});

describe('mnema instructions in a project with no instruction file', () => {
  it('creates AGENTS.md and the files of its own, and nothing else', () => {
    expect(did(writeInstructions(project))).toEqual({
      'AGENTS.md': 'created',
      '.claude/rules/mnema-instructions.md': 'created',
      '.github/instructions/mnema-instructions.instructions.md': 'created',
      '.cursor/rules/mnema-instructions.mdc': 'created',
    });
    expect(text('AGENTS.md')).toBe(INSTRUCTIONS_BLOCK);
    expect(text('.claude/rules/mnema-instructions.md')).toBe(INSTRUCTIONS_BLOCK);
    expect(text('.github/instructions/mnema-instructions.instructions.md')).toBe(
      `---\napplyTo: "**"\n---\n\n${INSTRUCTIONS_BLOCK}`,
    );
    expect(text('.cursor/rules/mnema-instructions.mdc')).toBe(
      `---\nalwaysApply: true\n---\n\n${INSTRUCTIONS_BLOCK}`,
    );
    expect(readdirSync(project).sort()).toEqual(['.claude', '.cursor', '.github', 'AGENTS.md']);
    expect(instructionsAreCurrent(checkInstructions(project))).toBe(true);
  });

  it('writes nothing a second time', () => {
    writeInstructions(project);
    expect(new Set(writeInstructions(project).map((file) => file.did))).toEqual(
      new Set(['unchanged']),
    );
  });

  it('removes what it created, directories included, leaving the project as it was', () => {
    writeInstructions(project);
    removeInstructions(project);
    expect(readdirSync(project)).toEqual([]);
  });
});

describe('mnema instructions in a file of the person’s', () => {
  it('adds the block after their text and leaves every byte of it', () => {
    put('AGENTS.md', THEIRS);
    put('CLAUDE.md', 'no final newline');
    put('GEMINI.md', '');
    const files = did(writeInstructions(project));
    expect(files['AGENTS.md']).toBe('added');
    expect(files['CLAUDE.md']).toBe('added');
    expect(files['GEMINI.md']).toBe('added');
    expect(text('AGENTS.md')).toBe(`${THEIRS}\n${INSTRUCTIONS_BLOCK}`);
    expect(withoutTheBlock(text('AGENTS.md'))).toBe(`${THEIRS}\n\n`);
  });

  it('writes CLAUDE.md, .claude/CLAUDE.md and GEMINI.md only where they exist', () => {
    put('.claude/CLAUDE.md', THEIRS);
    const paths = writeInstructions(project).map((file) => file.path);
    expect(paths).toContain('.claude/CLAUDE.md');
    expect(paths).not.toContain('CLAUDE.md');
    expect(paths).not.toContain('GEMINI.md');
    expect(existsSync(at('CLAUDE.md'))).toBe(false);
  });

  it('takes the block out and leaves each file byte for byte as it was, the empty one included', () => {
    put('AGENTS.md', THEIRS);
    put('CLAUDE.md', 'no final newline');
    put('GEMINI.md', '');
    writeInstructions(project);
    const removed = did(removeInstructions(project));
    expect(removed['AGENTS.md']).toBe('removed');
    expect(text('AGENTS.md')).toBe(THEIRS);
    expect(text('CLAUDE.md')).toBe('no final newline');
    expect(text('GEMINI.md')).toBe('');
  });

  it('refuses a block whose text somebody edited, and leaves it as it is on a write and on a removal', () => {
    const edited = `${THEIRS}\n${INSTRUCTIONS_BLOCK.replace('call `bootstrap`', 'call `bootstrap` twice')}`;
    put('AGENTS.md', edited);
    const written = writeInstructions(project).find((file) => file.path === 'AGENTS.md');
    expect(written?.did).toBe('refused');
    expect(written?.found).toMatchObject({ state: 'edited' });
    expect(text('AGENTS.md')).toBe(edited);
    expect(removeInstructions(project).find((file) => file.path === 'AGENTS.md')?.did).toBe(
      'refused',
    );
    expect(text('AGENTS.md')).toBe(edited);
  });

  it('refuses a file of its own that somebody added to', () => {
    writeInstructions(project);
    const path = OWN_INSTRUCTIONS_FILES[0] as string;
    put(path, `${text(path)}\nAnd one line of ours.\n`);
    const before = text(path);
    expect(writeInstructions(project).find((file) => file.path === path)?.did).toBe('refused');
    expect(text(path)).toBe(before);
  });

  it('replaces the block an earlier version wrote, and touches nothing outside its markers', () => {
    const older = `${beginMarker('v1')}\n${INSTRUCTIONS_BODY}${INSTRUCTIONS_END}\n`;
    put('AGENTS.md', `${THEIRS}\n${older}\n## After\n`);
    writeInstructions(project);
    expect(text('AGENTS.md')).toBe(`${THEIRS}\n${INSTRUCTIONS_BLOCK}\n## After\n`);
  });

  it('refuses a block of a version it does not know', () => {
    put('AGENTS.md', `${beginMarker('v9')}\nfrom a newer mnema\n${INSTRUCTIONS_END}\n`);
    expect(
      writeInstructions(project).find((file) => file.path === 'AGENTS.md')?.found,
    ).toMatchObject({
      state: 'edited',
    });
  });

  it('replaces the alpha’s MNEMA:START block in place', () => {
    const alpha = [
      '# notagrafo',
      '',
      '<!-- MNEMA:START -->',
      'Use Mnema, not your client’s own memory: call `context_bootstrap` and `agent_run_start`.',
      '<!-- MNEMA:END -->',
      '',
      'The rest is theirs.',
      '',
    ].join('\n');
    put('AGENTS.md', alpha);
    expect(checkInstructions(project).find((file) => file.path === 'AGENTS.md')?.found.state).toBe(
      'legacy',
    );
    expect(did(writeInstructions(project))['AGENTS.md']).toBe('replaced-legacy');
    expect(text('AGENTS.md')).toBe(`# notagrafo\n\n${INSTRUCTIONS_BLOCK}\nThe rest is theirs.\n`);
  });

  it('writes a CLAUDE.md that links to AGENTS.md once', () => {
    put('AGENTS.md', THEIRS);
    symlinkSync('AGENTS.md', at('CLAUDE.md'));
    const files = did(writeInstructions(project));
    expect(files['AGENTS.md']).toBe('added');
    expect(files['CLAUDE.md']).toBe('unchanged');
    expect(text('AGENTS.md').split(INSTRUCTIONS_END).length).toBe(2);
  });
});

describe('mnema instructions --check', () => {
  it('says which file lacks the block, without writing', () => {
    put('AGENTS.md', THEIRS);
    const checked = checkInstructions(project);
    expect(checked.find((file) => file.path === 'AGENTS.md')?.found).toEqual({
      state: 'missing',
      exists: true,
    });
    expect(instructionsAreCurrent(checked)).toBe(false);
    expect(text('AGENTS.md')).toBe(THEIRS);
    expect(existsSync(at('.cursor'))).toBe(false);
  });
});

describe('a write of the block to an instruction file', () => {
  it('is not a decision file: the block is the product’s words, not a call of the project’s', () => {
    expect(decisionFileAt('AGENTS.md', `${THEIRS}\n${INSTRUCTIONS_BLOCK}`)).toBeUndefined();
    // A line inside the markers that opens as a call does is still the block's, not the person's.
    const opensAsACall = `${beginMarker('v1')}\nDecision: never mind\n${INSTRUCTIONS_END}\n`;
    expect(decisionFileAt('AGENTS.md', opensAsACall)).toBeUndefined();
    for (const path of OWN_INSTRUCTIONS_FILES) {
      expect(decisionFileAt(path, INSTRUCTIONS_BLOCK)).toBeUndefined();
    }
  });

  it('still reads a call the person wrote beside it', () => {
    expect(decisionFileAt('AGENTS.md', `${INSTRUCTIONS_BLOCK}\nDecision: use pnpm.\n`)).toEqual({
      door: 'record-decision',
    });
  });
});
