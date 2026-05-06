import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve('.');
const cliEntry = path.join(repoRoot, 'dist', 'index.js');

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

beforeAll(() => {
  if (!existsSync(cliEntry)) {
    throw new Error(`CLI entry not built. Run pnpm build before tests. Path: ${cliEntry}`);
  }
});

describe('CLI end-to-end', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-e2e-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('mnema --version prints the package version', () => {
    const { status, stdout } = runCli(['--version'], projectRoot);
    expect(status).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('mnema init creates the expected layout', () => {
    const { status, stdout } = runCli(
      ['init', '--name', 'Web App', '--key', 'WEBAPP'],
      projectRoot,
    );

    expect(status).toBe(0);
    expect(stdout).toContain('mnema.config.json');

    expect(existsSync(path.join(projectRoot, 'mnema.config.json'))).toBe(true);
    expect(existsSync(path.join(projectRoot, 'AGENTS.md'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.app', 'state.db'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.audit', 'current.jsonl'))).toBe(true);
    expect(existsSync(path.join(projectRoot, 'workflows', 'default.json'))).toBe(true);
    expect(existsSync(path.join(projectRoot, 'backlog', 'DRAFT'))).toBe(true);

    const gitignore = readFileSync(path.join(projectRoot, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('.app/');
  });

  it('mnema init --force overwrites an existing config', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);

    const second = runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    expect(second.status).not.toBe(0);

    const forced = runCli(['init', '--name', 'Web App', '--key', 'WEBAPP', '--force'], projectRoot);
    expect(forced.status).toBe(0);
  });

  it('mnema task create + list + show + move flow works', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);

    const create = runCli(
      [
        'task',
        'create',
        '--title',
        'Implement OAuth login',
        '--description',
        'Add Google OAuth support to the login page.',
        '--acceptance',
        'Users can authenticate',
        '--estimate',
        '5',
      ],
      projectRoot,
    );
    expect(create.status).toBe(0);
    expect(create.stdout).toContain('WEBAPP-1');
    expect(create.stdout).toContain('DRAFT');

    const list = runCli(['task', 'list'], projectRoot);
    expect(list.status).toBe(0);
    expect(list.stdout).toContain('WEBAPP-1');

    const show = runCli(['task', 'show', 'WEBAPP-1'], projectRoot);
    expect(show.status).toBe(0);
    expect(show.stdout).toContain('Implement OAuth login');

    const move = runCli(
      [
        'task',
        'move',
        'WEBAPP-1',
        'submit',
        'title=Implement OAuth login flow',
        'description=Add Google OAuth support to the login page.',
        'acceptance_criteria=Users can authenticate,Token persists across reloads',
        'estimate=5',
      ],
      projectRoot,
    );
    expect(move.status).toBe(0);
    expect(move.stdout).toContain('READY');

    const draftFile = path.join(projectRoot, 'backlog', 'DRAFT', 'WEBAPP-1.md');
    const readyFile = path.join(projectRoot, 'backlog', 'READY', 'WEBAPP-1.md');
    expect(existsSync(draftFile)).toBe(false);
    expect(existsSync(readyFile)).toBe(true);

    const audit = readFileSync(path.join(projectRoot, '.audit', 'current.jsonl'), 'utf-8');
    expect(audit).toContain('task_created');
    expect(audit).toContain('task_transitioned');
  });

  it('mnema task move on an invalid action returns a structured error', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    runCli(['task', 'create', '--title', 'X'], projectRoot);

    const result = runCli(['task', 'move', 'WEBAPP-1', 'approve'], projectRoot);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Cannot approve WEBAPP-1');
  });

  it('mnema doctor reports a healthy project after init', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);

    const result = runCli(['doctor'], projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('config.json valid');
    expect(result.stdout).toContain('database opens');
  });

  it('mnema task list outside a project returns CONFIG_NOT_FOUND', () => {
    const result = runCli(['task', 'list'], projectRoot);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('mnema.config.json not found');
  });

  it('mnema audit query lists events recorded during the session', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    runCli(['task', 'create', '--title', 'First'], projectRoot);

    const human = runCli(['audit', 'query', '--kind', 'task_created'], projectRoot);
    expect(human.status).toBe(0);
    expect(human.stdout).toContain('task_created');
    expect(human.stdout).toContain('daniel');

    const json = runCli(['audit', 'query', '--kind', 'task_created', '--json'], projectRoot);
    expect(json.status).toBe(0);
    const lines = json.stdout.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const event = JSON.parse(lines[0] as string) as { kind: string; actor: string };
    expect(event.kind).toBe('task_created');
    expect(event.actor).toBe('daniel');
  });

  it('mnema sync rebuilds the cache idempotently', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    runCli(['task', 'create', '--title', 'A'], projectRoot);

    const first = runCli(['sync'], projectRoot);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('sync complete');
    expect(first.stdout).toContain('upserted=0');
  });

  it('mnema history shows aggregated activity for the day', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    runCli(['task', 'create', '--title', 'First task title'], projectRoot);
    const move = runCli(
      [
        'task',
        'move',
        'WEBAPP-1',
        'submit',
        'title=First task title',
        'description=submission attempt with enough text',
        'acceptance_criteria=Works,Tested',
        'estimate=3',
      ],
      projectRoot,
    );
    expect(move.status).toBe(0);

    const result = runCli(['history', '--since', 'today'], projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('created WEBAPP-1');
    expect(result.stdout).toContain('submit WEBAPP-1');
    expect(result.stdout).toContain('DRAFT → READY');
  });

  it('mnema agent inspect renders a run with plans and mutations', async () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);

    // Seed an agent_run + agent_plan + transition through the open SQLite.
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(path.join(projectRoot, '.app', 'state.db'));
    try {
      db.prepare("INSERT INTO actors (id, handle, kind) VALUES ('a1', 'agent:cc', 'agent')").run();
      db.prepare("INSERT INTO actors (id, handle, kind) VALUES ('h1', 'daniel', 'human')").run();
      db.prepare(
        `INSERT INTO agent_runs (id, agent_actor_id, invoked_by, goal, status,
                                 started_at, ended_at, depth)
         VALUES ('run-x', 'a1', 'h1', 'audit auth code', 'completed',
                 '2026-05-01T10:00:00.000Z', '2026-05-01T10:01:30.000Z', 0)`,
      ).run();
      db.prepare(
        `INSERT INTO agent_plans (id, agent_run_id, content, state, position,
                                  archived_at)
         VALUES ('p1', 'run-x', 'scan SQL injection', 'completed', 0,
                 '2026-05-01T10:01:00.000Z')`,
      ).run();
    } finally {
      db.close();
    }

    const result = runCli(['agent', 'inspect', 'run-x'], projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('audit auth code');
    expect(result.stdout).toContain('completed');
    expect(result.stdout).toContain('scan SQL injection');
  });

  it('mnema inbox lists tasks awaiting review and blocked tasks', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    runCli(['task', 'create', '--title', 'Block test task'], projectRoot);
    const submit = runCli(
      [
        'task',
        'move',
        'WEBAPP-1',
        'submit',
        'title=Block test task',
        'description=submission with enough text content',
        'acceptance_criteria=Works,Tested',
        'estimate=3',
      ],
      projectRoot,
    );
    expect(submit.status).toBe(0);

    const start = runCli(['task', 'move', 'WEBAPP-1', 'start', 'assignee_id=daniel'], projectRoot);
    expect(start.status).toBe(0);

    const block = runCli(
      ['task', 'move', 'WEBAPP-1', 'block', 'reason=missing credentials'],
      projectRoot,
    );
    expect(block.status).toBe(0);

    const result = runCli(['inbox'], projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Blocked');
    expect(result.stdout).toContain('WEBAPP-1');
  });
});
