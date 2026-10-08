/**
 * THE MARGINS ARE THE SAME WIDTH — what the console leaves empty to the left of what it says is
 * what it leaves empty to the right, at every width between the shortest window it draws on and
 * a very wide one.
 *
 * WHY IT IS ITS OWN CASE. The left margin was six columns because a purple guide ran down it.
 * The guide went (`src/repl/inset.ts`), and the six columns stayed for a release as a space with
 * nothing in it, wider than the one on the right. A case that read the constant would agree with
 * itself at any value, so both margins are READ OFF THE PAGE, on a pseudo-terminal, from a row
 * the session itself folded:
 *
 *   - the LEFT margin is the column the sent command's mark begins at;
 *   - the RIGHT margin is what is left of the width after the widest row of the roll — a command
 *     that is one word wider than any page, so the fold has to break it and every row but the
 *     last runs as far as the page allows.
 *
 * The two are asserted EQUAL, and not each against a number: the property is that the page is
 * level, not that it is a particular width. Mutation: put the old six back on the left only
 * (`THE_INSET = 6`) and this goes red at every width.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/program.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import {
  aFrameSince,
  inPty as drive,
  type Fixture,
  leavesTheSession,
  opensAConsole,
  type Step,
} from './support/pty.js';
import { theSettledScreen } from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';

/** The mark a command that was SENT carries on the roll. */
const SENT = '❯';

/** The dot an answer opens with. */
const ANSWERED = '●';

/** The widths asked: the shortest the console draws on, ones in between, and a wide one. */
const THE_WIDTHS = [80, 97, 120, 163, 200] as const;

/** A read the session runs, and a word wider than any of the pages above, which the fold must break. */
const A_VERB = 'search';
const ONE_LONG_WORD = 'x'.repeat(450);

const quiet: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };

let sandbox: string;
let project: string;
let environment: NodeJS.ProcessEnv;
const before = { cwd: process.cwd(), env: { ...process.env } };

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-margins-'));
  project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  process.chdir(project);
  await run(['init'], quiet);
  environment = {
    ...process.env,
    HOME: join(sandbox, 'home'),
    XDG_DATA_HOME: join(sandbox, 'data'),
    TERM: 'xterm-256color',
  };
  delete environment.MNEMA_RUN;
}, 180_000);

afterAll(() => {
  process.chdir(before.cwd);
  process.env = before.env;
  rmSync(sandbox, { recursive: true, force: true });
});

/** The first column a row has something in, counted in characters. */
function beginsAt(row: string): number {
  return [...row].findIndex((glyph) => glyph !== ' ');
}

describe('the console leaves as much empty to the left as to the right', () => {
  for (const columns of THE_WIDTHS) {
    it(`at ${columns} columns`, async () => {
      const rows = 42;
      const fixture: Fixture = {
        cli: CLI,
        verb: REPL_VERB,
        project,
        scratch: sandbox,
        environment,
      };
      const asks: Step = {
        types: `${A_VERB} ${ONE_LONG_WORD}\r`,
        until: aFrameSince(PROMPT),
        what: 'asked a command wider than the page',
      };
      const ran = await drive(fixture, {
        columns,
        rows,
        steps: [opensAConsole(PROMPT), asks, leavesTheSession],
      });
      const screen = theSettledScreen(ran.bytes, columns, rows, ONE_LONG_WORD.slice(0, 20));
      const sent = screen.rows.findIndex((row) => row.includes(SENT));
      expect(sent, `no command was sent:\n${screen.text}`).toBeGreaterThanOrEqual(0);
      const left = beginsAt(screen.rows[sent] as string);
      // THE ROWS THE PRODUCT'S OWN FOLD BROKE THE COMMAND INTO: the echo of the sent line, from its
      // mark down to the row the answer opens on. NOT the answer's rows: the answer repeats the
      // word and the layout library breaks it at the full width of the terminal, which would make
      // the right margin none whatever the fold did. The widest echo row is what the page allows.
      const answered = screen.rows.findIndex((row, at) => at > sent && row.includes(ANSWERED));
      expect(answered, `the answer did not open:\n${screen.text}`).toBeGreaterThan(sent);
      const ofTheWord = screen.rows.slice(sent, answered).filter((row) => /x{10,}/.test(row));
      expect(
        ofTheWord.length,
        `the word was not broken across rows:\n${screen.text}`,
      ).toBeGreaterThan(1);
      const widest = Math.max(...ofTheWord.map((row) => [...row.trimEnd()].length));
      const right = columns - widest;
      expect(left, `${columns} columns: the left margin`).toBe(right);
    }, 240_000);
  }
});
