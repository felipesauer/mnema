import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/** The single machine tail's `current.jsonl` under a project audit dir. */
function tailCurrent(auditDir: string): string {
  const tail = readdirSync(auditDir, { withFileTypes: true }).find(
    (d) => d.isDirectory() && /^m-[0-9a-f]{12}$/.test(d.name),
  );
  return path.join(tail ? path.join(auditDir, tail.name) : auditDir, 'current.jsonl');
}

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
    // Give the run concrete work: roll mnema_version back so the plan is
    // non-trivial. (Post-squash there is no stageable pending migration —
    // migrations ship bundled, one dir, mnema-exclusive.)
    const configPath = path.join(projectRoot, '.mnema', 'mnema.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    writeFileSync(
      configPath,
      `${JSON.stringify({ ...config, mnema_version: '^0.0.1-alpha.0' }, null, 2)}\n`,
      'utf-8',
    );
    const agentsBefore = readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf-8');

    const dry = runCli(['upgrade', '--dry-run'], projectRoot);
    expect(dry.status).toBe(0);
    // The plan is shown, including the version bump.
    expect(dry.stdout).toContain('dry run, nothing applied');
    expect(dry.stdout).toContain('set mnema_version');

    // Nothing was applied: the version is untouched...
    const after = JSON.parse(readFileSync(configPath, 'utf-8')) as { mnema_version: string };
    expect(after.mnema_version).toBe('^0.0.1-alpha.0');
    // ...and AGENTS.md is byte-for-byte unchanged.
    expect(readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf-8')).toBe(agentsBefore);
  });

  it('a fresh clone needs no audit-mirror reconcile (its own tail is empty)', () => {
    // Machine A writes chained audit events into its tail (`audit/m-<A>/`).
    const homeA = path.join(mkdtempSync(path.join(tmpdir(), 'mnema-homeA-')));
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot, { HOME: homeA });
    runCli(['task', 'create', '--title', 'Real task'], projectRoot, { HOME: homeA });
    runCli(
      ['task', 'move', 'WEBAPP-1', 'submit', '--field', 'acceptance_criteria=done'],
      projectRoot,
      { HOME: homeA },
    );

    const dbPath = path.join(projectRoot, '.mnema/state', 'state.db');
    const diskChained = countChainedLines(tailCurrent(path.join(projectRoot, '.mnema/audit')));
    expect(diskChained).toBeGreaterThan(0);

    // Clone onto machine B: the git-ignored state DB is gone, and a DIFFERENT
    // machine id means B's own tail does not exist yet. B's mirror (0) already
    // matches B's tail (empty) — A's committed tail is validated cryptographically
    // but is not B's to mirror — so there is NOTHING to reconcile.
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
    const homeB = path.join(mkdtempSync(path.join(tmpdir(), 'mnema-homeB-')));
    const configPath = path.join(projectRoot, '.mnema', 'mnema.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    writeFileSync(
      configPath,
      `${JSON.stringify({ ...config, mnema_version: '^0.12.0-alpha.0' }, null, 2)}\n`,
      'utf-8',
    );

    const upgrade = runCli(['upgrade', '--yes'], projectRoot, { HOME: homeB });
    expect(upgrade.status).toBe(0);
    // No reconcile step: the mirror-vs-local-tail invariant holds by construction.
    expect(upgrade.stdout).not.toContain('reconcile the audit mirror');

    // The post-upgrade health summary's audit-count check is GREEN: B's mirror
    // (0) matches B's on-disk tail (empty).
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
function _readCreatedTables(dbPath: string): string[] {
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

/** Counts the chained lines in an audit JSONL file. */
function countChainedLines(jsonlPath: string): number {
  if (!existsSync(jsonlPath)) return 0;
  let n = 0;
  for (const line of readFileSync(jsonlPath, 'utf-8').split('\n')) {
    if (line.length === 0) continue;
    try {
      const event = JSON.parse(line) as { v?: unknown };
      if (typeof event.v === 'number' && event.v === 1) n += 1;
    } catch {
      // ignore unparseable lines
    }
  }
  return n;
}
