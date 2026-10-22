/**
 * The block of standing instructions (ADR-46): what it says, and what `mnema instructions` does to
 * the files a host reads. A file of the person's keeps every byte outside the markers; a block
 * somebody edited is refused and never overwritten; taking the block out leaves the file as it was
 * before it went in; the alpha's `MNEMA:START` block is not recognized and is never touched.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  changeLine,
  checkInstructions,
  type InstructionsFile,
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

  it('does not recognize the alpha’s MNEMA:START block: it is kept byte for byte and the block goes beside it', () => {
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
    expect(checkInstructions(project).find((file) => file.path === 'AGENTS.md')?.found).toEqual({
      state: 'missing',
      exists: true,
    });
    expect(did(writeInstructions(project))['AGENTS.md']).toBe('added');
    expect(text('AGENTS.md')).toBe(`${alpha}\n${INSTRUCTIONS_BLOCK}`);
    expect(did(removeInstructions(project))['AGENTS.md']).toBe('removed');
    expect(text('AGENTS.md')).toBe(alpha);
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

describe('a file that cannot be read or written', () => {
  it('is that file’s refusal or failure, with its reason, and every other file is still written', () => {
    mkdirSync(at('AGENTS.md'));
    put('.claude', 'a file where the directory of a rule should be');
    const files = writeInstructions(project);
    const byPath = Object.fromEntries(files.map((file) => [file.path, file]));
    expect(byPath['AGENTS.md']?.did).toBe('refused');
    expect(changeLine(byPath['AGENTS.md'] as InstructionsFile)).toMatch(
      /Left AGENTS\.md as it is: it could not be read: it is a directory, not a file\..*`mnema instructions` tries again/,
    );
    expect(byPath['.claude/rules/mnema-instructions.md']?.did).toBe('refused');
    expect(byPath['.cursor/rules/mnema-instructions.mdc']?.did).toBe('created');
    expect(existsSync(at('.github/instructions/mnema-instructions.instructions.md'))).toBe(true);
    for (const file of files)
      expect(changeLine(file)).not.toMatch(/\bE(ISDIR|ACCES|NOTDIR|PERM|EXIST)\b|\bat .*\.js/);
  });

  it.skipIf(process.getuid?.() === 0)(
    'says a file it could not write, by name, and writes the rest',
    () => {
      put('CLAUDE.md', '# Ours\n');
      chmodSync(at('CLAUDE.md'), 0o444);
      const files = writeInstructions(project);
      const claude = files.find((file) => file.path === 'CLAUDE.md') as InstructionsFile;
      expect(claude.did).toBe('failed');
      expect(changeLine(claude)).toBe(
        'Did not change CLAUDE.md: permission denied. Once that is fixed, `mnema instructions` tries again.',
      );
      expect(text('CLAUDE.md')).toBe('# Ours\n');
      expect(files.find((file) => file.path === 'AGENTS.md')?.did).toBe('created');
    },
  );

  it('is said by --check as a state of the file, not an error', () => {
    mkdirSync(at('AGENTS.md'));
    const checked = checkInstructions(project);
    expect(checked.find((file) => file.path === 'AGENTS.md')?.found).toEqual({
      state: 'blocked',
      why: 'it could not be read: it is a directory, not a file',
    });
    expect(instructionsAreCurrent(checked)).toBe(false);
  });
});

describe('a marker inside a fenced code block', () => {
  const EXAMPLE = [
    '# Using mnema',
    '',
    '```markdown',
    beginMarker('v1'),
    'anything',
    INSTRUCTIONS_END,
    '```',
    '',
    '~~~',
    '<!-- MNEMA:START -->',
    'alpha text',
    '<!-- MNEMA:END -->',
    '~~~',
    '',
  ].join('\n');

  it('is an example: no block is found, one is added after it, and removing it leaves the example', () => {
    put('AGENTS.md', EXAMPLE);
    expect(checkInstructions(project).find((file) => file.path === 'AGENTS.md')?.found).toEqual({
      state: 'missing',
      exists: true,
    });
    expect(did(writeInstructions(project))['AGENTS.md']).toBe('added');
    expect(text('AGENTS.md')).toBe(`${EXAMPLE}\n${INSTRUCTIONS_BLOCK}`);
    expect(did(removeInstructions(project))['AGENTS.md']).toBe('removed');
    expect(text('AGENTS.md')).toBe(EXAMPLE);
    expect(withoutTheBlock(`${EXAMPLE}\n${INSTRUCTIONS_BLOCK}`)).toBe(`${EXAMPLE}\n\n`);
  });
});

describe('a code fence that is never closed', () => {
  const OPEN = '# x\n```\ncode never closed\n';

  it('hides no marker: the block is found, written once, checked and taken out', () => {
    put('AGENTS.md', OPEN);
    expect(did(writeInstructions(project))['AGENTS.md']).toBe('added');
    expect(did(writeInstructions(project))['AGENTS.md']).toBe('unchanged');
    expect(text('AGENTS.md').split(beginMarker('v1')).length - 1).toBe(1);
    expect(checkInstructions(project).find((file) => file.path === 'AGENTS.md')?.found.state).toBe(
      'current',
    );
    expect(did(removeInstructions(project))['AGENTS.md']).toBe('removed');
    expect(text('AGENTS.md')).toBe(OPEN);
    expect(withoutTheBlock(`${OPEN}\n${INSTRUCTIONS_BLOCK}`)).toBe(`${OPEN}\n\n`);
  });
});

describe('taking the block out', () => {
  it('never glues the person’s last line to what follows, and says the rest is as it was only when it is', () => {
    put('AGENTS.md', 'one');
    writeInstructions(project);
    put('AGENTS.md', `${text('AGENTS.md')}written after\n`);
    const removed = removeInstructions(project).find((file) => file.path === 'AGENTS.md');
    expect(text('AGENTS.md')).toBe('one\nwritten after\n');
    expect(removed?.asItWas).toBe(false);
    expect(changeLine(removed as InstructionsFile)).not.toContain('as it was');
  });

  it('keeps what the person wrote above the block after it went in', () => {
    put('AGENTS.md', 'one\n');
    writeInstructions(project);
    put('AGENTS.md', `written before\n${text('AGENTS.md')}`);
    removeInstructions(project);
    expect(text('AGENTS.md')).toBe('written before\none\n');
  });

  it('says it is as it was when putting the block back gives the file it found', () => {
    put('AGENTS.md', 'no final newline');
    writeInstructions(project);
    const removed = removeInstructions(project).find((file) => file.path === 'AGENTS.md');
    expect(text('AGENTS.md')).toBe('no final newline');
    expect(changeLine(removed as InstructionsFile)).toContain('as it was before them');
  });
});

describe('a file with CRLF line endings', () => {
  const crlf = (value: string) => value.replace(/\n/g, '\r\n');

  it('holds the current block when a checkout turned its line endings into CRLF', () => {
    put('AGENTS.md', crlf(`${THEIRS}\n${INSTRUCTIONS_BLOCK}`));
    const agents = checkInstructions(project).find((file) => file.path === 'AGENTS.md');
    expect(agents?.found).toEqual({ state: 'current' });
    expect(did(writeInstructions(project))['AGENTS.md']).toBe('unchanged');
  });

  it('adds the block in CRLF and takes it out to the very bytes', () => {
    const theirs = crlf(THEIRS);
    put('AGENTS.md', theirs);
    writeInstructions(project);
    expect(text('AGENTS.md')).toBe(`${theirs}\r\n${crlf(INSTRUCTIONS_BLOCK)}`);
    const removed = removeInstructions(project).find((file) => file.path === 'AGENTS.md');
    expect(removed?.did).toBe('removed');
    expect(text('AGENTS.md')).toBe(theirs);
  });

  it('keeps an old alpha block byte for byte and adds the block beside it in the file’s line endings', () => {
    const old = crlf('# a\n\n<!-- MNEMA:START -->\nold\n<!-- MNEMA:END -->\n\nmine\n');
    put('AGENTS.md', old);
    writeInstructions(project);
    expect(text('AGENTS.md')).toBe(`${old}\r\n${crlf(INSTRUCTIONS_BLOCK)}`);
  });

  it('leaves a file of its own alone when it holds the current text in CRLF', () => {
    writeInstructions(project);
    const path = OWN_INSTRUCTIONS_FILES[0] as string;
    put(path, crlf(text(path)));
    expect(writeInstructions(project).find((file) => file.path === path)?.did).toBe('unchanged');
  });
});

describe('a symbolic link', () => {
  let outside: string;
  beforeEach(() => {
    outside = mkdtempSync(join(tmpdir(), 'mnema-instructions-outside-'));
  });
  afterEach(() => {
    rmSync(outside, { recursive: true, force: true });
  });

  it('whose target is outside the project is not written through, and the refusal says where it goes', () => {
    writeFileSync(join(outside, 'theirs.md'), '# Elsewhere\n');
    symlinkSync(join(outside, 'theirs.md'), at('CLAUDE.md'));
    const files = writeInstructions(project);
    const claude = files.find((file) => file.path === 'CLAUDE.md') as InstructionsFile;
    expect(claude.did).toBe('refused');
    expect(changeLine(claude)).toContain(realpathSync(outside));
    expect(readFileSync(join(outside, 'theirs.md'), 'utf-8')).toBe('# Elsewhere\n');
    expect(files.find((file) => file.path === 'AGENTS.md')?.did).toBe('created');
  });

  it('that leads nowhere is refused, and not created through', () => {
    symlinkSync(join(outside, 'missing.md'), at('AGENTS.md'));
    const agents = writeInstructions(project).find((file) => file.path === 'AGENTS.md');
    expect(agents?.did).toBe('refused');
    expect(changeLine(agents as InstructionsFile)).toContain('which does not exist');
    expect(existsSync(join(outside, 'missing.md'))).toBe(false);
  });

  it('as a directory of a file of its own that leaves the project is not written through either', () => {
    symlinkSync(outside, at('.claude'));
    const rule = writeInstructions(project).find(
      (file) => file.path === '.claude/rules/mnema-instructions.md',
    );
    expect(rule?.did).toBe('refused');
    expect(existsSync(join(outside, 'rules'))).toBe(false);
  });

  it('to a file the block founded is not refused when taking the block out deletes that file first', () => {
    writeInstructions(project);
    rmSync(at('CLAUDE.md'), { force: true });
    symlinkSync('AGENTS.md', at('CLAUDE.md'));
    const files = removeInstructions(project);
    expect(did(files)['AGENTS.md']).toBe('deleted');
    expect(files.some((file) => file.did === 'refused')).toBe(false);
    expect(existsSync(at('AGENTS.md'))).toBe(false);
  });

  it('that resolves inside the project is followed, and taking the block out leaves the file as it was', () => {
    put('docs/rules.md', THEIRS);
    symlinkSync('docs/rules.md', at('GEMINI.md'));
    expect(did(writeInstructions(project))['GEMINI.md']).toBe('added');
    expect(text('docs/rules.md')).toContain(INSTRUCTIONS_END);
    removeInstructions(project);
    expect(text('docs/rules.md')).toBe(THEIRS);
  });
});
