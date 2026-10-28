/**
 * THE BLOCK IS WRITTEN AS A FORMATTER LEAVES IT, AND ITS EXAMPLE IS A COMMAND THAT RUNS.
 *
 * The block `mnema init` writes failed the `format:check` of the repositories it was written
 * into: a Markdown formatter asks for a blank line between the begin marker and the heading, and
 * between a closing code fence and the end marker, and the block had neither. Putting the files
 * in the project's ignore list would silence the formatter about the person's own text, so the
 * block is made to be what the formatter would write. This repository formats with biome and
 * carries no Markdown formatter to run, so the shape the formatter asks for is held here, edge
 * by edge, and the pilots' own formatter was run over the files by hand when this was written.
 *
 * And the example the block gives is not an illustration: it is run here, as written, against the
 * built binary in a sandbox, and the decision it records is read back with what was turned down.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkInstructions, writeInstructions } from '../src/commands/instructions.js';
import {
  beginMarker,
  INSTRUCTIONS_BLOCK,
  INSTRUCTIONS_BODY,
  INSTRUCTIONS_END,
  INSTRUCTIONS_TARGETS,
  INSTRUCTIONS_VERSION,
  KNOWN_BODIES,
} from '../src/instructions-block.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;
let project: string;
let home: string;
let shims: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-block-example-'));
  project = join(sandbox, 'project');
  home = join(sandbox, 'home');
  shims = join(sandbox, 'bin');
  for (const dir of [project, home, shims]) mkdirSync(dir);
  // The block says `mnema ...`: a shim named so, running the built binary, is how the line runs as written.
  writeFileSync(join(shims, 'mnema'), `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`);
  chmodSync(join(shims, 'mnema'), 0o755);
  spawnSync('git', ['init', '-q', '-b', 'main', project], {
    env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE },
  });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function shell(line: string) {
  const ran = spawnSync('sh', ['-c', line], {
    cwd: project,
    encoding: 'utf-8',
    env: { PATH: `${shims}:${process.env.PATH ?? ''}`, HOME: home },
  });
  return { status: ran.status, out: `${ran.stdout}${ran.stderr}` };
}

/** The command of every indented code block of the body, in order. */
function shellExamples(): string[] {
  return INSTRUCTIONS_BODY.split('\n')
    .filter((line) => line.startsWith('    '))
    .map((line) => line.slice(4));
}

