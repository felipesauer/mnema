// One wall, one size, one tree (base or head), one process: prints one JSON line.
// usage: node measure.mjs <worktree> <N> <op> [reps]
// Every op works on a private copy of the frozen fixture and removes it.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// DIR holds the frozen fixtures (`fx/<events>`) and is where every private copy is made.
const S = process.env.MEASURE_DIR ?? '';
if (S === '') throw new Error('set MEASURE_DIR to the directory that holds fx/');
const [WT, nArg, op, repsArg] = process.argv.slice(2);
const N = Number(nArg);
const REPS = Number(repsArg ?? 5);
const FX = `${S}/fx/${N}`;
if (!existsSync(FX)) throw new Error(`no fixture ${FX}`);

const work = mkdtempSync(join(S, 'run-'));
execFileSync('cp', ['-a', `${FX}/proj`, `${FX}/home`, work]);
execFileSync('chmod', ['-R', 'u+w', work]);
const proj = join(work, 'proj');
const home = join(work, 'home');
const root = join(proj, '.mnema');
const cli = `${WT}/packages/code/dist/cli.js`;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const r1 = (x) => Math.round(x * 10) / 10;

const env = { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: '1' };

/** One CLI run: wall ms and peak RSS (KB), by /usr/bin/time. */
function run(argv) {
  const t = process.hrtime.bigint();
  const ran = spawnSync('/usr/bin/time', ['-f', 'MAXRSS %M', process.execPath, cli, ...argv], {
    cwd: proj,
    env,
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  const rss = Number(/MAXRSS (\d+)/.exec(ran.stderr)?.[1] ?? 0);
  return { ms, rss, status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

const chain = await import(`${WT}/packages/chain/dist/index.js`);
const core = await import(`${WT}/packages/core/dist/index.js`);
const up = chain.catalogUpcasters();
const out = { wt: WT === process.env.BASE_WT ? 'base' : 'head', N, op };

try {
  if (op === 'refresh1') {
    // The MCP wall: a warm session, one fact arrives, the next read.
    const cache = core.ProjectionCache.open(root);
    cache.rebuild();
    const keyRoot = join(home, '.mnema', 'identity');
    const w = chain.openChainForWriting(root, { keyRoot });
    const ms = [];
    for (let i = 0; i < REPS; i++) {
      w.appendAll([
        chain.memoryCaptured(
          { at: new Date(Date.UTC(2027, 0, 1) + i * 1000).toISOString(), who: w.anchor, signerFp: w.signerFingerprint, subject: `01a0e000-0000-7000-8000-${String(i).padStart(12, '0')}` },
          { content: `arrived ${i}` },
        ),
      ]);
      w.checkpoint();
      const t = process.hrtime.bigint();
      cache.refresh();
      ms.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
    out.ms = r1(median(ms));
  } else if (op === 'cli-search' || op === 'cli-brief' || op === 'cli-recall' || op === 'cli-status') {
    const argv = { 'cli-search': ['search', 'zqneedle'], 'cli-brief': ['brief'], 'cli-recall': ['recall'], 'cli-status': ['status'] }[op];
    const runs = Array.from({ length: REPS }, () => run(argv));
    if (runs.some((r) => r.status !== 0)) throw new Error(`${argv.join(' ')}: ${runs.find((r) => r.status !== 0).stderr}`);
    out.first = r1(runs[0].ms);
    out.ms = r1(median(runs.slice(1).map((r) => r.ms)));
    out.rssMb = Math.round(median(runs.map((r) => r.rss)) / 1024);
  } else if (op === 'cli-decision-record') {
    const runs = Array.from({ length: REPS }, (_, i) => run(['decision', 'record', `A decision number ${i}`, 'a reason that is long enough to be a reason']));
    if (runs.some((r) => r.status !== 0)) throw new Error(runs.find((r) => r.status !== 0).stderr);
    out.ms = r1(median(runs.map((r) => r.ms)));
    out.first = r1(runs[0].ms);
  } else if (op === 'cli-task-move' || op === 'cli-decision-move') {
    const cache = core.ProjectionCache.open(root);
    cache.rebuild();
    const ids = op === 'cli-task-move' ? cache.listTasksByState('DRAFT').slice(0, REPS + 1).map((t) => t.id) : cache.listDecisionsByState('proposed').slice(0, REPS + 1).map((d) => d.id);
    cache.close();
    if (ids.length < REPS + 1) throw new Error('not enough entities to move');
    const runs = ids.map((id) => (op === 'cli-task-move' ? run(['task', 'move', 'submit', id]) : run(['decision', 'move', 'accept', id, '--note', 'accepted for the measurement'])));
    if (runs.some((r) => r.status !== 0)) throw new Error(runs.find((r) => r.status !== 0).stderr);
    out.first = r1(runs[0].ms);
    out.ms = r1(median(runs.slice(1).map((r) => r.ms)));
  } else if (op === 'census') {
    const context = await import(`${WT}/packages/context/dist/index.js`);
    const cache = core.ProjectionCache.open(root);
    cache.rebuild();
    const sources = [{ scope: 'public', chainRoot: root, project: proj, cache }];
    const query = { path: `${proj}/src/m1/m2/file.ts`, root: proj, onDisk: (rel) => existsSync(join(proj, rel)) };
    const f = () => context.governingRules(sources, query);
    f();
    out.addresses = cache.linksByRelation(core.GOVERNS_RELATION).length;
    const ms = [];
    for (let i = 0; i < REPS; i++) {
      const t = process.hrtime.bigint();
      f();
      ms.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
    out.ms = r1(median(ms));
  } else if (op === 'linkbreaks') {
    const cache = core.ProjectionCache.open(root);
    cache.rebuild();
    const t = process.hrtime.bigint();
    const k = 300;
    for (let i = 0; i < k; i++) cache.linkBreaksAsOfNow();
    out.msPerCall = Math.round((Number(process.hrtime.bigint() - t) / 1e6 / k) * 1000) / 1000;
  } else if (op === 'floor') {
    const runs = Array.from({ length: REPS }, () => run(['--version']));
    out.ms = r1(median(runs.map((r) => r.ms)));
  } else if (op === 'busy' || op === 'busy-warm') {
    // Three sessions move three decisions at once; how many are refused TAIL_BUSY. `busy-warm`
    // reads once first, so the tree keeps a projection the way a project that has been read does.
    const cache = core.ProjectionCache.open(root);
    cache.rebuild();
    const rounds = REPS;
    const ids = cache.listDecisionsByState('proposed').slice(0, 3 * rounds).map((d) => d.id);
    cache.close();
    if (op === 'busy-warm') run(['search', 'zqneedle']);
    let busy = 0;
    let ok = 0;
    const wall = [];
    for (let r = 0; r < rounds; r++) {
      const t = process.hrtime.bigint();
      const procs = ids.slice(r * 3, r * 3 + 3).map(
        (id) =>
          new Promise((resolve) => {
            const p = spawn(process.execPath, [cli, 'decision', 'move', 'accept', id, '--note', 'accepted for the measurement'], { cwd: proj, env });
            let err = '';
            p.stderr.on('data', (d) => (err += d));
            p.stdout.on('data', () => {});
            p.on('close', (code) => resolve({ code, err }));
          }),
      );
      for (const res of await Promise.all(procs)) {
        if (res.code === 0) ok += 1;
        else if (/TAIL_BUSY|did not come free/.test(res.err)) busy += 1;
        else throw new Error(res.err);
      }
      wall.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
    out.busy = busy;
    out.ok = ok;
    out.wallMs = r1(median(wall));
  } else {
    throw new Error(`unknown op ${op}`);
  }
  console.log(JSON.stringify(out));
} finally {
  rmSync(work, { recursive: true, force: true });
}
