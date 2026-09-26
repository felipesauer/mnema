/**
 * A GROUP'S FLAG A SUBCOMMAND DOES NOT READ IS REFUSED BEFORE ANYTHING IS WRITTEN — on the binary.
 *
 * WHAT WAS WRONG. `decision` declares `--alternatives` for the decision it records, and `skill`
 * declares `--body` for the pattern it proposes. commander hands a group those flags wherever they
 * are written, and a subcommand that did not read one dropped it: measured before the repair, in a
 * project, `decision move accept <id> --note ok --alternatives "a spreadsheet"` recorded the verdict
 * with exit 0 and the alternatives nowhere, `decision import docs/adr --write --alternatives …`
 * recorded the proposals the same way, and `skill move review <id> --note ok --body …` moved the
 * skill and kept its old body. A caller had no way to know the flag had meant nothing.
 *
 * WHAT IS ASSERTED. Each of those lines, and its sibling on the other subcommands, is refused with
 * the sentence that says where the flag is read — and the record, the HOME and the project's own
 * files are left byte for byte as they were. And the same line without the flag goes through, so
 * the flag is the whole reason. The completion script the binary writes offers none of them there,
 * and still offers the group's `--which` on a move, which reads it.
 *
 * WHAT IS NOT: which flags each subcommand reads, over every pair the program holds, is
 * `every-group-flag-is-read-or-refused.test.ts`, in process and without a project.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** The built binary — what a person runs. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;
let repo: string;
let home: string;
let decision: string;
let successor: string;
let skill: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-a-refused-group-flag-'));
  repo = join(sandbox, 'repo');
  home = join(sandbox, 'home');
  mkdirSync(join(repo, 'docs', 'adr'), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(repo, 'docs', 'adr', '0001-use-a-queue.md'),
    '# Use a queue\n\n## Status\n\nAccepted\n\n## Context\n\nWhy a queue.\n',
  );
  expect(mnema('init').status).toBe(0);
  decision = idOf(mnema('decision', 'Use UTC', 'one clock'));
  successor = idOf(mnema('decision', 'Use UTC everywhere', 'one clock, stated'));
  skill = idOf(mnema('skill', 'Run the gates', '--body', 'build, lint, test'));
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** `mnema <argv>` in the project, with a HOME of its own. */
function mnema(...argv: string[]): { status: number | null; said: string } {
  const ran = spawnSync(process.execPath, [CLI, '--color=never', ...argv], {
    cwd: repo,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home },
  });
  return { status: ran.status, said: `${ran.stdout}${ran.stderr}` };
}

/** The id a birth printed. */
function idOf(born: { status: number | null; said: string }): string {
  expect(born.status, born.said).toBe(0);
  const id = /\(([0-9a-f]{8}-[0-9a-f-]{27})\)/.exec(born.said)?.[1];
  expect(id, born.said).toBeDefined();
  return id as string;
}

/** Every file under the sandbox, with its digest. */
function everything(): string {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path);
      else found.push(`${path} ${createHash('sha256').update(readFileSync(path)).digest('hex')}`);
    }
  };
  walk(sandbox);
  return found.join('\n');
}

/** Runs a line that must be refused with this sentence, and asserts it left everything as it was. */
function refused(argv: readonly string[], sentence: string): void {
  const was = everything();
  const { status, said } = mnema(...argv);
  expect(said).toContain(sentence);
  expect(status).toBe(1);
  expect(everything()).toBe(was);
}

const TURNED_DOWN_AT_BIRTH =
  'takes no --alternatives: what a decision turned down is recorded with the decision itself — ' +
  'pass it to `mnema decision` with the title and the rationale.';

describe('the decision group’s --alternatives', () => {
  it('is refused on a move, written after it or before it', () => {
    refused(
      ['decision', 'move', 'accept', decision, '--note', 'ok', '--alternatives', 'a spreadsheet'],
      `\`decision move\` ${TURNED_DOWN_AT_BIRTH}`,
    );
    refused(
      ['decision', '--alternatives', 'a spreadsheet', 'move', 'accept', decision, '--note', 'ok'],
      `\`decision move\` ${TURNED_DOWN_AT_BIRTH}`,
    );
  });

  it('is refused on a supersede', () => {
    refused(
      ['decision', 'supersede', decision, successor, '--reason', 'stated', '--alternatives', 'x'],
      `\`decision supersede\` ${TURNED_DOWN_AT_BIRTH}`,
    );
  });

  it('is refused on an import, planned or written', () => {
    const sentence =
      '`decision import` takes no --alternatives: what each proposal turned down is read from ' +
      'its own file, from a section such as `## Considered Options`.';
    refused(['decision', 'import', 'docs/adr', '--alternatives', 'x'], sentence);
    refused(['decision', 'import', 'docs/adr', '--write', '--alternatives', 'x'], sentence);
  });
});

describe('the skill group’s --body', () => {
  it('is refused on a move', () => {
    refused(
      ['skill', 'move', 'review', skill, '--note', 'ok', '--body', 'something else'],
      '`skill move` takes no --body: a skill’s body is recorded when it is proposed, and a move ' +
        'changes only its state.',
    );
  });
});

describe('the completion the binary writes', () => {
  it('offers none of them where they are refused, and the group’s --which where it is read', () => {
    const { status, said } = mnema('completion', 'bash');
    expect(status).toBe(0);
    // The flags' own table: the one before it keys the subcommands by the same paths.
    const table = said.slice(said.indexOf('_mnema_flags()'), said.indexOf('_mnema_values()'));
    expect(table.length).toBeGreaterThan(0);
    /** The flags the script offers after one path, as its `case` arm writes them. */
    const offered = (path: string): string[] =>
      new RegExp(`'${path}'\\) echo '([^']*)'`).exec(table)?.[1]?.split(' ') ?? [];
    for (const [path, refused] of [
      ['decision move', ['--alternatives', '--scope']],
      ['decision supersede', ['--alternatives', '--scope']],
      ['decision import', ['--alternatives']],
      ['skill move', ['--body', '--scope']],
      ['witness stamp', ['--json']],
      ['witness upgrade', ['--json']],
    ] as const) {
      const words = offered(path);
      expect(words.length, path).toBeGreaterThan(0);
      for (const flag of refused) expect(words, `${path} ${flag}`).not.toContain(flag);
    }
    expect(offered('decision move')).toContain('--which');
    expect(offered('witness stamp')).toContain('--global');
    // The group itself still offers its own, which is where each of them is read.
    expect(offered('decision')).toContain('--alternatives');
    expect(offered('witness')).toContain('--json');
  });
});

describe('the same lines without the flag', () => {
  it('go through, so the flag was the whole reason', () => {
    // Last, because they write: the refusals above ran over the record these leave behind.
    for (const argv of [
      ['decision', 'import', 'docs/adr', '--write'],
      ['skill', 'move', 'review', skill, '--note', 'ok'],
      ['decision', 'move', 'accept', decision, '--note', 'ok'],
      ['decision', 'supersede', decision, successor, '--reason', 'stated'],
    ]) {
      const { status, said } = mnema(...argv);
      expect(status, `${argv.join(' ')}: ${said}`).toBe(0);
    }
  });
});
