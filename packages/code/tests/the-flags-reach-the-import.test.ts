/**
 * THE FLAGS REACH THE IMPORT — `decision import`'s own `--which` and `--scope`, on the binary.
 *
 * WHAT WAS WRONG. `decision import` declares both flags and its `--help` lists them, and the
 * group above it declares the same two. commander hands a group every flag it knows wherever the
 * flag is written, so `mnema decision import docs/adr --which ci` gave `--which` to `decision`,
 * and the import's check for a flag written before the verb — which asked whether the GROUP held a
 * value — refused it. It refused the documented spelling for both flags, every time, and no test
 * ran that spelling: the only one pinned was the refusal (`cli.golden.test.ts`).
 *
 * WHAT IS ASSERTED. Written after `import` — after the directory, between `import` and the
 * directory, and as `--flag=value` — each flag reaches what the import writes. The agent is on
 * every fact it appends, read back through `mnema export`, the product's own feed of who executed
 * what; the tree is the one those facts land in, read from the same feed. Written before
 * `import`, each is still refused by name, and the record is left byte for byte as it was.
 *
 * AND ONE TREE IS NOT OFFERED. Reaching the import, `--scope` could name the machine-global tree,
 * and a proposal written there hands its project-relative path to every project on the machine:
 * one project's import made another's different file at the same path read as "already in the
 * record, unchanged". So `global` is refused by name, planned or written, before a file is read,
 * and neither the project's record nor anything under the HOME moves.
 *
 * WHAT IS NOT: where a flag was written is decided by `wiring/written-before.ts`, and the
 * spellings that decision has to survive (a value that is a subcommand's name, a flag the group
 * alone declares, the program's own flags in between) are cases in `a-flag-declared-twice.test.ts`,
 * which drives the real program without a process per line.
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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/** The built binary — what a person runs. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;
let repo: string;
let home: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-the-flags-reach-the-import-'));
  repo = join(sandbox, 'repo');
  home = join(sandbox, 'home');
  mkdirSync(join(repo, 'docs', 'adr'), { recursive: true });
  mkdirSync(home, { recursive: true });
  const init = mnema('init');
  expect(init.status, init.stderr).toBe(0);
  for (const [file, title] of [
    ['0001-use-a-queue.md', 'Use a queue'],
    ['0002-use-a-cache.md', 'Use a cache'],
  ] as const) {
    writeFileSync(
      join(repo, 'docs', 'adr', file),
      `# ${title}\n\n## Status\n\nAccepted\n\n## Context\n\nWhy ${title.toLowerCase()}.\n`,
    );
  }
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** `mnema <argv>` in the project, with a HOME of its own. */
function mnema(...argv: string[]): { status: number | null; stdout: string; stderr: string } {
  const ran = spawnSync(process.execPath, [CLI, '--color=never', ...argv], {
    cwd: repo,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

/** The ids an import printed it recorded, one per `ADR-<n> (<id>)` line. */
function recordedIds(stdout: string): string[] {
  return [...stdout.matchAll(/ADR-\d+ \(([0-9a-f-]{36})\)/g)].map((found) => found[1] as string);
}

/** One line of the feed, as far as this file reads it. */
interface FeedLine {
  readonly event: string;
  readonly tree: string;
  readonly about: string;
  readonly agent: string | undefined;
}

/** `mnema export`, parsed: every fact in the public and private trees, with who executed it. */
function feed(...narrowing: string[]): FeedLine[] {
  const exported = mnema('export', ...narrowing);
  expect(exported.status, exported.stderr).toBe(0);
  return exported.stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const parsed = JSON.parse(line) as {
        metadata: { event_code: string; log_name: string };
        entity: { uid: string };
        actor: { app_name?: string };
      };
      return {
        event: parsed.metadata.event_code,
        tree: parsed.metadata.log_name,
        about: parsed.entity.uid,
        agent: parsed.actor.app_name,
      };
    });
}

/** The facts the import appended about the decisions it recorded. */
function aboutThese(ids: readonly string[]): FeedLine[] {
  return feed().filter((line) => ids.includes(line.about));
}

/**
 * Every directory and file the binary could have written — the project's `.mnema/`, and the
 * whole HOME it runs with, where this machine's global tree and its key live — each file with
 * its digest.
 */
function onDisk(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const shown = path.slice(sandbox.length + 1);
      if (statSync(path).isDirectory()) {
        out.push(`D ${shown}`);
        walk(path);
      } else {
        out.push(`F ${createHash('sha256').update(readFileSync(path)).digest('hex')} ${shown}`);
      }
    }
  };
  walk(join(repo, '.mnema'));
  walk(home);
  return out;
}

