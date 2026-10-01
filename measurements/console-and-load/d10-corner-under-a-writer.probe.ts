// D10 probe. Copy to packages/code/tests/zz-d10.test.ts and run from the repo root:
//   PROBE_OUT=<tsv> PROBE_N=12 npx vitest run packages/code/tests/zz-d10.test.ts
import { execFile } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { ENDS_THE_INPUT } from './support/console.js';
import { A_FRAME_BEGINS, FRAME_IS_DRAWN, type Fixture, inPty, opensAConsole, rowsOfTheFrames } from './support/pty.js';
import { screenOf } from './support/screen.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const OUT = process.env.PROBE_OUT as string;
const N = Number(process.env.PROBE_N ?? 12);
const COLUMNS = 120;
const ROWS = 55;
let sandbox: string;
let project: string;
let environment: NodeJS.ProcessEnv;

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-d10-'));
  project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  process.chdir(project);
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  await run(['init'], io);
  await run(['decision', 'record', 'Base', 'the record already has one fact'], io);
  environment = { ...process.env, HOME: join(sandbox, 'home'), XDG_DATA_HOME: join(sandbox, 'data'), TERM: 'xterm-256color' };
  delete environment.MNEMA_RUN;
}, 240_000);
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));
const fixture = (): Fixture => ({ cli: CLI, verb: REPL_VERB, project, scratch: sandbox, environment });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const load = () => readFileSync('/proc/loadavg', 'utf8').split(' ')[0];
const write = (title: string) =>
  new Promise<void>((resolve) =>
    execFile('node', [CLI, '--color=never', 'decision', 'record', title, 'written by another process'], { cwd: project, env: environment }, () => resolve()),
  );

for (const writers of [0, 1, 5]) {
  it(`${writers} concurrent writer(s) while a person has typed "sea"`, async () => {
    for (let rep = 0; rep < N; rep++) {
      let exited = 0;
      let firstFrame = 0;
      const ran = await inPty(fixture(), {
        columns: COLUMNS,
        rows: ROWS,
        steps: [
          opensAConsole('mnema>'),
          { types: 'sea', until: (bytes) => bytes.includes('sea'), what: 'typed sea' },
          {
            does: async () => {
              await Promise.all(Array.from({ length: writers }, (_, k) => write(`W${rep}-${k}`)));
              exited = Date.now();
            },
            until: (bytes, since) => {
              if (firstFrame === 0 && exited > 0 && bytes.slice(since).includes(A_FRAME_BEGINS)) firstFrame = Date.now();
              return exited > 0 && Date.now() - exited > 2500;
            },
            what: 'let the console see the writers',
          },
          // the row is abandoned first (Ctrl-C), then the key that ends the input
          { types: `\u0003${ENDS_THE_INPUT}`, until: () => true, what: 'left' },
        ],
      }).catch((error: Error) => ({ bytes: `ERROR ${error.message}`, at: [] as number[], code: -1 }));
      if (ran.at.length < 3) {
        appendFileSync(OUT, `${writers}\t${rep}\t${load()}\tINVALID ${ran.bytes.slice(0, 80)}\n`);
        continue;
      }
      const typedAt = ran.at[1] as number;
      const afterAt = ran.at[2] as number;
      const before = screenOf(ran.bytes.slice(0, typedAt), COLUMNS, ROWS);
      const during = ran.bytes.slice(typedAt, afterAt);
      const frames = rowsOfTheFrames(during);
      const final = screenOf(ran.bytes.slice(0, afterAt), COLUMNS, ROWS);
      const differing = final.rows
        .map((row, i) => [i, row.trimEnd(), (before.rows[i] ?? '').trimEnd()] as const)
        .filter(([, now, was]) => now !== was);
      const typed = final.rows.some((row) => row.includes('mnema> sea'));
      const roll = differing.filter(([, now]) => /W\d+-\d+|decision|recorded/.test(now)).length;
      const others = differing.filter(([, now, was]) => !/W\d+-\d+|decision|recorded/.test(now + was));
      const latency = firstFrame > 0 && exited > 0 ? firstFrame - exited : -1;
      appendFileSync(
        OUT,
        `${writers}\t${rep}\t${load()}\tframes=${frames.length}\ttaller=${frames.filter((r) => r > ROWS).length}\ttyped=${typed}\tcaret=${before.cursor.column}->${final.cursor.column}\tdiffrows=${differing.length}\tonroll=${roll}\tother=${JSON.stringify(others.map(([i, now, was]) => `${i}:[${was.trim()}]->[${now.trim()}]`))}\tlatency_ms=${latency}\n`,
      );
    }
  }, 1_800_000);
}
