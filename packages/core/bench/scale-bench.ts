import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ConfigSchema } from '../src/config/config-schema.js';
import { inspectAuditIntegrity } from '../src/services/audit-integrity.js';
import { createServiceContainer } from '../src/services/service-container.js';

/**
 * Scale benchmark: how do the two whole-project operations — audit-chain
 * verification (`mnema doctor`) and the markdown-mirror rebuild (`mnema
 * sync`) — hold up on a large history?
 *
 * These are O(number of events / tasks), not cold-start, so they get
 * generous wall-clock budgets: the point is to catch an accidental
 * quadratic or a per-item disk round-trip regressing as the project grows,
 * not to police milliseconds. Run via `pnpm bench:scale`. Seeds in-process
 * (no per-task CLI spawn) so seeding 500+ tasks stays quick.
 */
const TASK_COUNT = Number(process.env.BENCH_TASKS ?? '600');

const repoRoot = path.resolve(import.meta.dirname, '..');
const migrationsDir = path.join(repoRoot, 'src/storage/sqlite/migrations');

function timeIt(fn: () => void): number {
  const start = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-scale-'));
try {
  const config = ConfigSchema.parse({
    version: '2.0',
    mnema_version: '^0.0.0',
    project: { key: 'SCALE', name: 'Scale Bench' },
  });
  // The container loads the workflow from disk, so seed the layout the
  // config points at before building it.
  for (const dir of [
    config.paths.state,
    config.paths.audit,
    config.paths.backlog,
    config.paths.workflows,
  ]) {
    mkdirSync(path.join(projectRoot, dir), { recursive: true });
  }
  copyFileSync(
    path.join(repoRoot, 'workflows', 'default.json'),
    path.join(projectRoot, config.paths.workflows, 'default.json'),
  );
  const container = createServiceContainer(config, projectRoot, { migrationsDir });

  // Seed: one run wrapping many task creations, so the audit log and the
  // backlog mirror both grow to a realistic size.
  const started = container.agentRun.start({
    goal: 'bench seed',
    actor: 'bench',
    agentHandle: 'bench',
  });
  if (!started.ok) throw new Error(`bench: agent_run_start failed: ${started.error.message}`);
  const runId = started.value.id;

  const seedMs = timeIt(() => {
    for (let i = 0; i < TASK_COUNT; i++) {
      const r = container.task.create({
        projectKey: config.project.key,
        title: `Task ${i}`,
        actor: 'bench',
        runId,
      });
      if (!r.ok) throw new Error(`bench: task.create failed at ${i}: ${r.error.message}`);
    }
  });
  container.agentRun.end({ runId, status: 'completed' });

  const events = container.auditQuery.runStrict().events.length;

  // `mnema doctor`'s audit check: full end-to-end chain verification.
  const doctorMs = timeIt(() => {
    inspectAuditIntegrity(container.adapter, path.join(projectRoot, config.paths.audit));
  });

  // `mnema sync`: rebuild the SQLite cache from the markdown mirror.
  const syncMs = timeIt(() => {
    container.syncRebuild.run(config.project.key);
  });

  container.close();

  const budgets = [
    { name: `seed ${TASK_COUNT} tasks`, ms: seedMs, budgetMs: 20_000 },
    { name: `doctor audit verify (${events} events)`, ms: doctorMs, budgetMs: 2_000 },
    { name: `sync rebuild (${TASK_COUNT} tasks)`, ms: syncMs, budgetMs: 5_000 },
  ];

  const scale = process.env.CI !== undefined && process.env.CI !== '' ? 2 : 1;
  process.stdout.write(`Mnema scale bench — ${TASK_COUNT} tasks${scale > 1 ? ' (CI ×2)' : ''}\n`);
  process.stdout.write('-----------------------------------------------\n');
  let failed = 0;
  for (const b of budgets) {
    const budget = b.budgetMs * scale;
    const ok = b.ms <= budget;
    process.stdout.write(
      `${ok ? '✓' : '✗'} ${b.name.padEnd(34)} ${b.ms.toFixed(0).padStart(6)}ms / ${budget}ms\n`,
    );
    if (!ok) failed += 1;
  }
  process.stdout.write('-----------------------------------------------\n');
  if (failed > 0) {
    process.stderr.write(`${failed} budget(s) exceeded\n`);
    process.exit(1);
  }
} finally {
  rmSync(projectRoot, { recursive: true, force: true });
}