describe('written after `import`', () => {
  it('--which is the agent on every fact the import appends', () => {
    const imported = mnema('decision', 'import', 'docs/adr', '--write', '--which', 'ci-importer');
    expect(imported.status, imported.stderr).toBe(0);
    const ids = recordedIds(imported.stdout);
    expect(ids).toHaveLength(2);
    // Three facts per decision — the birth, its move into `proposed`, and the link to the file
    // it was read from — and not one of them without the agent.
    const facts = aboutThese(ids);
    expect(facts).toHaveLength(6);
    expect(facts.map((fact) => fact.agent)).toEqual(Array(6).fill('ci-importer'));
    // And the product's own filter by executor answers with exactly those.
    expect(feed('--which', 'ci-importer')).toEqual(facts);
  });

  it('--scope is the tree those facts land in', () => {
    const imported = mnema('decision', 'import', 'docs/adr', '--write', '--scope', 'private');
    expect(imported.status, imported.stderr).toBe(0);
    expect(imported.stdout).toContain('in the private tree');
    const facts = aboutThese(recordedIds(imported.stdout));
    expect(facts).toHaveLength(6);
    expect(new Set(facts.map((fact) => fact.tree))).toEqual(new Set(['private']));
    // Without an agent named, the record says a person acted — the flag's absence, unchanged.
    expect(facts.map((fact) => fact.agent)).toEqual(Array(6).fill(undefined));
  });

  it('both, between `import` and the directory, spelled --flag=value', () => {
    const imported = mnema(
      'decision',
      'import',
      '--which=ci-importer',
      '--scope=private',
      'docs/adr',
      '--write',
    );
    expect(imported.status, imported.stderr).toBe(0);
    const facts = aboutThese(recordedIds(imported.stdout));
    expect(facts).toHaveLength(6);
    expect(facts.map((fact) => [fact.tree, fact.agent])).toEqual(
      Array(6).fill(['private', 'ci-importer']),
    );
  });

  it('without --write they change nothing: the plan is printed and nothing is recorded', () => {
    const before = onDisk();
    const planned = mnema(
      'decision',
      'import',
      'docs/adr',
      '--which',
      'ci-importer',
      '--scope',
      'private',
    );
    expect(planned.status, planned.stderr).toBe(0);
    expect(planned.stdout).toContain('Nothing was written.');
    expect(onDisk()).toEqual(before);
  });
});

describe('written before `import`', () => {
  // [the line, the flag the refusal names]. The third writes an agent literally called
  // "import", so the word after the flag is its value and not the verb; the fourth writes the
  // flag in both places, which is a flag written before the verb all the same; the last writes
  // both flags before it, and the refusal names the first the import declares.
  const LINES: readonly (readonly [readonly string[], string])[] = [
    [['decision', '--which', 'ci-importer', 'import', 'docs/adr', '--write'], '--which'],
    [['decision', '--scope', 'private', 'import', 'docs/adr', '--write'], '--scope'],
    [['decision', '--which', 'import', 'import', 'docs/adr', '--write'], '--which'],
    [['decision', '--which', 'one', 'import', 'docs/adr', '--write', '--which', 'two'], '--which'],
    [
      ['decision', '--which', 'ci-importer', '--scope', 'private', 'import', 'docs/adr', '--write'],
      '--scope',
    ],
  ];

  for (const [line, flag] of LINES) {
    it(`${line.join(' ')} — refused, naming ${flag}, and nothing is written`, () => {
      const before = onDisk();
      const refused = mnema(...line);
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain(
        `\`decision import\` takes its own ${flag}: put it after \`import\`, not before.`,
      );
      expect(refused.stdout).toBe('');
      expect(onDisk()).toEqual(before);
    });
  }
});

describe('the machine-global tree', () => {
  it('is refused by name, planned or written, and nothing is written anywhere', () => {
    // A proposal records a path inside this project, and every project reads the global tree:
    // written there, one project's import made another's different file at the same path read
    // as already imported. Refused before a file is read, so the digest covers the HOME too.
    const before = onDisk();
    for (const line of [
      ['decision', 'import', 'docs/adr', '--scope', 'global'],
      ['decision', 'import', 'docs/adr', '--write', '--scope=global', '--which', 'ci-importer'],
    ]) {
      const refused = mnema(...line);
      expect(refused.status, line.join(' ')).toBe(1);
      expect(refused.stderr).toContain('`decision import` does not write to the global tree:');
      expect(refused.stderr).toContain('Leave --scope out, or use --scope private.');
      expect(refused.stdout).toBe('');
    }
    expect(onDisk()).toEqual(before);
  });
});
