// Probe. Copy to packages/code/tests/zz-probe.test.ts and run from the repo root:
//   PROBE_N=15 PROBE_OUT=<tsv> PROBE_LABEL=<label> npx vitest run packages/code/tests/zz-probe.test.ts
// One frame-by-frame reading of a resize: heights, widths, and the page after each frame against the settled one.
import { appendFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeTemporary } from '../../../measurements/lib/remove-inside.mjs';
import { afterAll, beforeAll, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { aFrameSince, inPty, type Fixture, leavesTheSession, opensAConsole, rowsOfTheFrames } from './support/pty.js';
import { drewAt, screenOf } from './support/screen.js';
import { widthOfText } from '../src/presentation/width.js';
import { A_FRAME_BEGINS, FRAME_IS_DRAWN } from './support/pty.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const OUT = process.env.PROBE_OUT as string;
const LABEL = process.env.PROBE_LABEL ?? 'x';
let sandbox: string; let project: string; let environment: NodeJS.ProcessEnv;
beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-probe-'));
  project = join(sandbox, 'project'); mkdirSync(project, { recursive: true });
  process.env.HOME = join(sandbox, 'home'); process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN; process.chdir(project);
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  await run(['init'], io);
  environment = { ...process.env, HOME: join(sandbox, 'home'), XDG_DATA_HOME: join(sandbox, 'data'), TERM: 'xterm-256color' };
  delete environment.MNEMA_RUN;
}, 240_000);
afterAll(() => removeTemporary(sandbox));
const fixture = (): Fixture => ({ cli: CLI, verb: REPL_VERB, project, scratch: sandbox, environment });
const cases = [
  { name: 'shrink-both 120x55->80x42', from: [120, 55], to: [80, 42] },
  { name: 'shrink-width 120x55->80x55', from: [120, 55], to: [80, 55] },
  { name: 'shrink-height 120x55->120x42', from: [120, 55], to: [120, 42] },
  { name: 'grow 80x42->120x55', from: [80, 42], to: [120, 55] },
];
const N = Number(process.env.PROBE_N ?? 1);
for (const c of cases) for (let rep = 0; rep < N; rep++) {
  it(`${c.name} #${rep}`, async () => {
    const ran = await inPty(fixture(), {
      columns: c.from[0] as number, rows: c.from[1] as number,
      steps: [
        opensAConsole('mnema>'),
        { types: 'saying-0\r', until: aFrameSince('mnema>'), what: 'said' },
        { resize: { columns: c.to[0] as number, rows: c.to[1] as number }, until: drewAt(c.to[0] as number), what: 'resized' },
        leavesTheSession,
      ],
    });
    const after = ran.bytes.slice(ran.at[1] as number, ran.at[2] as number);
    const frames = rowsOfTheFrames(after);
    const widths: number[] = [];
    for (const chunk of after.split(FRAME_IS_DRAWN).slice(0, -1)) {
      const b = chunk.lastIndexOf(A_FRAME_BEGINS);
      if (b < 0) continue;
      widths.push(Math.max(...chunk.slice(b).split('\n').map((l) => widthOfText(l.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '')))));
    }
    if (process.env.PROBE_DUMP) {
      let n = 0;
      for (const chunk of after.split(FRAME_IS_DRAWN).slice(0, -1)) {
        const b = chunk.lastIndexOf(A_FRAME_BEGINS);
        if (b < 0) continue;
        appendFileSync(`${process.env.PROBE_DUMP}.${c.name.split(' ')[0]}.${n++}.txt`, chunk.slice(b));
      }
    }
    // the page after each frame of the resize, replayed at the NEW size, against the settled one
    const base = ran.at[1] as number;
    const ends: number[] = [];
    { let off = base; for (const chunk of after.split(FRAME_IS_DRAWN).slice(0, -1)) { off += chunk.length + FRAME_IS_DRAWN.length; if (chunk.lastIndexOf(A_FRAME_BEGINS) >= 0) ends.push(off); } }
    const pages = ends.map((e) => screenOf(ran.bytes.slice(0, e), c.to[0] as number, c.to[1] as number).rows);
    const last = pages[pages.length - 1] ?? [];
    const diffs = pages.map((pg) => pg.filter((row, i) => row !== last[i]).length);
    if (process.env.PROBE_ROWS) { pages.forEach((pg, k) => pg.forEach((row, i) => { if (row !== last[i]) appendFileSync(process.env.PROBE_ROWS as string, `${c.name} frame${k} row${i}: [${row.trimEnd()}] vs final [${(last[i] ?? '').trimEnd()}]\n`); })); }
    const wide = widths.filter((w) => w > (c.to[0] as number)).length;
    const over = frames.filter((r) => r > (c.to[1] as number)).length;
    appendFileSync(OUT, `${LABEL}\t${rep}\t${(await import('node:fs')).readFileSync('/proc/loadavg','utf8').split(' ')[0]}\t${c.name}\tframes=${frames.length}\tmax=${Math.max(...frames)}\tscreen=${c.to[1]}\ttaller=${over}\theights=${frames.join(',')}\twidths=${widths.join(',')}\twider=${wide}\tdiffvsfinal=${diffs.join(',')}\n`);
  }, 240_000);
}
