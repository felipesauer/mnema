/**
 * A MARKER THE PRODUCT PRINTS WHERE A TITLE GOES IS REFUSED AS ONE — at the door of every write
 * that names a record, and in a decision file the import reads.
 *
 * WHAT WAS WRONG. The product prints `mnema decision record <title> <rationale>`, `mnema skill
 * create "<name>" --body "<text>"` and `--topic "<t>"`. Pasted without the marker filled in, the
 * marker was recorded as the name of a decision, a skill or an observation, permanently: the rule
 * that refuses `<why>` as a reason was asked of the why alone. And a decision file left as a
 * template — `# <title>`, or `<why>` under its context — was read as a decision by the import.
 *
 * WHAT IS CHECKED. Every marker the product writes after a command that creates, or after
 * `--topic`, is collected from its sources and pages, and each is typed at the binary's door as
 * the title of every write that takes one. Each must be refused `NOT_A_TITLE`, and nothing may
 * land. Then three decision files left unfilled, one field each, are imported with `--write`:
 * each is named with the sentence for its field, and nothing is recorded.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { ROOT } from './support/published-examples.js';

/** A marker written where a title goes: `task create "<title>"`, `--topic "<t>"`. */
const WRITTEN = /(?:task create|decision record|skill create|--topic)[ =]+["']?(<[^<>\n"']+>)/g;

/** Every tracked file that is product source or a page — tests are the reading, not the read. */
function theProductsText(): readonly string[] {
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf-8' }).split('\n');
  return tracked.filter(
    (path) =>
      (path.endsWith('.md') || /^packages\/[^/]+\/src\/.*\.ts$/.test(path)) &&
      !path.endsWith('.test.ts'),
  );
}

/** The markers, each with one place it is printed. */
function markersPrinted(): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const path of theProductsText()) {
    const text = readFileSync(join(ROOT, path), 'utf-8');
    for (const match of text.matchAll(WRITTEN)) {
      const marker = match[1] as string;
      if (!found.has(marker)) found.set(marker, path);
    }
  }
  return found;
}

let sandbox: string;
let project: string;
let task = '';
const before = { cwd: process.cwd(), home: process.env.HOME, run: process.env.MNEMA_RUN };

async function mnema(...argv: string[]): Promise<{ said: string; failed: boolean }> {
  const lines: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => lines.push(line),
    err: (line) => lines.push(line),
    fail: () => {
      failed = true;
    },
  };
  await run(['--color=never', ...argv], io);
  return { said: lines.join('\n'), failed };
}

/** How many events the project's tails hold, read off the disk. */
function events(): number {
  const tails = join(project, '.mnema', 'tails');
  return readdirSync(tails).reduce(
    (sum, tail) =>
      sum +
      readdirSync(join(tails, tail))
        .filter((file) => file.endsWith('.jsonl') && file !== 'checkpoints.jsonl')
        .reduce(
          (lines, file) =>
            lines +
            readFileSync(join(tails, tail, file), 'utf-8')
              .split('\n')
              .filter(Boolean).length,
          0,
        ),
    0,
  );
}

/** The writes that take a title, each with the marker put where the title goes. */
function titled(marker: string): readonly (readonly string[])[] {
  return [
    ['task', 'create', marker],
    ['decision', 'record', marker, 'one clock'],
    ['skill', 'create', marker, '--body', 'do it so'],
    ['observe', task, '--topic', marker, '--text', 'it was slow'],
  ];
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-a-title-marker-'));
  project = join(sandbox, 'project');
  mkdirSync(join(sandbox, 'home'));
  mkdirSync(project);
  process.env.HOME = join(sandbox, 'home');
  delete process.env.MNEMA_RUN;
  process.chdir(project);
  expect((await mnema('init')).failed).toBe(false);
  const made = await mnema('task', 'create', 'a task to observe');
  task = /\(([0-9a-f-]{36})\)/.exec(made.said)?.[1] ?? '';
  expect(task).not.toBe('');
}, 60_000);

