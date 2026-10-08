/**
 * `mnema diagram` — the record as mermaid text — and what holds it to the record.
 *
 * Four properties, each with the case that would turn it red:
 *
 *   1. THE STATE MACHINES ARE THE TABLES. Each diagram is compared with the rows of the table the
 *      gate enforces, written out here by an independent walk, and the count is asserted so an
 *      empty table cannot pass for an empty diagram.
 *   2. NOTHING FROM THE RECORD CAN WRITE SYNTAX. The values a diagram holds came out of the record
 *      (an id, a relation, a proof's words); a hostile one is written and the whole output is held
 *      to a grammar of its own — every line is one of four shapes and every label holds only the
 *      plain set and `#<code>;` entities. That checks the OUTPUT, so it does not share a mistake
 *      with the escape that produced it.
 *   3. THE FRONT PAGE DRAWS THIS OUTPUT. The page's diagram block is compared, line for line, with
 *      what `mnema diagram decision` prints (`the-front-page-says-what-its-sources-say.test.ts`
 *      keeps the older tie to `DECISION_TRANSITIONS`, and still holds).
 *   4. IT WRITES NOTHING: the verb is declared a read (`every-verb-says-if-it-writes.test.ts`).
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECISION_TRANSITIONS, SKILL_TRANSITIONS, TRANSITIONS } from '@mnema/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { quoted } from '../src/presentation/diagram.js';
import { run } from '../src/program.js';

const LF = String.fromCharCode(10);
const ESC = String.fromCharCode(27);

/** Everything one invocation wrote, by stream, and whether it failed. */
async function invoke(
  ...argv: string[]
): Promise<{ out: string[]; err: string[]; failed: boolean }> {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  await run(['--color=never', ...argv], {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
  });
  return { out: out.join(LF).split(LF), err, failed };
}

/** What a diagram label may hold: the plain set, and mermaid's numeric entity for all the rest. */
const LABEL = String.raw`(?:[\p{L}\p{M}\p{N} ._:/·,()-]|#\d+;)*`;
/** Every line a diagram of this verb may have — nothing else is syntax the verb wrote. */
const GRAMMAR = [
  /^(?:stateDiagram-v2|flowchart (?:TD|LR))$/u,
  /^ {4}direction LR$/u,
  new RegExp(String.raw`^ {4}(?:\[\*\]|[A-Z_a-z]+) --> [A-Z_a-z]+: ${LABEL}$`, 'u'),
  new RegExp(String.raw`^ {4}n\d+(?:\(\["${LABEL}"\]\)|\["${LABEL}"\])$`, 'u'),
  new RegExp(String.raw`^ {4}n\d+ -->(?:\|"${LABEL}"\|)? n\d+$`, 'u'),
];
const outsideTheGrammar = (lines: readonly string[]): string[] =>
  lines.filter((line) => !GRAMMAR.some((shape) => shape.test(line)));

/** The same rows, walked here and not in the module. */
function theTable(
  rows: readonly { from: string; action: string; to: string; requires: readonly string[] }[],
) {
  const owed: Record<string, string> = { note: 'a note', reason: 'a reason', feedback: 'feedback' };
  return rows.map(
    (row) =>
      `    ${row.from} --> ${row.to}: ${[row.action, ...row.requires.map((p) => owed[p] ?? p)].join(' · ')}`,
  );
}

describe('the state machines mnema diagram draws', () => {
  it.each([
    ['decision', DECISION_TRANSITIONS, 4],
    ['skill', SKILL_TRANSITIONS, 5],
    ['task', TRANSITIONS, 12],
  ] as const)(
    'are the %s table, a row for each move it owes proof for',
    async (workflow, table, rows) => {
      const drawn = await invoke('diagram', workflow);
      expect(drawn.failed).toBe(false);
      const [header, direction, birth, ...moves] = drawn.out;
      expect([header, direction]).toEqual(['stateDiagram-v2', '    direction LR']);
      expect(birth).toMatch(/^ {4}\[\*\] --> \S+: /u);
      expect(moves).toEqual(theTable(table));
      // NON-VACUITY: the tables are read, and they are not empty.
      expect(table).toHaveLength(rows);
      expect(outsideTheGrammar(drawn.out)).toEqual([]);
    },
  );

  it('needs no project, and refuses a subject it cannot draw and an id it does not take', async () => {
    expect((await invoke('diagram', 'bogus')).failed).toBe(true);
    expect((await invoke('diagram', 'decision', 'ADR-1')).failed).toBe(true);
    expect((await invoke('diagram', 'timeline')).failed).toBe(true);
  });
});

