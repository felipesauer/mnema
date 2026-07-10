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

/** Parses every `hook_ran` event from a project's audit log, in order. */
function readHookRan(projectRoot: string): { data: { outcome: string; exit_code: number } }[] {
  const audit = readFileSync(path.join(projectRoot, '.mnema/audit', 'current.jsonl'), 'utf-8');
  return audit
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
    .filter((e) => e.kind === 'hook_ran');
}

beforeAll(() => {
  if (!existsSync(cliEntry)) {
    throw new Error(`CLI entry not built. Run pnpm build before tests. Path: ${cliEntry}`);
  }
});

// Each test spawns several `node dist/index.js` subprocesses; under the full
// suite the cold-start cost of those spawns can exceed Vitest's 5s default and
// flake. The CLI itself runs in ~0.15s — this timeout covers the spawn
// overhead, not slow logic.
describe('CLI end-to-end', { timeout: 30_000 }, () => {
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
    expect(stdout).toContain('.mnema/mnema.config.json');

    expect(existsSync(path.join(projectRoot, '.mnema/mnema.config.json'))).toBe(true);
    expect(existsSync(path.join(projectRoot, 'AGENTS.md'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.mnema/state', 'state.db'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.mnema/audit', 'current.jsonl'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.mnema/workflows', 'default.json'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.mnema/backlog', 'DRAFT'))).toBe(true);

    const gitignore = readFileSync(path.join(projectRoot, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('.mnema/state/');
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

    const draftFile = path.join(projectRoot, '.mnema/backlog', 'DRAFT', 'WEBAPP-1.md');
    const readyFile = path.join(projectRoot, '.mnema/backlog', 'READY', 'WEBAPP-1.md');
    expect(existsSync(draftFile)).toBe(false);
    expect(existsSync(readyFile)).toBe(true);

    const audit = readFileSync(path.join(projectRoot, '.mnema/audit', 'current.jsonl'), 'utf-8');
    expect(audit).toContain('task_created');
    expect(audit).toContain('task_transitioned');
  });

  it('mnema task move accepts `--field name=value` flags with embedded spaces (H-1)', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    runCli(['task', 'create', '--title', 'Task X'], projectRoot);

    // The `--field` flag is the safe form: shell delivers the whole
    // `name=value with spaces` token intact, so parseFieldArgs sees
    // the full value. This is the fix for H-1 surfaced during the
    // 2026-06-09 dogfooding sprint.
    const move = runCli(
      [
        'task',
        'move',
        'WEBAPP-1',
        'submit',
        '--field',
        'title=Implement OAuth with spaces in title',
        '--field',
        'description=A description that contains multiple words.',
        '--field',
        'acceptance_criteria=Crit one,Crit two',
        '--field',
        'estimate=3',
      ],
      projectRoot,
    );
    expect(move.status).toBe(0);
    expect(move.stdout).toContain('READY');
    expect(move.stdout).toContain('Implement OAuth with spaces in title');
  });

  it('mnema task move on an invalid action returns a structured error', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    runCli(['task', 'create', '--title', 'Task X'], projectRoot);

    const result = runCli(['task', 'move', 'WEBAPP-1', 'approve'], projectRoot);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Cannot approve WEBAPP-1');
  });

  it('mnema task list --state rejects a state foreign to the active workflow', () => {
    // lean has TODO | DOING | DONE — `DRAFT` is the default workflow's
    // initial state and must not silently return an empty list here.
    runCli(['init', '--name', 'Lean App', '--key', 'LEAN', '--workflow', 'lean'], projectRoot);

    const valid = runCli(['task', 'list', '--state', 'TODO'], projectRoot);
    expect(valid.status).toBe(0);

    const invalid = runCli(['task', 'list', '--state', 'DRAFT'], projectRoot);
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain('Unknown state');
    expect(invalid.stderr).toContain('lean');
    expect(invalid.stderr).toContain('TODO');
  });

  it('domain-event hooks require human approval, run as argv (no shell), and are non-fatal', () => {
    // Isolate the out-of-repo approval store (~/.config/mnema) inside the
    // temp project so `mnema hooks approve` can be exercised hermetically.
    const hookEnv = { HOME: projectRoot, USERPROFILE: projectRoot };
    runCli(['init', '--name', 'Lean App', '--key', 'LEAN', '--workflow', 'lean'], projectRoot);

    // A capture hook that writes its stdin (the event JSON) to a file, and
    // a second hook that fails — proving a failing hook is audited but never
    // breaks the transition. Both are argv arrays: the capture uses a tiny
    // node one-liner because there is no shell to do redirection anymore.
    const configPath = path.join(projectRoot, '.mnema/mnema.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const capturePath = path.join(projectRoot, 'hook-out.json');
    const captureScript = `require('fs').writeFileSync(process.argv[1],require('fs').readFileSync(0));`;
    config.hooks = {
      on_task_done: [
        { command: 'node', args: ['-e', captureScript, capturePath] },
        { command: 'node', args: ['-e', 'process.exit(7)'] },
      ],
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    // --- Phase 1: un-approved block is INERT (MNEMA-100 regression) ---
    runCli(['task', 'create', '--title', 'Ship it'], projectRoot);
    runCli(['task', 'move', 'LEAN-1', 'start'], projectRoot);
    const doneUnapproved = runCli(['task', 'move', 'LEAN-1', 'complete'], projectRoot, hookEnv);
    expect(doneUnapproved.status).toBe(0);
    expect(existsSync(capturePath)).toBe(false); // nothing executed

    const auditAfterUnapproved = readHookRan(projectRoot);
    expect(auditAfterUnapproved).toHaveLength(2); // both attempts recorded...
    expect(auditAfterUnapproved.every((e) => e.data.outcome === 'skipped')).toBe(true); // ...as skipped

    // doctor flags the configured-but-unapproved block as not-ok.
    const doctorUnapproved = runCli(['doctor'], projectRoot, hookEnv);
    expect(doctorUnapproved.stdout).toContain('NOT approved');

    // --- Phase 2: after human approval, the same block RUNS ---
    const approve = runCli(['hooks', 'approve'], projectRoot, hookEnv);
    expect(approve.status).toBe(0);

    // The approval is attested on the audit chain, not just on disk.
    const auditLog = readFileSync(path.join(projectRoot, '.mnema/audit', 'current.jsonl'), 'utf-8');
    expect(auditLog).toContain('"kind":"hooks_approved"');

    runCli(['task', 'create', '--title', 'Ship it again'], projectRoot);
    runCli(['task', 'move', 'LEAN-2', 'start'], projectRoot);
    const done = runCli(['task', 'move', 'LEAN-2', 'complete'], projectRoot, hookEnv);
    expect(done.status).toBe(0);
    expect(done.stdout).toContain('DONE');

    // The capture hook received the triggering event as JSON on stdin.
    expect(existsSync(capturePath)).toBe(true);
    const payload = JSON.parse(readFileSync(capturePath, 'utf-8'));
    expect(payload.kind).toBe('task_transitioned');
    expect(payload.data.to).toBe('DONE');

    // The second firing set has one completed and one failed (exit 7).
    const runFirings = readHookRan(projectRoot).filter((e) => e.data.outcome !== 'skipped');
    expect(runFirings.some((e) => e.data.outcome === 'completed' && e.data.exit_code === 0)).toBe(
      true,
    );
    expect(runFirings.some((e) => e.data.outcome === 'failed' && e.data.exit_code === 7)).toBe(
      true,
    );
  });

  it('mnema doctor reports a healthy project after init', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);

    const result = runCli(['doctor'], projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('config.json valid');
    expect(result.stdout).toContain('database opens');
  });

  it('the demo flow still runs against the current CLI (guards docs/quickstart.cast)', () => {
    // Runs scripts/make-cast.mjs, which drives scripts/demo-flow.sh through
    // the REAL binary. If a demo command goes stale (renamed flag, new
    // required field) the generated cast loses the arc and this fails —
    // catching demo rot that a committed .cast would otherwise hide.
    const castOut = path.join(projectRoot, 'demo.cast');
    const gen = spawnSync('node', [path.join(repoRoot, 'scripts', 'make-cast.mjs')], {
      env: { ...process.env, CAST_OUT: castOut, MNEMA_ACTOR: 'you' },
      encoding: 'utf-8',
    });
    expect(gen.status, gen.stderr).toBe(0);

    // Decode the cast's terminal output and assert the whole arc is present.
    // Build the ANSI-escape matcher from the ESC code point so the source
    // carries no literal control character.
    const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
    const frames = readFileSync(castOut, 'utf-8')
      .split('\n')
      .slice(1)
      .filter((l) => l.length > 0)
      .map((l) => (JSON.parse(l) as [number, string, string])[2])
      .join('')
      .replace(ansi, '');
    expect(frames).toContain('mnema init');
    expect(frames).toContain('Add rate limiting');
    expect(frames).toContain('audit hash chain  verified'); // doctor green
    expect(frames).toContain('hash mismatch'); // tamper caught
  });

  it('mnema commit keeps staged partial edits and never commits unstaged ones', () => {
    // Real-git test: mocks can't catch pathspec-vs-index semantics, so drive
    // the actual binary against a real repo.
    const git = (...args: string[]) =>
      spawnSync('git', args, { cwd: projectRoot, encoding: 'utf-8' });
    git('init');
    git('config', 'user.email', 't@t.co');
    git('config', 'user.name', 't');
    runCli(['init', '--name', 'Commit App', '--key', 'CMT'], projectRoot);
    writeFileSync(path.join(projectRoot, 'app.js'), 'line1\nline2\nline3\n');
    git('add', '-A');
    git('commit', '-m', 'base');

    // Stage a line1 change, then make a further UNSTAGED edit to line3, and
    // create task churn under .mnema/.
    writeFileSync(path.join(projectRoot, 'app.js'), 'LINE1\nline2\nline3\n');
    git('add', 'app.js');
    writeFileSync(path.join(projectRoot, 'app.js'), 'LINE1\nline2\nLINE3-unstaged\n');
    runCli(['task', 'create', '--title', 'Churn'], projectRoot);

    const res = runCli(['commit', '-m', 'feat: line1'], projectRoot);
    expect(res.status).toBe(0);

    // Two commits: code on top, trail beneath.
    const log = spawnSync('git', ['log', '--oneline', '-2', '--format=%s'], {
      cwd: projectRoot,
      encoding: 'utf-8',
    })
      .stdout.trim()
      .split('\n');
    expect(log[0]).toBe('feat: line1');
    expect(log[1]).toBe('chore(mnema): update trail');

    // The committed code has ONLY the staged line1 change, NOT the unstaged one.
    const committed = spawnSync('git', ['show', 'HEAD:app.js'], {
      cwd: projectRoot,
      encoding: 'utf-8',
    }).stdout;
    expect(committed).toContain('LINE1');
    expect(committed).not.toContain('LINE3-unstaged');

    // The unstaged edit is preserved in the working tree.
    expect(readFileSync(path.join(projectRoot, 'app.js'), 'utf-8')).toContain('LINE3-unstaged');

    // The trail commit does not touch app.js.
    const trailStat = spawnSync('git', ['show', '--stat', '--format=', 'HEAD~1'], {
      cwd: projectRoot,
      encoding: 'utf-8',
    }).stdout;
    expect(trailStat).not.toContain('app.js');
    expect(trailStat).toContain('.mnema');
  });

  it('mnema commit refuses to run mid-merge', () => {
    const git = (...args: string[]) =>
      spawnSync('git', args, { cwd: projectRoot, encoding: 'utf-8' });
    git('init');
    git('config', 'user.email', 't@t.co');
    git('config', 'user.name', 't');
    runCli(['init', '--name', 'Merge App', '--key', 'MRG'], projectRoot);
    git('add', '-A');
    git('commit', '-m', 'base');
    // Build two divergent branches that both edit conflict.txt.
    writeFileSync(path.join(projectRoot, 'conflict.txt'), 'A\n');
    git('add', '-A');
    git('commit', '-m', 'a');
    git('checkout', '-b', 'other', 'HEAD~1');
    writeFileSync(path.join(projectRoot, 'conflict.txt'), 'B\n');
    git('add', '-A');
    git('commit', '-m', 'b');
    git('merge', 'master'); // conflicts, leaves MERGE_HEAD

    const res = runCli(['commit', '-m', 'during merge'], projectRoot);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('merge is in progress');
  });

  it('mnema upgrade rebuilds a missing task mirror and prunes an orphan', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    runCli(['task', 'create', '--title', 'Real task'], projectRoot);

    const draftDir = path.join(projectRoot, '.mnema/backlog', 'DRAFT');
    const realMirror = path.join(draftDir, 'WEBAPP-1.md');
    const orphanMirror = path.join(draftDir, 'WEBAPP-999.md');
    expect(existsSync(realMirror)).toBe(true);

    // Simulate drift: the real task's mirror vanished; a stray orphan lingers.
    rmSync(realMirror);
    writeFileSync(orphanMirror, '---\n---\nstray', 'utf-8');

    // doctor surfaces both before the fix.
    const doctor = runCli(['doctor'], projectRoot);
    expect(doctor.stdout).toContain('tasks mirrored');
    expect(doctor.stdout).toContain('missing files: WEBAPP-1');
    expect(doctor.stdout).toContain('orphan files: WEBAPP-999');

    const upgrade = runCli(['upgrade', '--yes'], projectRoot);
    expect(upgrade.status).toBe(0);
    expect(upgrade.stdout).toContain('rebuilt 1 mirror file(s)');
    expect(upgrade.stdout).toContain('pruned 1 orphan mirror file(s)');

    // The real mirror is back; the orphan is gone.
    expect(existsSync(realMirror)).toBe(true);
    expect(existsSync(orphanMirror)).toBe(false);
  });

  it('mnema doctor --rebuild-mirrors recreates a missing task mirror and prunes an orphan', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    runCli(['task', 'create', '--title', 'Real task'], projectRoot);

    const draftDir = path.join(projectRoot, '.mnema/backlog', 'DRAFT');
    const realMirror = path.join(draftDir, 'WEBAPP-1.md');
    const orphanMirror = path.join(draftDir, 'WEBAPP-999.md');

    // Simulate drift: the real task's mirror vanished; a stray orphan lingers.
    rmSync(realMirror);
    writeFileSync(orphanMirror, '---\n---\nstray', 'utf-8');

    const rebuild = runCli(['doctor', '--rebuild-mirrors', '--prune-orphans'], projectRoot);
    expect(rebuild.status).toBe(0);
    expect(rebuild.stdout).toContain('tasks mirrored: 1 — WEBAPP-1');
    expect(rebuild.stdout).toContain('tasks pruned: 1 — WEBAPP-999');

    // The real mirror is back; the orphan is gone.
    expect(existsSync(realMirror)).toBe(true);
    expect(existsSync(orphanMirror)).toBe(false);
  });

  it('mnema init scaffolds the .mnema/commands directory', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    expect(existsSync(path.join(projectRoot, '.mnema/commands'))).toBe(true);
  });

  it('mnema commands list discovers a versioned command', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    writeFileSync(
      path.join(projectRoot, '.mnema/commands', 'standup.md'),
      '---\ndescription: Daily standup\nsteps:\n  - inbox\n  - history --since=today\n---\n# Standup\n',
      'utf-8',
    );

    const result = runCli(['commands', 'list'], projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('standup');
    expect(result.stdout).toContain('Daily standup');

    const show = runCli(['commands', 'show', 'standup'], projectRoot);
    expect(show.stdout).toContain('mnema inbox');
    expect(show.stdout).toContain('mnema history --since=today');
  });

  it('mnema mcp install-instructions mentions versioned slash commands', () => {
    const result = runCli(['mcp', 'install-instructions', 'claude-code'], projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('.mnema/commands/');
    expect(result.stdout).toContain('commands_list');
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
    runCli(['task', 'create', '--title', 'Task A'], projectRoot);

    const first = runCli(['sync'], projectRoot);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('sync complete');
    // The task already exists in the DB, so the rebuild scans it but
    // upserts nothing (counts are reported as scanned/upserted).
    expect(first.stdout).toContain('tasks=1/0');
  });

  it('mnema upgrade brings an out-of-date project current, then is idempotent', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);

    // Simulate a project initialised by an older Mnema: roll mnema_version
    // back so `upgrade` has something concrete to do.
    const configPath = path.join(projectRoot, '.mnema', 'mnema.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as { mnema_version: string };
    const stale = { ...config, mnema_version: '^0.0.1-alpha.0' };
    writeFileSync(configPath, `${JSON.stringify(stale, null, 2)}\n`, 'utf-8');

    const first = runCli(['upgrade', '--yes'], projectRoot);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('set mnema_version');
    const after = JSON.parse(readFileSync(configPath, 'utf-8')) as { mnema_version: string };
    expect(after.mnema_version).not.toBe('^0.0.1-alpha.0');

    // Running again has nothing left to do.
    const second = runCli(['upgrade', '--yes'], projectRoot);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('already up to date');
  });

  it('mnema upgrade applies a pending migration before inspecting the rest', async () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);

    // A project-local migration the runner will see as pending. The
    // upgrade must apply it (phase 1) before it reads any domain table
    // for the mirror/AGENTS inspection (phase 2) — otherwise a migration
    // that creates a table would make that inspection crash with
    // "no such table". The bumped mnema_version gives phase 2 work to do.
    const migrationsDir = path.join(projectRoot, '.mnema', 'migrations');
    mkdirSync(migrationsDir, { recursive: true });
    writeFileSync(
      path.join(migrationsDir, '900_upgrade_probe.sql'),
      'CREATE TABLE IF NOT EXISTS upgrade_probe (id INTEGER PRIMARY KEY);\n',
      'utf-8',
    );
    const configPath = path.join(projectRoot, '.mnema', 'mnema.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as { mnema_version: string };
    writeFileSync(
      configPath,
      `${JSON.stringify({ ...config, mnema_version: '^0.0.1-alpha.0' }, null, 2)}\n`,
      'utf-8',
    );

    const result = runCli(['upgrade', '--yes'], projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('applied 1 migration');
    expect(result.stdout).toContain('set mnema_version');
    expect(result.stderr).not.toContain('no such table');

    // Prove the migration actually hit the schema (phase 1), not just the
    // stdout — the table the pending migration creates now exists.
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(path.join(projectRoot, '.mnema/state', 'state.db'));
    try {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='upgrade_probe'")
        .get() as { name: string } | undefined;
      expect(row?.name).toBe('upgrade_probe');
    } finally {
      db.close();
    }

    // And phase 2 ran against the now-current schema: the version was bumped.
    const finalConfig = JSON.parse(readFileSync(configPath, 'utf-8')) as { mnema_version: string };
    expect(finalConfig.mnema_version).not.toBe('^0.0.1-alpha.0');
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

  it('mnema task history shows the audit trail of a single task', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    runCli(['task', 'create', '--title', 'Target task'], projectRoot);
    runCli(['task', 'create', '--title', 'Other task'], projectRoot);
    const move = runCli(
      [
        'task',
        'move',
        'WEBAPP-1',
        'submit',
        'title=Target task',
        'description=submission attempt with enough text',
        'acceptance_criteria=Works,Tested',
        'estimate=3',
      ],
      projectRoot,
    );
    expect(move.status).toBe(0);

    const human = runCli(['task', 'history', 'WEBAPP-1'], projectRoot);
    expect(human.status).toBe(0);
    expect(human.stdout).toContain('created WEBAPP-1');
    expect(human.stdout).toContain('submit WEBAPP-1');
    expect(human.stdout).not.toContain('WEBAPP-2');

    const json = runCli(['task', 'history', 'WEBAPP-1', '--json'], projectRoot);
    expect(json.status).toBe(0);
    const lines = json.stdout.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      const event = JSON.parse(line) as { data: { key?: string; task_key?: string } };
      const key = event.data.key ?? event.data.task_key;
      expect(key).toBe('WEBAPP-1');
    }

    const missing = runCli(['task', 'history', 'WEBAPP-999'], projectRoot);
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('WEBAPP-999');
  });

  it('mnema agent inspect renders a run with plans and per-task mutations', async () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);

    // Seed an agent_run + agent_plan + two transitions touching two
    // separate tasks, so we can verify that the mutation lines carry
    // the human task key (the renderer used to print internal task UUIDs).
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(path.join(projectRoot, '.mnema/state', 'state.db'));
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

      // Two tasks touched by the same run (uses the project seeded by
      // `init` above so the FK to projects is satisfied).
      const projectId = (db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string }).id;
      db.prepare(
        `INSERT INTO tasks (id, key, project_id, title, reporter_id, state)
         VALUES ('t-7', 'WEBAPP-7', ?, 'Login flow', 'h1', 'TODO')`,
      ).run(projectId);
      db.prepare(
        `INSERT INTO tasks (id, key, project_id, title, reporter_id, state)
         VALUES ('t-9', 'WEBAPP-9', ?, 'Token refresh', 'h1', 'DOING')`,
      ).run(projectId);

      db.prepare(
        `INSERT INTO transitions (id, task_id, from_state, to_state, action,
                                  payload, actor_id, agent_run_id, at)
         VALUES ('tr1', 't-7', NULL, 'TODO', 'create', '{}', 'h1', 'run-x',
                 '2026-05-01T10:00:30.000Z')`,
      ).run();
      db.prepare(
        `INSERT INTO transitions (id, task_id, from_state, to_state, action,
                                  payload, actor_id, agent_run_id, at)
         VALUES ('tr2', 't-9', 'TODO', 'DOING', 'start', '{}', 'h1', 'run-x',
                 '2026-05-01T10:00:45.000Z')`,
      ).run();
    } finally {
      db.close();
    }

    const result = runCli(['agent', 'inspect', 'run-x'], projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('audit auth code');
    expect(result.stdout).toContain('completed');
    expect(result.stdout).toContain('scan SQL injection');
    expect(result.stdout).toContain('Mutations (2)');
    // Each mutation line must carry the human task key, so that runs
    // touching multiple tasks are still readable.
    expect(result.stdout).toContain('WEBAPP-7');
    expect(result.stdout).toContain('WEBAPP-9');
    // And the actions still appear next to their respective keys.
    expect(result.stdout).toMatch(/create\s+WEBAPP-7/);
    expect(result.stdout).toMatch(/start\s+WEBAPP-9/);
  });

  it('mnema agent resume reopens an aborted run and lists open items', async () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(path.join(projectRoot, '.mnema/state', 'state.db'));
    try {
      db.prepare("INSERT INTO actors (id, handle, kind) VALUES ('a1', 'agent:cc', 'agent')").run();
      db.prepare("INSERT INTO actors (id, handle, kind) VALUES ('h1', 'daniel', 'human')").run();
      db.prepare(
        `INSERT INTO agent_runs (id, agent_actor_id, invoked_by, goal, status,
                                 error, started_at, ended_at, depth)
         VALUES ('run-i', 'a1', 'h1', 'interrupted audit', 'aborted',
                 'session dropped', '2026-05-01T10:00:00.000Z',
                 '2026-05-01T10:00:30.000Z', 0)`,
      ).run();
      // An unfinished plan step — should surface as an open item.
      db.prepare(
        `INSERT INTO agent_plans (id, agent_run_id, content, state, position)
         VALUES ('p1', 'run-i', 'finish the auth sweep', 'in_progress', 0)`,
      ).run();
    } finally {
      db.close();
    }

    const result = runCli(['agent', 'resume', 'run-i'], projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Resumed run');
    expect(result.stdout).toContain('running');
    expect(result.stdout).toContain('Open items (1)');
    expect(result.stdout).toContain('finish the auth sweep');

    // A completed run cannot be resumed.
    const db2 = new Database(path.join(projectRoot, '.mnema/state', 'state.db'));
    try {
      db2
        .prepare(
          `INSERT INTO agent_runs (id, agent_actor_id, invoked_by, goal, status,
                                   started_at, ended_at, depth)
           VALUES ('run-done', 'a1', 'h1', 'done', 'completed',
                   '2026-05-01T09:00:00.000Z', '2026-05-01T09:05:00.000Z', 0)`,
        )
        .run();
    } finally {
      db2.close();
    }
    const rejected = runCli(['agent', 'resume', 'run-done'], projectRoot);
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain('cannot be resumed');
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

  it('mnema sprint plan/start/add/show flow works', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    runCli(['task', 'create', '--title', 'Implement OAuth login'], projectRoot);

    const plan = runCli(
      ['sprint', 'plan', '--name', 'Sprint 1', '--goal', 'ship auth'],
      projectRoot,
    );
    expect(plan.status).toBe(0);
    expect(plan.stdout).toContain('WEBAPP-SPRINT-1');
    expect(plan.stdout).toContain('PLANNED');

    const start = runCli(['sprint', 'start', 'WEBAPP-SPRINT-1'], projectRoot);
    expect(start.status).toBe(0);
    expect(start.stdout).toContain('ACTIVE');

    const add = runCli(['sprint', 'add', 'WEBAPP-SPRINT-1', 'WEBAPP-1'], projectRoot);
    expect(add.status).toBe(0);

    const show = runCli(['sprint', 'show', 'WEBAPP-SPRINT-1'], projectRoot);
    expect(show.status).toBe(0);
    expect(show.stdout).toContain('Sprint 1');
    expect(show.stdout).toContain('WEBAPP-1');
  });

  it('mnema search returns matching tasks across FTS5', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    runCli(['task', 'create', '--title', 'Implement OAuth login flow'], projectRoot);
    runCli(['task', 'create', '--title', 'Improve dashboard latency'], projectRoot);

    const result = runCli(['search', 'oauth'], projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('WEBAPP-1');
    expect(result.stdout).not.toContain('WEBAPP-2');
  });

  it('mnema attach add stores a file and lists it back, deduplicated', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    runCli(['task', 'create', '--title', 'Task with file'], projectRoot);

    const samplePath = path.join(projectRoot, 'sample.txt');
    writeFileSync(samplePath, 'attachment content\n', 'utf-8');

    const first = runCli(['attach', 'add', 'WEBAPP-1', 'sample.txt'], projectRoot);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('sample.txt attached');

    const second = runCli(['attach', 'add', 'WEBAPP-1', 'sample.txt'], projectRoot);
    expect(second.status).toBe(0);

    const stored = readdirSync(path.join(projectRoot, '.mnema/state', 'attachments'));
    expect(stored).toHaveLength(1);

    const list = runCli(['attach', 'list', 'WEBAPP-1'], projectRoot);
    expect(list.status).toBe(0);
    expect(list.stdout).toContain('sample.txt');
  });

  it('mnema init --minimal creates only the essentials', () => {
    const result = runCli(
      ['init', '--name', 'Web App', '--key', 'WEBAPP', '--minimal'],
      projectRoot,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('minimal layout');

    expect(existsSync(path.join(projectRoot, '.mnema/mnema.config.json'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.mnema/state', 'state.db'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.mnema/workflows', 'default.json'))).toBe(true);
    expect(existsSync(path.join(projectRoot, 'AGENTS.md'))).toBe(true);

    // The full layout's content folders are NOT created in minimal mode.
    expect(existsSync(path.join(projectRoot, '.mnema/backlog'))).toBe(false);
    expect(existsSync(path.join(projectRoot, '.mnema/sprints'))).toBe(false);
    expect(existsSync(path.join(projectRoot, '.mnema/memory'))).toBe(false);
    expect(existsSync(path.join(projectRoot, '.mnema/skills'))).toBe(false);
    expect(existsSync(path.join(projectRoot, '.mnema/roadmap'))).toBe(false);
  });

  it('mnema init tolerates pre-existing content directories like backlog/', () => {
    // Conflict detection only fires for *files* mnema would overwrite
    // (AGENTS.md, state.db, current.jsonl, the chosen workflow JSON).
    // Bare directories that the user might already maintain — backlog/,
    // memory/, sprints/, etc. — should not abort the init.
    mkdirSync(path.join(projectRoot, '.mnema/backlog'), { recursive: true });

    const result = runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    expect(result.status).toBe(0);
    expect(existsSync(path.join(projectRoot, '.mnema/mnema.config.json'))).toBe(true);
  });

  it('mnema init appends a managed block to a pre-existing AGENTS.md', () => {
    // A user who has hand-tuned the file should keep their edits;
    // init bolts the Mnema-managed block on at the end (delimited by
    // <!-- MNEMA:START --> ... <!-- MNEMA:END --> markers) so a
    // subsequent destroy can strip it cleanly without touching the
    // user's content.
    const original = '# my hand-written AGENTS\n\nCustom instructions for Claude.\n';
    writeFileSync(path.join(projectRoot, 'AGENTS.md'), original, 'utf-8');

    const result = runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    expect(result.status).toBe(0);

    const merged = readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf-8');
    expect(merged).toContain('# my hand-written AGENTS');
    expect(merged).toContain('Custom instructions for Claude.');
    expect(merged).toContain('<!-- MNEMA:START -->');
    expect(merged).toContain('<!-- MNEMA:END -->');
  });

  it('mnema adopt all is idempotent and adds skills/memory/roadmap', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP', '--minimal'], projectRoot);

    const first = runCli(['adopt', 'all'], projectRoot);
    expect(first.status).toBe(0);
    expect(existsSync(path.join(projectRoot, '.mnema/skills', 'SKILL.md'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.mnema/memory', 'INDEX.md'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.mnema/roadmap', 'README.md'))).toBe(true);

    const second = runCli(['adopt', 'all'], projectRoot);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('created=0');
  });

  it('mnema import markdown ingests headings as tasks', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);

    const todoPath = path.join(projectRoot, 'TODO.md');
    writeFileSync(
      todoPath,
      [
        '## DRAFT Implement OAuth login',
        '',
        'Add Google flow.',
        '',
        '- AC 1',
        '- AC 2',
        '',
        '## DRAFT Refactor session middleware',
        '',
        'Reescrever a camada de sessão.',
      ].join('\n'),
      'utf-8',
    );

    const result = runCli(['import', 'markdown', '--from', 'TODO.md'], projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('tasks_created=2');

    const list = runCli(['task', 'list'], projectRoot);
    expect(list.stdout).toContain('Implement OAuth login');
    expect(list.stdout).toContain('Refactor session middleware');
  });

  it('mnema skill lint passes on the canonical templates', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);

    const result = runCli(['skill', 'lint'], projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('lint clean');
  });

  it('mnema skill lint flags unknown tool references and missing example', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    writeFileSync(
      path.join(projectRoot, '.mnema/skills', 'broken.md'),
      [
        '---',
        'name: broken',
        'version: 1.0.0',
        'description: Bad references should be caught.',
        'tools_used:',
        '  - mystery_tool',
        '---',
        '',
        '# Broken',
        '',
        'No example section.',
      ].join('\n'),
      'utf-8',
    );

    const result = runCli(['skill', 'lint'], projectRoot);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('mystery_tool');
    expect(result.stdout).toContain('warning:');
  });

  it('mnema memory consolidate regenerates the indices and is idempotent', () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);

    const first = runCli(['memory', 'consolidate'], projectRoot);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('memory:');
    expect(first.stdout).toContain('decisions:');

    const indexBody = readFileSync(path.join(projectRoot, '.mnema/memory', 'INDEX.md'), 'utf-8');
    expect(indexBody).toContain('<!-- MNEMA: managed section');

    const second = runCli(['memory', 'consolidate'], projectRoot);
    expect(second.status).toBe(0);
    const indexAfter = readFileSync(path.join(projectRoot, '.mnema/memory', 'INDEX.md'), 'utf-8');
    expect(indexAfter).toBe(indexBody);
  });

  it('migration guard: read-only commands work but mutations abort when schema drifts', async () => {
    runCli(['init', '--name', 'Drift', '--key', 'DRIFT'], projectRoot);

    // Simulate drift by stamping a fake future version into
    // schema_migrations (without dropping anything). This way the
    // runner sees disk vs db disagreement without any real migration
    // having been "lost", so the subsequent `mnema migrate` doesn't
    // try to re-apply a non-idempotent ALTER TABLE.
    //
    // We pick version 999, well beyond current real versions, and
    // drop it before running migrate so the runner has nothing to do.
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(path.join(projectRoot, '.mnema/state', 'state.db'));
    let fakeVersion = 999;
    try {
      const versions = db
        .prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1')
        .all() as Array<{ version: number }>;
      const latest = versions[0]?.version;
      expect(latest).toBeDefined();
      // Drop the latest applied row to simulate "i pulled the schema
      // bump but forgot to migrate". Re-applying a non-idempotent
      // migration would crash, so we use a tactic that lets `migrate`
      // become a no-op below.
      db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(latest);
      fakeVersion = latest as number;
    } finally {
      db.close();
    }

    // Read-only command still works under drift.
    const list = runCli(['task', 'list'], projectRoot);
    expect(list.status).toBe(0);

    // Mutating command refuses with exit 3 (State) and a clear hint.
    const create = runCli(['task', 'create', '--title', 'Should fail'], projectRoot);
    expect(create.status).toBe(3);
    expect(create.stderr).toContain('Schema is out of date');
    expect(create.stderr).toContain('mnema migrate');

    // Restore the row before running migrate so the runner has
    // nothing to apply (avoids re-running a non-idempotent migration).
    const db2 = new Database(path.join(projectRoot, '.mnema/state', 'state.db'));
    try {
      db2
        .prepare(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        )
        .run(fakeVersion);
    } finally {
      db2.close();
    }

    // After restore, mutations succeed again (drift gone).
    const create2 = runCli(['task', 'create', '--title', 'Now OK'], projectRoot);
    expect(create2.status).toBe(0);
  });

  it('memory record --derived-from-decision records a decision→memory provenance edge', async () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);

    // Record an ADR to derive the memory from.
    const dec = runCli(
      ['decision', 'record', '--title', 'Adopt X', '--decision', 'use X'],
      projectRoot,
    );
    expect(dec.status).toBe(0);
    // Extract the ADR key from the success line (strip ANSI colour codes).
    const decisionKey = dec.stdout.replace(/\[[0-9;]*m/g, '').match(/([A-Z]+-ADR-\d+)/)?.[1];
    expect(decisionKey).toBeDefined();

    // Record a memory derived from that decision via the new CLI flag.
    const mem = runCli(
      [
        'memory',
        'record',
        'x-fact',
        '--title',
        'X fact',
        '--content',
        'X is now the standard',
        '--derived-from-decision',
        decisionKey as string,
      ],
      projectRoot,
    );
    expect(mem.status).toBe(0);

    // The decision→memory edge exists in provenance_links.
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(path.join(projectRoot, '.mnema/state', 'state.db'));
    try {
      const edge = db
        .prepare(
          'SELECT 1 FROM provenance_links WHERE source_kind = ? AND source_ref = ? AND target_kind = ? AND target_ref = ?',
        )
        .get('decision', decisionKey, 'memory', 'x-fact');
      expect(edge).toBeDefined();
    } finally {
      db.close();
    }
  });

  it('memory record WITHOUT the flag records no provenance edge', async () => {
    runCli(['init', '--name', 'Web App', '--key', 'WEBAPP'], projectRoot);
    const mem = runCli(
      ['memory', 'record', 'plain-fact', '--title', 'Plain', '--content', 'no provenance'],
      projectRoot,
    );
    expect(mem.status).toBe(0);

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(path.join(projectRoot, '.mnema/state', 'state.db'));
    try {
      const edges = db
        .prepare('SELECT COUNT(*) AS n FROM provenance_links WHERE target_ref = ?')
        .get('plain-fact') as { n: number };
      expect(edges.n).toBe(0);
    } finally {
      db.close();
    }
  });
});
