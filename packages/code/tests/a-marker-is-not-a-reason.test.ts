/**
 * A MARKER THE PRODUCT PRINTS WHERE A REASON GOES IS REFUSED AS ONE — every marker, read off the
 * product's own sources and pages rather than off a list.
 *
 * WHAT WAS WRONG. The refusal of a key the record proves in two identities hands a person
 * `mnema key revoke <fingerprint> --reason "<why>"`, and the import's plan hands them `mnema
 * decision move accept <id> --note "<why>"`. Pasted without the marker filled in, `<why>` was
 * recorded as the reason, permanently. `<why>` has letters, so "does it state something" could
 * not see it.
 *
 * WHAT IS CHECKED. Every marker the product writes as the value of a reason flag — in a string of
 * its source, a help text, or a page it publishes — is collected here by the flag it follows, and
 * each one is typed at the binary's door as the reason of a move that requires one. Each must be
 * refused `NOT_A_REASON`, and the move must not land. The door knows markers by their SHAPE
 * (`<` a lowercase word `>`, `a-reason-states-something.ts`), so a marker a page prints tomorrow
 * is refused without being added anywhere; this is what shows that the shape covers what is
 * printed today, and it goes red on a marker of another shape.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { ROOT } from './support/published-examples.js';

/** The flags whose value is the why of a fact, as the product spells them on a command line. */
const REASON_FLAGS = ['--reason', '--note', '--feedback', '--alternatives'] as const;

/** A marker written as the value of a reason flag: `--reason "<why>"`, `--note <text>`. */
const WRITTEN = new RegExp(`(?:${REASON_FLAGS.join('|')})[ =]+["']?(<[^<>\\n"']+>)`, 'g');

/** Every tracked file that is product source or a page — tests are the reading, not the read. */
function theProductsText(): readonly string[] {
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf-8' }).split('\n');
  return tracked.filter(
    (path) =>
      (path.endsWith('.md') || /^packages\/[^/]+\/src\/.*\.ts$/.test(path)) &&
      !path.endsWith('.test.ts') &&
      !path.startsWith('measurements/'),
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

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-a-marker-'));
  mkdirSync(join(sandbox, 'home'));
  mkdirSync(join(sandbox, 'project'));
  process.env.HOME = join(sandbox, 'home');
  delete process.env.MNEMA_RUN;
  process.chdir(join(sandbox, 'project'));
  expect((await mnema('init')).failed).toBe(false);
  const made = await mnema('task', 'create', 'a task to cancel');
  task = /\(([0-9a-f-]{36})\)/.exec(made.said)?.[1] ?? '';
  expect(task).not.toBe('');
}, 60_000);

afterAll(() => {
  process.chdir(before.cwd);
  process.env.HOME = before.home;
  if (before.run !== undefined) process.env.MNEMA_RUN = before.run;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('a marker the product prints where a reason goes', () => {
  it('is found in the product’s own text, the one the finding was about among them', () => {
    const printed = markersPrinted();
    // NON-VACUITY: the marker of the finding, and the one every `--help` prints for the flag.
    expect([...printed.keys()]).toContain('<why>');
    expect([...printed.keys()]).toContain('<text>');
  });

  it('is refused as the reason of a move that requires one, and the move does not land', async () => {
    for (const [marker, where] of markersPrinted()) {
      const said = await mnema('task', 'move', 'cancel', task, '--reason', marker);
      expect(said.failed, `${marker} (printed in ${where})`).toBe(true);
      expect(said.said, `${marker} (printed in ${where})`).toContain('Refused (NOT_A_REASON)');
    }
    // The task is still where it was born: nothing above moved it.
    const next = await mnema('next-actions', task);
    expect(next.said).toContain('cancel');
  }, 60_000);

  it('and the same move lands with a reason in words, so the refusal was about the marker', async () => {
    const said = await mnema('task', 'move', 'cancel', task, '--reason', 'nobody needs it now');
    expect(said.failed).toBe(false);
  });
});
