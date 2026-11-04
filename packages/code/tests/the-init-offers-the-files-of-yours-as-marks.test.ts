/**
 * THE FILES OF THE PERSON'S OWN (`CLAUDE.md`, `.claude/CLAUDE.md`, `GEMINI.md`) ARE MARKS OF THEIR OWN, and
 * the rows the question offers are the table's files and no others (`init/hosts.ts`,
 * `commands/instructions.ts`).
 *
 * ADR-174 made the CLAUDE.md that exists a mark a person can leave off: it used to be written "whichever you
 * choose", which is a question whose answer was partly decided before it was asked. What is held:
 *   - EVERY FILE OF `INSTRUCTIONS_TARGETS` HAS EXACTLY ONE ROW, and a row claims no other: a file added to the
 *     table that no row offers is a red here, not a file `init` forgot.
 *   - THE ROWS ARE NAMED BY THE PRODUCT'S TABLE OF HOSTS: each id is a key of `host-names.ts`, each has an
 *     install line the summary says, and the names `--hosts` takes (declared in `wiring/init.ts`) are the rows'.
 *   - A MARK LEFT OFF IS A FILE NOT TOUCHED: with `yours` given, a file of the person's that is not in it is
 *     byte for byte what it was, one that is gets the block after its text, and one that is not there is not
 *     made. With `yours` left out, as for every caller that asked nobody, every one that exists is written, as it
 *     always was.
 *   - WHAT A ROW SAYS ABOUT ITSELF IS WHAT THE TABLE SAYS: the hint that other hosts read `AGENTS.md` is true
 *     of the readers `INSTRUCTIONS_TARGETS` names for it.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeInstructions } from '../src/commands/instructions.js';
import { HOSTS } from '../src/host-names.js';
import {
  HOST_NAMES_OFFERED,
  HOST_ROWS,
  hostMark,
  ownFilesOf,
  PATHS_OFFERED,
  pathsNoRowClaims,
  yoursMark,
  yoursOf,
} from '../src/init/hosts.js';
import { INSTRUCTIONS_TARGETS } from '../src/instructions-block.js';
import { HOSTS_OFFERED } from '../src/wiring/init.js';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mnema-yours-'));
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe('the rows', () => {
  it('claim every file of the table once, and no other', () => {
    expect(pathsNoRowClaims()).toEqual([]);
    expect([...PATHS_OFFERED].sort()).toEqual(
      INSTRUCTIONS_TARGETS.map((target) => target.path).sort(),
    );
    expect(new Set(PATHS_OFFERED).size).toBe(PATHS_OFFERED.length);
  });

  it('put the files mnema always writes under a host as its own, and the person’s under it as marks', () => {
    for (const row of HOST_ROWS) {
      for (const path of row.files) {
        expect(INSTRUCTIONS_TARGETS.find((target) => target.path === path)?.when).toBe('always');
      }
      for (const path of row.yours) {
        expect(INSTRUCTIONS_TARGETS.find((target) => target.path === path)?.when).toBe('exists');
      }
    }
  });

  it('are named by the table of hosts, each with an install line, and by the names --hosts takes', () => {
    for (const row of HOST_ROWS) {
      const install = HOSTS[row.id].install;
      expect('commands' in install || 'words' in install, row.id).toBe(true);
    }
    expect([...HOSTS_OFFERED]).toEqual([...HOST_NAMES_OFFERED]);
  });

  it('say about AGENTS.md what the table says of the hosts that read it', () => {
    const readers =
      INSTRUCTIONS_TARGETS.find((target) => target.path === 'AGENTS.md')?.readers ?? '';
    for (const host of ['Codex', 'Cursor', 'VS Code', 'Copilot CLI', 'OpenCode', 'Qwen Code']) {
      expect(readers, host).toContain(host);
    }
    const hints = HOST_ROWS.map((row) => row.hint).join(' ');
    expect(hints).toContain('Cursor and VS Code read AGENTS.md too');
    expect(hints).toContain('Claude Code reads the rules file at launch');
  });

  it('turn marks into the files they mean, in the order the table lists them', () => {
    const marks = new Set([
      hostMark('codex'),
      hostMark('claude'),
      yoursMark('GEMINI.md'),
      yoursMark('CLAUDE.md'),
    ]);
    expect(ownFilesOf(marks)).toEqual(['.claude/rules/mnema-instructions.md', 'AGENTS.md']);
    expect(yoursOf(marks)).toEqual(['CLAUDE.md', 'GEMINI.md']);
  });
});

describe('writing the instructions with the person’s files as marks', () => {
  const ALL = ['AGENTS.md', '.cursor/rules/mnema-instructions.mdc'];

  it('leaves a file of the person’s that is not among `yours` byte for byte as it was', () => {
    writeFileSync(join(project, 'CLAUDE.md'), '# Mine\n');
    writeFileSync(join(project, 'GEMINI.md'), '# Also mine\n');
    writeInstructions(project, ALL, ['GEMINI.md']);
    expect(readFileSync(join(project, 'CLAUDE.md'), 'utf-8')).toBe('# Mine\n');
    const gemini = readFileSync(join(project, 'GEMINI.md'), 'utf-8');
    expect(gemini.startsWith('# Also mine\n')).toBe(true);
    expect(gemini).toContain('mnema:begin');
  });

  it('writes none of them where `yours` is empty, and makes none that is not there', () => {
    writeFileSync(join(project, 'CLAUDE.md'), '# Mine\n');
    const files = writeInstructions(project, ALL, []);
    expect(files.map((file) => file.path)).toEqual(ALL);
    expect(readFileSync(join(project, 'CLAUDE.md'), 'utf-8')).toBe('# Mine\n');
    expect(() => readFileSync(join(project, 'GEMINI.md'), 'utf-8')).toThrow();
    writeInstructions(project, ALL, ['GEMINI.md']);
    expect(() => readFileSync(join(project, 'GEMINI.md'), 'utf-8')).toThrow();
  });

  it('writes every one that is there where `yours` is left out, as it always did', () => {
    writeFileSync(join(project, 'CLAUDE.md'), '# Mine\n');
    mkdirSync(join(project, '.claude'));
    writeFileSync(join(project, '.claude', 'CLAUDE.md'), '# Nested\n');
    writeFileSync(join(project, 'GEMINI.md'), '# Also mine\n');
    writeInstructions(project, ALL);
    for (const path of ['CLAUDE.md', '.claude/CLAUDE.md', 'GEMINI.md']) {
      expect(readFileSync(join(project, path), 'utf-8'), path).toContain('mnema:begin');
    }
  });
});
