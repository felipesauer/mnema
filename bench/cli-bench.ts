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
 * measurement against its budget. Spawn cost includes Node start-up,
 * which dominates short commands — the budgets are intentionally
 * tight so regressions are visible.
 *
 * Exits non-zero when any budget is exceeded so CI can flag
 * regressions, but the failure is informational only: the CLI is
 * still functionally correct. Document deviations in
 * `docs/TECH_DEBT.md` § Performance.
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
      budgetMs: 100,
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
