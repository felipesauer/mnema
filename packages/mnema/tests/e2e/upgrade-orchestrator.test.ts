import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * End-to-end coverage for the `mnema upgrade` orchestrator's completed
 * behaviour: markdown → DB ingest (fail-closed on duplicate mirrors), adopting
 * newly-shipped layout components (missing-only, idempotent), the ordered plan
 * (`--dry-run`), and that a dry run writes nothing. These drive the real wired
 * command as a subprocess — the established e2e pattern in cli.test.ts — so the
 * assertions cover the CLI output and on-disk effects, not just internals.
 */

const repoRoot = path.resolve('.');
const cliEntry = path.join(repoRoot, 'packages', 'mnema', 'dist', 'index.js');
const workflowsSrc = path.resolve('packages/core/workflows');

function runCli(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [cliEntry, ...args], {
    cwd,
    env: { ...process.env, MNEMA_ACTOR: 'daniel', ...env },
    encoding: 'utf-8',
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Frontmatter a committed task mirror carries, in the shape sync writes. */
function taskMd(key: string, state: string): string {
  return [
    '---',
    'mnema:',
    `  key: ${key}`,
    `  state: ${state}`,
    `  title: Committed ${key}`,
    '  reporter: alice',
    '  metadata: {}',
    '---',
    `# Committed ${key}`,
    '',
  ].join('\n');
}

/**
 * Builds a checkout that has everything git tracks (config, the active
 * workflow, and committed backlog markdown) but no `.mnema/state/` — the
 * git-ignored directory a fresh clone never has, so the local DB starts empty.
 */
function freshClone(
  projectRoot: string,
  tasks: ReadonlyArray<{ key: string; state: string }>,
): void {
  mkdirSync(path.join(projectRoot, '.mnema/workflows'), { recursive: true });
  const config = {
    version: '1.0',
    mnema_version: '^0.13.0-alpha.0',
    project: { key: 'CLONE', name: 'Clone Test' },
    workflow: 'default',
  };
  writeFileSync(
    path.join(projectRoot, '.mnema/mnema.config.json'),
    JSON.stringify(config, null, 2),
  );
  writeFileSync(
    path.join(projectRoot, '.mnema/workflows/default.json'),
    readFileSync(path.join(workflowsSrc, 'default.json'), 'utf-8'),
  );
  for (const { key, state } of tasks) {
    const dir = path.join(projectRoot, '.mnema/backlog', state);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${key}.md`), taskMd(key, state));
  }
}

beforeAll(() => {
  if (!existsSync(cliEntry)) {
    throw new Error(`CLI entry not built. Run pnpm build before tests. Path: ${cliEntry}`);
  }
});

describe('mnema upgrade orchestrator (e2e)', { timeout: 30_000 }, () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-upg-orch-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('ingests committed markdown into the cache on a fresh clone', () => {
    freshClone(projectRoot, [{ key: 'CLONE-1', state: 'DRAFT' }]);

    // Before the upgrade the local DB has never seen the committed task.
    expect(runCli(['task', 'show', 'CLONE-1'], projectRoot).status).not.toBe(0);

    const upgrade = runCli(['upgrade', '--yes'], projectRoot);
    expect(upgrade.status).toBe(0);
    expect(upgrade.stdout).toContain('ingest committed markdown into the cache');
    expect(upgrade.stdout).toContain('ingested 1 row(s)');

    // The row now exists — the ingest ran markdown → DB.
    const show = runCli(['task', 'show', 'CLONE-1'], projectRoot);
    expect(show.status).toBe(0);
    expect(show.stdout).toContain('CLONE-1');
    expect(show.stdout).toContain('DRAFT');
  });

  it('reports a duplicate-mirror conflict LOUDLY, does not fail, and keeps both copies', () => {
    // Same key committed in two state directories: an ambiguous duplicate the
    // ingest must refuse rather than guess a state for.
    freshClone(projectRoot, [
      { key: 'CLONE-1', state: 'DRAFT' },
      { key: 'CLONE-1', state: 'DONE' },
    ]);

    const upgrade = runCli(['upgrade', '--yes'], projectRoot);
    // Fail-closed does NOT mean fail the command: the guard prevented the
    // unsafe write, so the upgrade completes cleanly.
    expect(upgrade.status).toBe(0);
    // The conflict is surfaced loudly, naming the key and both state dirs.
    expect(upgrade.stdout).toContain('CLONE-1 in [DONE, DRAFT]');
    expect(upgrade.stdout).toContain('LEFT UNTOUCHED');

    // The guard left the cached row unset — no state was guessed.
    expect(runCli(['task', 'show', 'CLONE-1'], projectRoot).status).not.toBe(0);

    // Neither committed copy was pruned: the orphan-prune protects the
    // conflicted key so the human still has both to resolve the duplicate.
    expect(existsSync(path.join(projectRoot, '.mnema/backlog/DRAFT/CLONE-1.md'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.mnema/backlog/DONE/CLONE-1.md'))).toBe(true);
  });

  it('adopts a MISSING layout component and leaves present ones alone', () => {
    // `--minimal` init: skills/memory/roadmap/commands/templates are not seeded.
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP', '--minimal'], projectRoot);
    const memoryDir = path.join(projectRoot, '.mnema/memory');
    const commandsDir = path.join(projectRoot, '.mnema/commands');
    expect(existsSync(path.join(memoryDir, 'INDEX.md'))).toBe(false);

    const upgrade = runCli(['upgrade', '--yes'], projectRoot);
    expect(upgrade.status).toBe(0);
    expect(upgrade.stdout).toContain('adopt missing layout component(s)');
    // memory is one of the components adopted; its INDEX.md now exists.
    expect(upgrade.stdout).toMatch(/adopt missing layout component\(s\):.*memory/);
    expect(existsSync(path.join(memoryDir, 'INDEX.md'))).toBe(true);
    expect(existsSync(path.join(commandsDir, 'standup.md'))).toBe(true);
  });

  it('adds no adopt step when every component is already present (idempotent)', () => {
    // A full (non-minimal) init seeds every component that upgrade would adopt.
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    // First upgrade settles anything init left for upgrade (e.g. empty dirs).
    runCli(['upgrade', '--yes'], projectRoot);

    // A second upgrade must find nothing to adopt.
    const second = runCli(['upgrade', '--yes'], projectRoot);
    expect(second.status).toBe(0);
    expect(second.stdout).not.toContain('adopt missing layout component');
  });

  it('orders the plan: ingest BEFORE rebuild, adopt BEFORE AGENTS.md sync', () => {
    // A fresh clone that also lacks the layout components exercises every step:
    // ingest, adopt, AGENTS.md sync, and the mirror prune/rebuild.
    freshClone(projectRoot, [{ key: 'CLONE-1', state: 'DRAFT' }]);

    const dry = runCli(['upgrade', '--dry-run'], projectRoot);
    expect(dry.status).toBe(0);
    const out = dry.stdout;

    const idxIngest = out.indexOf('ingest committed markdown');
    const idxAdopt = out.indexOf('adopt missing layout component');
    const idxAgents = out.indexOf('sync the AGENTS.md managed block');
    // The prune/rebuild steps carry "markdown mirrors"; either may appear.
    const idxMirror = out.search(
      /(rebuild missing markdown mirrors|prune orphan markdown mirrors)/,
    );

    expect(idxIngest).toBeGreaterThanOrEqual(0);
    expect(idxAdopt).toBeGreaterThanOrEqual(0);
    expect(idxAgents).toBeGreaterThanOrEqual(0);
    expect(idxMirror).toBeGreaterThanOrEqual(0);

    // ingest precedes any mirror rebuild/prune (rows must exist before mirror).
    expect(idxIngest).toBeLessThan(idxMirror);
    // adopt precedes the AGENTS.md sync (adopting memory creates the INDEX.md
    // the managed block imports, so the regen embeds it in one pass).
    expect(idxAdopt).toBeLessThan(idxAgents);
  });

  it('--dry-run prints the plan and writes NOTHING', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    // Give the run concrete work: roll mnema_version back and add a pending
    // project-local migration, so the plan is non-trivial.
    const configPath = path.join(projectRoot, '.mnema', 'mnema.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    writeFileSync(
      configPath,
      `${JSON.stringify({ ...config, mnema_version: '^0.0.1-alpha.0' }, null, 2)}\n`,
      'utf-8',
    );
    const migrationsDir = path.join(projectRoot, '.mnema', 'migrations');
    mkdirSync(migrationsDir, { recursive: true });
    writeFileSync(
      path.join(migrationsDir, '950_dry_probe.sql'),
      'CREATE TABLE IF NOT EXISTS dry_probe (id INTEGER PRIMARY KEY);\n',
      'utf-8',
    );
    const agentsBefore = readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf-8');

    const dry = runCli(['upgrade', '--dry-run'], projectRoot);
    expect(dry.status).toBe(0);
    // The plan is shown, including the migration in phase 1 and the version bump.
    expect(dry.stdout).toContain('dry run, nothing applied');
    expect(dry.stdout).toContain('[migrations] apply 1 pending migration(s): 950_dry_probe.sql');
    expect(dry.stdout).toContain('set mnema_version');

    // Nothing was applied: the version is untouched...
    const after = JSON.parse(readFileSync(configPath, 'utf-8')) as { mnema_version: string };
    expect(after.mnema_version).toBe('^0.0.1-alpha.0');
    // ...AGENTS.md is byte-for-byte unchanged...
    expect(readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf-8')).toBe(agentsBefore);
    // ...and the pending migration never ran (the table was not created).
    const applied = readCreatedTables(path.join(projectRoot, '.mnema/state', 'state.db'));
    expect(applied).not.toContain('dry_probe');
  });

  it('reconciles audit_state that a fresh clone left behind the on-disk chain', () => {
    // A real project that has written chained audit events, then a "clone":
    // the git-ignored state DB is gone, so audit_state resets to 0 while the
    // committed .audit/*.jsonl still holds the chained events.
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    runCli(['task', 'create', '--title', 'Real task'], projectRoot);
    runCli(
      ['task', 'move', 'WEBAPP-1', 'submit', '--field', 'acceptance_criteria=done'],
      projectRoot,
    );

    const dbPath = path.join(projectRoot, '.mnema/state', 'state.db');
    const diskChained = countChainedLines(path.join(projectRoot, '.mnema/audit/current.jsonl'));
    expect(diskChained).toBeGreaterThan(0);

    // Simulate the clone: remove the git-ignored state (db + wal/shm) and roll
    // mnema_version back so the upgrade has a version bump to do as well.
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
    const configPath = path.join(projectRoot, '.mnema', 'mnema.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    writeFileSync(
      configPath,
      `${JSON.stringify({ ...config, mnema_version: '^0.12.0-alpha.0' }, null, 2)}\n`,
      'utf-8',
    );

    const upgrade = runCli(['upgrade', '--yes'], projectRoot);
    expect(upgrade.status).toBe(0);
    // The reconcile step ran and moved the mirror from 0 up to the disk count.
    expect(upgrade.stdout).toContain('reconcile the audit mirror');
    expect(upgrade.stdout).toContain(`audit mirror reconciled: event_count 0 → ${diskChained}`);

    // audit_state now equals the on-disk chained count...
    expect(readAuditEventCount(dbPath)).toBe(diskChained);
    // ...and the post-upgrade health summary's audit-count check is GREEN
    // (no leading ✗ on the "audit event count" line).
    const auditCountLine = upgrade.stdout.split('\n').find((l) => l.includes('audit event count'));
    expect(auditCountLine).toBeDefined();
    expect(auditCountLine).toContain('✓');
    expect(auditCountLine).not.toContain('✗');
    expect(auditCountLine).toContain('match audit_state.event_count');
  });

  it('does NOT add the reconcile step when audit_state already matches disk', () => {
    // A healthy project (state DB intact) has audit_state in step with disk.
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    runCli(['task', 'create', '--title', 'Real task'], projectRoot);
    // Give the run something to do so the plan is non-empty, without disturbing
    // the audit mirror.
    const configPath = path.join(projectRoot, '.mnema', 'mnema.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    writeFileSync(
      configPath,
      `${JSON.stringify({ ...config, mnema_version: '^0.12.0-alpha.0' }, null, 2)}\n`,
      'utf-8',
    );

    const dry = runCli(['upgrade', '--dry-run'], projectRoot);
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain('set mnema_version');
    expect(dry.stdout).not.toContain('reconcile the audit mirror');
  });
});

/** Reads the names of user tables in a SQLite DB (best-effort, for assertions). */
function readCreatedTables(dbPath: string): string[] {
  if (!existsSync(dbPath)) return [];
  // Use the built CLI's own better-sqlite3 to avoid a duplicate dependency.
  const script =
    "const D=require('better-sqlite3');const db=new D(process.argv[1]);" +
    'const r=db.prepare("SELECT name FROM sqlite_master WHERE type=\'table\'").all();' +
    'process.stdout.write(JSON.stringify(r.map((x)=>x.name)));db.close();';
  const res = spawnSync('node', ['-e', script, dbPath], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });
  if (res.status !== 0) return [];
  try {
    return JSON.parse(res.stdout) as string[];
  } catch {
    return [];
  }
}

/** Counts the chained (schema v>=2) lines in an audit JSONL file. */
function countChainedLines(jsonlPath: string): number {
  if (!existsSync(jsonlPath)) return 0;
  let n = 0;
  for (const line of readFileSync(jsonlPath, 'utf-8').split('\n')) {
    if (line.length === 0) continue;
    try {
      const event = JSON.parse(line) as { v?: unknown };
      if (typeof event.v === 'number' && event.v >= 2) n += 1;
    } catch {
      // ignore unparseable lines
    }
  }
  return n;
}

/** Reads `audit_state.event_count` from a project's SQLite DB (0 when absent). */
function readAuditEventCount(dbPath: string): number {
  if (!existsSync(dbPath)) return 0;
  const script =
    "const D=require('better-sqlite3');const db=new D(process.argv[1]);" +
    "const r=db.prepare('SELECT event_count FROM audit_state WHERE id=1').get();" +
    'process.stdout.write(String(r?r.event_count:0));db.close();';
  const res = spawnSync('node', ['-e', script, dbPath], { cwd: repoRoot, encoding: 'utf-8' });
  if (res.status !== 0) return 0;
  const parsed = Number.parseInt(res.stdout.trim(), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}
