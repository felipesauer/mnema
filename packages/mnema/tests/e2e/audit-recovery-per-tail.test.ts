import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * The local-tail recovery commands (`reconcile`, `accept-truncation`) rebuild
 * the SQLite mirror and re-sign the head for THIS machine's tail only. On a
 * multi-machine project — where a sibling machine's tail arrives via git merge
 * — they must operate on the LOCAL tail, never the project-wide chain: walking
 * every tail and writing the cross-tail SUM into the single local mirror row
 * would corrupt the very mirror the command is meant to heal, and make the
 * next `doctor`/`verify` report a spurious count/hash-chain error.
 */
const repoRoot = path.resolve('.');
const cliEntry = path.join(repoRoot, 'packages', 'mnema', 'dist', 'index.js');

function runCli(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [cliEntry, ...args], {
    cwd,
    env: { ...process.env, MNEMA_ACTOR: 'you', ...env },
    encoding: 'utf-8',
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** This machine's tail dir under the project audit dir (exactly one for HOME). */
function soleTail(projectRoot: string): string {
  const auditDir = path.join(projectRoot, '.mnema', 'audit');
  const tail = readdirSync(auditDir, { withFileTypes: true }).find(
    (d) => d.isDirectory() && /^m-[0-9a-f]{12}$/.test(d.name),
  );
  if (tail === undefined) throw new Error('no machine tail found');
  return path.join(auditDir, tail.name);
}

function localChainedCount(projectRoot: string): number {
  const file = path.join(soleTail(projectRoot), 'current.jsonl');
  if (!existsSync(file)) return 0;
  return readFileSync(file, 'utf-8')
    .trim()
    .split('\n')
    .filter((l) => l.length > 0).length;
}

beforeAll(() => {
  if (!existsSync(cliEntry)) throw new Error(`CLI not built. Run pnpm build. Path: ${cliEntry}`);
});

// Spawns several real `mnema` subprocesses (init + writes + reconcile +
// doctor), so give it the same headroom the other CLI e2e suites use.
describe('audit reconcile is scoped to the local machine tail (e2e)', { timeout: 30_000 }, () => {
  let projectRoot: string;
  let homeA: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-recovery-tail-'));
    homeA = mkdtempSync(path.join(tmpdir(), 'mnema-homeA-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(homeA, { recursive: true, force: true });
  });

  it('reconcile rebuilds the mirror from the LOCAL tail, ignoring a sibling tail on disk', () => {
    // Machine A writes real chained events into its own tail.
    const env = { HOME: homeA, USERPROFILE: homeA };
    expect(runCli(['init', '--name', 'App', '--key', 'APP'], projectRoot, env).status).toBe(0);
    runCli(['task', 'create', '--title', 'One'], projectRoot, env);
    runCli(['task', 'create', '--title', 'Two'], projectRoot, env);
    // Capture A's tail + count BEFORE the sibling exists (soleTail asserts one).
    const localTail = soleTail(projectRoot);
    const localCount = localChainedCount(projectRoot);
    expect(localCount).toBeGreaterThan(0);

    // A sibling machine's tail arrives via git merge: copy A's tail to a
    // second machine dir. Its lines are real, keyed, and structurally valid —
    // the aggregate walk WOULD count them, doubling the project total.
    const auditDir = path.join(projectRoot, '.mnema', 'audit');
    const siblingTail = path.join(auditDir, 'm-0000000000bb');
    mkdirSync(siblingTail, { recursive: true });
    cpSync(path.join(localTail, 'current.jsonl'), path.join(siblingTail, 'current.jsonl'));

    // Simulate a fresh clone of the DB: drop the git-ignored state so the mirror
    // is behind disk (the shape reconcile heals).
    const dbPath = path.join(projectRoot, '.mnema/state', 'state.db');
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });

    const reconcile = runCli(['audit', 'reconcile', '--force'], projectRoot, env);
    expect(reconcile.status).toBe(0);

    // The mirror was rebuilt to the LOCAL tail count, NOT the local+sibling sum.
    // A regressed (project-wide) reconcile would report 2×localCount here.
    const doctor = runCli(['doctor'], projectRoot, env);
    const countLine = doctor.stdout.split('\n').find((l) => l.includes('audit event count'));
    expect(countLine).toBeDefined();
    expect(countLine).toContain(`${localCount} chained events match`);
    // …and the mirror-vs-disk check is not red (a cross-tail sum would make it
    // report the mirror ahead of the local tail).
    expect(countLine).toContain('✓');
    expect(countLine).not.toContain('✗');
  });
});