describe('what the record puts in a diagram', () => {
  /** A quote, brackets, a pipe, a statement end, a comment, markup, a newline and an escape sequence. */
  const HOSTILE = `evil"] --> x["pwned${LF}${ESC}[31m;%% [*] --> a${LF}subgraph z|<b>x</b>`;

  it('is collapsed to one line, stripped of control characters, and cannot write a mark of syntax', () => {
    const safe = quoted(HOSTILE).slice(1, -1);
    // Beside the entities, which end in a `;` of their own.
    expect(safe.replace(/#\d+;/gu, '')).not.toMatch(/["[\]|;<>%*]/u);
    expect(safe).not.toContain(LF);
    expect(safe).not.toContain(ESC);
    // The words survive; only the marks are written as entities.
    expect(safe).toContain('pwned');
    expect(safe).toContain('#34;');
  });

  let sandbox: string;
  const cwdBefore = process.cwd();
  const envBefore = { ...process.env };
  let task = '';

  beforeAll(async () => {
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-picture-'));
    mkdirSync(join(sandbox, 'project'), { recursive: true });
    mkdirSync(join(sandbox, 'home'), { recursive: true });
    process.env.HOME = join(sandbox, 'home');
    process.env.XDG_DATA_HOME = join(sandbox, 'data');
    delete process.env.MNEMA_RUN;
    process.chdir(join(sandbox, 'project'));
    await invoke('init');
    task =
      /\(([0-9a-f-]{36})\)/u.exec((await invoke('task', 'create', 'a task')).out.join(LF))?.[1] ??
      '';
    expect(task).toMatch(/^[0-9a-f-]{36}$/u);
    // The proof of a move, and a relation and a far end the record takes verbatim.
    await invoke('task', 'move', 'cancel', task, '--reason', HOSTILE);
    await invoke('link', task, HOSTILE, '--rel', HOSTILE);
  }, 60_000);

  afterAll(() => {
    process.chdir(cwdBefore);
    process.env = envBefore;
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('reaches the timeline as plain words and entities, one node to an event', async () => {
    const drawn = await invoke('diagram', 'timeline', task);
    expect(outsideTheGrammar(drawn.out)).toEqual([]);
    const nodes = drawn.out.filter((line) => /^ {4}n\d+\[/u.test(line));
    // NON-VACUITY: created, and the move whose proof is the hostile text.
    expect(nodes.length).toBeGreaterThanOrEqual(2);
    expect(drawn.out.join(LF)).toContain('pwned');
    expect(drawn.out.join(LF)).not.toContain(ESC);
  });

  it('reaches the connections as plain words and entities, one node to an entity', async () => {
    const drawn = await invoke('diagram', 'refs', task);
    expect(outsideTheGrammar(drawn.out)).toEqual([]);
    expect(drawn.out.filter((line) => line.includes('-->|'))).toHaveLength(1);
    expect(drawn.out.join(LF)).toContain('pwned');
  });
});

describe('the page that explains how it works', () => {
  it('draws what `mnema diagram decision` prints', async () => {
    const page = readFileSync(
      fileURLToPath(new URL('../../../docs/how-it-works.md', import.meta.url)),
      'utf8',
    ).split(LF);
    const start = page.indexOf('stateDiagram-v2');
    expect(start).toBeGreaterThan(0);
    const end = page.indexOf('```', start);
    expect(page.slice(start, end)).toEqual((await invoke('diagram', 'decision')).out);
  });
});