afterAll(() => {
  process.chdir(before.cwd);
  process.env.HOME = before.home;
  if (before.run !== undefined) process.env.MNEMA_RUN = before.run;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('a marker the product prints where a title goes', () => {
  it('is found in the product’s own text, one per kind of name', () => {
    const printed = markersPrinted();
    // NON-VACUITY: the marker of a title, of a skill's name, and of an observation's topic.
    expect([...printed.keys()]).toContain('<title>');
    expect([...printed.keys()]).toContain('<name>');
    expect([...printed.keys()]).toContain('<t>');
  });

  it('is refused as the title of every write that takes one, and nothing lands', async () => {
    const born = events();
    expect(born).toBeGreaterThan(0);
    for (const [marker, where] of markersPrinted()) {
      for (const argv of titled(marker)) {
        const said = await mnema(...argv);
        const label = `${argv.slice(0, 2).join(' ')} ${marker} (printed in ${where})`;
        expect(said.failed, label).toBe(true);
        expect(said.said, label).toContain('Refused (NOT_A_TITLE)');
        expect(said.said, label).toContain(`"${marker}" is the marker a recipe prints`);
      }
    }
    // Nothing above landed: not one event was appended by any of them.
    expect(events()).toBe(born);
  }, 60_000);

  it('and the same writes land with a title in words, so the refusal was about the marker', async () => {
    for (const argv of titled('clocks in UTC')) {
      expect((await mnema(...argv)).failed, argv.slice(0, 2).join(' ')).toBe(false);
    }
  }, 60_000);
});

describe('a decision file left where the words go', () => {
  it('produces nothing, named with the field it left unfilled, and records nothing', async () => {
    const born = events();
    const files: Readonly<Record<string, readonly [string, string]>> = {
      title: ['# <title>\n\n## Context\n\nthree services send three zones\n', 'its title is'],
      why: ['# Use UTC\n\n## Context\n\n<why>\n', 'its why is'],
      alt: [
        '# Keep one clock\n\n## Context\n\nthe logs disagree\n\n## Alternatives\n\n<alternatives>\n',
        'what it turned down is',
      ],
    };
    for (const [name, [text, sentence]] of Object.entries(files)) {
      mkdirSync(join(project, 'docs', name), { recursive: true });
      writeFileSync(join(project, 'docs', name, `${name}.md`), text);
      const said = await mnema('decision', 'import', `docs/${name}`, '--write');
      expect(said.said, name).toContain('Recorded 0 decision(s)');
      expect(said.said, name).toContain(
        `docs/${name}/${name}.md — ${sentence} only the marker a template leaves where the words go`,
      );
      expect(said.said, name).not.toContain('Stopped at');
    }
    expect(events()).toBe(born);
  }, 60_000);
});

describe('a title with no word in it', () => {
  it('is refused as the title of every write that takes one, and nothing lands', async () => {
    const born = events();
    for (const said of ['***', '* * *', '. . .']) {
      for (const argv of titled(said)) {
        const result = await mnema(...argv);
        const label = `${argv.slice(0, 2).join(' ')} ${JSON.stringify(said)}`;
        expect(result.failed, label).toBe(true);
        expect(result.said, label).toContain('Refused (NOT_A_TITLE)');
        expect(result.said, label).toContain(
          'has no letter and no digit in it, so it names nothing',
        );
      }
    }
    expect(events()).toBe(born);
  }, 60_000);
});

describe('a marker the product prints where a reference goes', () => {
  /** The writes that take a reference a later reading looks up, each with the marker put there. */
  function referenced(marker: string): readonly (readonly string[])[] {
    return [
      ['link', task, marker, '--rel', 'governs'],
      ['link', task, 'src/a.ts', '--rel', marker],
      ['link', marker, 'src/a.ts', '--rel', 'governs'],
      ['observe', marker, '--topic', 'clocks', '--text', 'it was slow'],
      ['handoff', marker, 'a', 'b'],
      ['handoff', task, marker, 'b'],
      ['handoff', task, 'a', marker],
    ];
  }

  it('is refused at every write that takes one, and nothing lands', async () => {
    const born = events();
    for (const marker of ['<id>', '<path>', '<rel>', '<agent>']) {
      for (const argv of referenced(marker)) {
        const result = await mnema(...argv);
        const label = `${argv.join(' ')}`;
        expect(result.failed, label).toBe(true);
        expect(result.said, label).toContain('Refused (NOT_A_REFERENCE)');
        expect(result.said, label).toContain(`"${marker}" is the marker a recipe prints`);
      }
    }
    expect(events()).toBe(born);
  }, 60_000);

  it('and the same writes land with a value in place, so the refusal was about the marker', async () => {
    expect((await mnema('link', task, 'src/<id>/a.ts', '--rel', 'governs')).failed).toBe(false);
    expect((await mnema('observe', task, '--topic', 'clocks', '--text', 'slow')).failed).toBe(
      false,
    );
  }, 60_000);
});
