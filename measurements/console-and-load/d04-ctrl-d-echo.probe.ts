// D04 probe. Copy to packages/code/tests/zz-d04.test.ts and run with vitest from the repo root:
//   PROBE_OUT=<tsv> PROBE_N=20 npx vitest run packages/code/tests/zz-d04.test.ts
// Never committed under tests/: it is an instrument, not a case.
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { ENDS_THE_INPUT } from './support/console.js';
import { type Fixture, inPty, opensAConsole } from './support/pty.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const OUT = process.env.PROBE_OUT as string;
const N = Number(process.env.PROBE_N ?? 20);
const GIVES_THE_SCREEN_BACK = '\u001b[?1049l';
let sandbox: string;
let project: string;
let environment: NodeJS.ProcessEnv;

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-d04-'));
  project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  process.chdir(project);
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  await run(['init'], io);
  environment = { ...process.env, HOME: join(sandbox, 'home'), XDG_DATA_HOME: join(sandbox, 'data'), TERM: 'xterm-256color' };
  delete environment.MNEMA_RUN;
}, 240_000);
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));
const fixture = (): Fixture => ({ cli: CLI, verb: REPL_VERB, project, scratch: sandbox, environment });
process.on('uncaughtException', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EPIPE') throw error;
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const load = () => readFileSync('/proc/loadavg', 'utf8').split(' ')[0];

// the arms: the delay in ms before a second Ctrl-D; -1 is the single Ctrl-D
for (const delay of [-1, 0, 10, 40, 120]) {
  it(`console, ${delay < 0 ? 'one Ctrl-D' : `two Ctrl-D, ${delay} ms apart`}`, async () => {
    for (let rep = 0; rep < N; rep++) {
      const ran = await inPty(fixture(), {
        columns: 100,
        rows: 50,
        steps: [
          opensAConsole('mnema>'),
          { types: ENDS_THE_INPUT, until: () => true, what: 'first Ctrl-D' },
          ...(delay < 0
            ? []
            : [{ does: () => sleep(delay), types: ENDS_THE_INPUT, until: () => true, what: 'second Ctrl-D' }]),
        ],
      }).catch((error: Error) => ({ bytes: `ERROR ${error.message}`, at: [], code: -1 }));
      const back = ran.bytes.lastIndexOf(GIVES_THE_SCREEN_BACK);
      const after = back < 0 ? '' : ran.bytes.slice(back + GIVES_THE_SCREEN_BACK.length);
      const echoed = (after.match(/\^D/g) ?? []).length;
      appendFileSync(OUT, `console\t${delay}\t${rep}\t${load()}\tgaveback=${back >= 0}\techo=${echoed}\tcode=${ran.code}\n`);
    }
  }, 1_200_000);
}

// the controls. A pipe into `script` is the way the harness hands a program a terminal.
//   c1 (must see it): a terminal in non-canonical mode with echo on echoes the control byte as `^D`.
//   c2 (informational): a plain cooked terminal. On Linux the line discipline does not echo the
//   end-of-file character in canonical mode, so a count of 0 here is the kernel's, not the product's.
async function echoOf(shell: string): Promise<number> {
  const bytes = await new Promise<string>((resolve) => {
    const child = spawn('script', ['-qec', shell, '/dev/null'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', (d) => { text += d.toString(); });
    child.stdin.on('error', () => undefined);
    setTimeout(() => child.stdin.write(ENDS_THE_INPUT), 600);
    child.on('close', () => resolve(text));
    setTimeout(() => child.kill('SIGKILL'), 5000);
  });
  return (bytes.match(/\^D/g) ?? []).length;
}
it('controls', async () => {
  for (let rep = 0; rep < Math.min(N, 5); rep++) {
    const c1 = await echoOf('stty -icanon echo; sleep 2');
    const c2 = await echoOf('sleep 2');
    appendFileSync(OUT, `control\t-\t${rep}\t${load()}\tc1_noncanonical=${c1}\tc2_cooked=${c2}\n`);
  }
}, 240_000);
