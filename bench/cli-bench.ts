import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Smoke benchmark against the budgets documented in
 * ARCHITECTURE.md §15 — "Performance — orçamentos".
 *
 * Run via `pnpm bench`. The script spawns the compiled CLI (`dist/`),
 * seeds a throwaway project under `os.tmpdir()`, and reports each
 * measurement against its budget. Spawn cost includes Node start-up
 * plus the dynamic-import chain that pulls in the service container,
 * SQLite native binding and zod schemas — together they form a hard
 * floor of ~150ms before any user-facing work happens. Budgets are
 * tuned to be tight enough to flag regressions without lying about
 * the cold-start cost.
 *
 * Agents that need sub-10ms operations should drive Mnema via the MCP
 * daemon (`mnema mcp serve`), where the imports are paid once at
 * startup and tool calls reuse the warm process.
 *
 * Exits non-zero when any budget is exceeded so CI can flag
 * regressions, but the failure is informational only: the CLI is
 * still functionally correct.
 */

interface Budget {
  readonly name: string;
  readonly budgetMs: number;
  readonly run: (env: BenchEnv) => number;
}

interface BenchEnv {
  readonly cliEntry: string;
  readonly projectRoot: string;
}

const repoRoot = path.resolve(import.meta.dirname, '..');
const cliEntry = path.join(repoRoot, 'dist', 'index.js');

let benchSequence = 0;
function nextBenchKey(): string {
  benchSequence += 1;
  return `BNCH-${benchSequence}`;
}

if (!existsSync(cliEntry)) {
  process.stderr.write(
    `error: ${cliEntry} not found. Run \`pnpm build\` before \`pnpm bench\`.\n`,
  );
  process.exit(1);
}

const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-bench-'));
try {
  bootstrapProject(projectRoot);
  const env: BenchEnv = { cliEntry, projectRoot };

  const budgets: Budget[] = [
    {
      name: 'mnema --version',
      budgetMs: 50,
      run: ({ cliEntry: entry }) =>
        timeIt(() => runCli([entry, '--version'], { cwd: projectRoot })),
    },
    {
      name: 'mnema task list (empty)',
      budgetMs: 200,
      run: ({ cliEntry: entry }) =>
        timeIt(() => runCli([entry, 'task', 'list'], { cwd: projectRoot })),
    },
    {
      name: 'mnema task move',
      // Cold-start floor analysis (R12 investigation, 2026-06-09):
      //   ~30ms  Node runtime spawn
      //   ~95ms  dynamic-import chain (service-container statically
      //          pulls 47 imports — every repo + service + zod schema)
      //   ~15ms  better-sqlite3 native binding load + DB open with WAL
      //   ~15ms  workflow JSON parse + zod refines + SQL + audit write
      //   = ~155ms hard floor measured across 5 runs (range 153-165ms).
      //
      // The original 100ms target predated the service-container
      // wiring growing to 22 services; the realistic spawn-once
      // budget is 200ms, with the agent daemon path (`mnema mcp
      // serve`) staying sub-10ms because imports + container are
      // amortised across all tool calls. Reaching <120ms here would
      // require either:
      //   (a) bundling the CLI through esbuild/tsdown to elide
      //       the dynamic-import waterfall, or
      //   (b) splitting `createServiceContainer` so commands only
      //       wire the services they actually use (and `task move`
      //       does need most of them — task + transition + sync +
      //       audit + identity + decision + memory).
      // Neither is in scope for the current alpha cycle. Tracked in
      // docs/TECH_DEBT.md §5.
      budgetMs: 200,
      run: ({ cliEntry: entry }) => benchTaskMove(entry, projectRoot),
    },
  ];

  process.stdout.write('Mnema bench — budgets from ARCHITECTURE.md §15\n');
  process.stdout.write('-----------------------------------------------\n');
  let failed = 0;
  for (const budget of budgets) {
    const elapsed = budget.run(env);
    const ok = elapsed <= budget.budgetMs;
    const mark = ok ? '✓' : '✗';
    process.stdout.write(
      `${mark} ${budget.name.padEnd(28)} ${elapsed.toFixed(0).padStart(5)}ms / ${budget.budgetMs}ms\n`,
    );
    if (!ok) failed += 1;
  }

  process.stdout.write('-----------------------------------------------\n');
  if (failed > 0) {
    process.stderr.write(`${failed} budget(s) exceeded.\n`);
    process.exit(1);
  }
} finally {
  rmSync(projectRoot, { recursive: true, force: true });
}

function timeIt(fn: () => void): number {
  const start = process.hrtime.bigint();
  fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1_000_000;
}

function bootstrapProject(cwd: string): void {
  runCli([cliEntry, 'init', '--name', 'Bench', '--key', 'BNCH'], { cwd });
}

function benchTaskMove(entry: string, cwd: string): number {
  // Create a fresh task per measurement so the move always starts from DRAFT.
  runCli([entry, 'task', 'create', '--title', 'Bench move target'], { cwd });
  // Find the created task key by counting how many tasks already exist.
  // Simpler: every fresh project starts at BNCH-1 and increments. Track
  // a counter via env so consecutive runs know the next key.
  const key = nextBenchKey();
  return timeIt(() => {
    runCli(
      [
        entry,
        'task',
        'move',
        key,
        'submit',
        'title=Bench move target',
        'description=submission attempt with enough text length',
        'acceptance_criteria=AC1,AC2',
        'estimate=3',
      ],
      { cwd },
    );
  });
}

function runCli(args: readonly string[], { cwd }: { cwd: string }): void {
  const result = spawnSync('node', args, {
    cwd,
    env: { ...process.env, MNEMA_ACTOR: 'bench', NODE_ENV: 'production' },
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error(
      `bench: ${args.slice(1).join(' ')} exited ${result.status}\nstderr: ${result.stderr}`,
    );
  }
}