describe('the block as a formatter would write it', () => {
  const lines = INSTRUCTIONS_BLOCK.split('\n');

  it('sets the heading apart from the begin marker, and the end marker from what is above it', () => {
    expect(lines[0]).toBe(beginMarker(INSTRUCTIONS_VERSION));
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('## Recording the work (mnema)');
    const end = lines.indexOf(INSTRUCTIONS_END);
    expect(lines[end - 1]).toBe('');
    expect(lines[end - 2]).not.toBe('');
  });

  it('has no run of blank lines and no trailing space, and sets each code block apart by blank lines', () => {
    expect(INSTRUCTIONS_BLOCK).not.toMatch(/\n\n\n/);
    expect(INSTRUCTIONS_BLOCK).not.toMatch(/[ \t]\n/);
    const code = lines.flatMap((line, at) => (line.startsWith('    ') ? [at] : []));
    expect(code.length).toBe(2);
    for (const at of code) {
      expect(lines[at - 1]).toBe('');
      expect(lines[at + 1]).toBe('');
    }
  });

  it('opens no code fence: one of ours would be closed by, or would close, a fence of the person’s', () => {
    expect(INSTRUCTIONS_BLOCK).not.toMatch(/^ {0,3}(`{3,}|~{3,})/m);
  });

  it('is what every file the block goes into holds, the person’s and the ones wholly its own', () => {
    writeFileSync(join(project, 'AGENTS.md'), '# How we work here\n');
    writeInstructions(project);
    for (const target of INSTRUCTIONS_TARGETS.filter((one) => one.when === 'always')) {
      const text = readFileSync(join(project, target.path), 'utf-8');
      expect(text, target.path).toContain(`${beginMarker(INSTRUCTIONS_VERSION)}\n\n## Recording`);
      expect(text, target.path).toContain('\n\n<!-- mnema:end -->\n');
      expect(text, target.path).toMatch(
        /\n {4}mnema decision supersede .*\n\n<!-- mnema:end -->\n/,
      );
    }
  });
});

describe('a block of the version before', () => {
  const v2 = KNOWN_BODIES['v2'] as string;
  const older = `${beginMarker('v2')}\n${v2}${INSTRUCTIONS_END}\n`;

  it('is still the product’s: a person’s file and a file of its own are both replaced by this one', () => {
    writeFileSync(join(project, 'AGENTS.md'), `# How we work here\n\n${older}`);
    mkdirSync(join(project, '.claude/rules'), { recursive: true });
    writeFileSync(join(project, '.claude/rules/mnema-instructions.md'), older);
    expect(checkInstructions(project).find((file) => file.path === 'AGENTS.md')?.found).toEqual({
      state: 'outdated',
    });
    const done = writeInstructions(project);
    expect(done.find((file) => file.path === 'AGENTS.md')?.did).toBe('replaced');
    expect(done.find((file) => file.path === '.claude/rules/mnema-instructions.md')?.did).toBe(
      'replaced',
    );
    expect(readFileSync(join(project, 'AGENTS.md'), 'utf-8')).toBe(
      `# How we work here\n\n${INSTRUCTIONS_BLOCK}`,
    );
    expect(readFileSync(join(project, '.claude/rules/mnema-instructions.md'), 'utf-8')).toBe(
      INSTRUCTIONS_BLOCK,
    );
  });

  it('is kept byte for byte, and is not the text this version writes', () => {
    expect(v2).not.toBe(INSTRUCTIONS_BODY);
    expect(v2.startsWith('## Recording the work (mnema)\n')).toBe(true);
    expect(v2).toContain('`mnema decision record "<title>" "<rationale>" --alternatives');
  });
});

describe('the example the block gives', () => {
  it('records a decision with what was turned down, run as written', () => {
    const [record] = shellExamples();
    expect(record).toMatch(/^mnema decision record /);
    expect(record).toContain('--alternatives');
    expect(shell('mnema init').status).toBe(0);
    const ran = shell(record as string);
    expect(ran.status, ran.out).toBe(0);
    expect(ran.out).toMatch(/Recorded decision ADR-1/);
    const shown = shell('mnema show ADR-1');
    expect(shown.out).toContain('Use pnpm for the workspace');
    expect(shown.out).toContain('Considered and turned down:');
    expect(shown.out).toContain('npm: no workspace protocol; yarn: a second lockfile to keep');
  }, 120_000);

  it('and the line that supersedes, with its ids filled in, moves the earlier decision', () => {
    const [record, supersede] = shellExamples();
    expect(supersede).toMatch(/^mnema decision supersede <old-id> <new-id> --reason "<why>"$/);
    expect(shell('mnema init').status).toBe(0);
    const ids = [record as string, 'mnema decision record "Use bun" "A later call."'].map(
      (line) => /\(([0-9a-f-]{36})\)/.exec(shell(line).out)?.[1] as string,
    );
    expect(ids.every((id) => typeof id === 'string')).toBe(true);
    const line = (supersede as string)
      .replace('<old-id>', ids[0] as string)
      .replace('<new-id>', ids[1] as string)
      .replace('<why>', 'bun replaced it');
    const ran = shell(line);
    expect(ran.status, ran.out).toBe(0);
    expect(ran.out).toContain('→ superseded');
    expect(shell('mnema show ADR-1').out).toContain(`superseded by ${ids[1]}`);
  }, 120_000);
});
