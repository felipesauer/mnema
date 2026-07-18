import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ErrorCode } from '@mnema/core/errors/error-codes.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _internal, InitCommand } from '@/cli/commands/init-command.js';

/** Restores an env var to its prior value, or deletes it if it was unset. */
function restoreEnv(key: string, prev: string | undefined): void {
  if (prev === undefined) delete process.env[key];
  else process.env[key] = prev;
}

describe('InitCommand.run (silent mode)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-init-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('writes mnema.config.json with the supplied fields', () => {
    const result = new InitCommand().run({
      cwd: projectRoot,
      name: 'My App',
      key: 'MYAPP',
      workflow: 'default',
      force: false,
      minimal: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const config = JSON.parse(readFileSync(result.value.configPath, 'utf-8')) as Record<
      string,
      unknown
    >;
    expect((config.project as { key: string }).key).toBe('MYAPP');
    expect((config.project as { name: string }).name).toBe('My App');
    // The workflow field is gone from the config: only `default` exists
    // and the runtime loads it unconditionally.
    expect('workflow' in config).toBe(false);
    expect(existsSync(path.join(projectRoot, '.mnema', 'state', 'state.db'))).toBe(true);
  });

  it('embeds the memory index in AGENTS.md in one pass (full mode)', () => {
    const result = new InitCommand().run({
      cwd: projectRoot,
      name: 'My App',
      key: 'MYAPP',
      workflow: 'default',
      force: false,
      minimal: false,
    });
    expect(result.ok).toBe(true);

    // The memory index was seeded …
    expect(existsSync(path.join(projectRoot, '.mnema', 'memory', 'INDEX.md'))).toBe(true);
    // … and AGENTS.md embedded it on this first write — never the degraded
    // "skipped — file not found" note a second `agents sync` would fix.
    const agents = readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('# Memory index');
    expect(agents).not.toContain('file not found');
  });

  it('reports identityConfigured=false when no actor is resolvable', () => {
    const prevActor = process.env.MNEMA_ACTOR;
    const prevHome = process.env.HOME;
    const prevProfile = process.env.USERPROFILE;
    // Isolate HOME so resolveDefaultActor cannot read the developer's real
    // ~/.config/mnema/identity.json, and clear the env actor.
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'mnema-home-'));
    process.env.MNEMA_ACTOR = '';
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    try {
      const result = new InitCommand().run({
        cwd: projectRoot,
        name: 'No Id',
        key: 'NOID',
        workflow: 'default',
        force: false,
        minimal: false,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.identityConfigured).toBe(false);
    } finally {
      restoreEnv('MNEMA_ACTOR', prevActor);
      restoreEnv('HOME', prevHome);
      restoreEnv('USERPROFILE', prevProfile);
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('reports identityConfigured=true when MNEMA_ACTOR is set', () => {
    const prev = process.env.MNEMA_ACTOR;
    process.env.MNEMA_ACTOR = 'alice';
    try {
      const result = new InitCommand().run({
        cwd: projectRoot,
        name: 'Has Id',
        key: 'HASID',
        workflow: 'default',
        force: false,
        minimal: false,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.identityConfigured).toBe(true);
    } finally {
      restoreEnv('MNEMA_ACTOR', prev);
    }
  });

  it('the audit-only profile is a pure config shortcut (features.knowledge off)', () => {
    const result = new InitCommand().run({
      cwd: projectRoot,
      name: 'Audit App',
      key: 'AO',
      profile: 'audit-only',
      force: false,
      minimal: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const config = JSON.parse(readFileSync(result.value.configPath, 'utf-8')) as {
      workflow: string;
      features?: { knowledge?: boolean };
    };
    expect(config.features?.knowledge).toBe(false);
  });

  it('the default (full) profile leaves the knowledge feature on', () => {
    const result = new InitCommand().run({
      cwd: projectRoot,
      name: 'Full App',
      key: 'FULL',
      workflow: 'default',
      force: false,
      minimal: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const config = JSON.parse(readFileSync(result.value.configPath, 'utf-8')) as {
      features: { knowledge: boolean };
    };
    // Schema default applies — knowledge stays on unless audit-only turned it off.
    expect(config.features.knowledge).toBe(true);
  });

  it('refuses to overwrite an existing config without --force', () => {
    const command = new InitCommand();
    command.run({
      cwd: projectRoot,
      name: 'X',
      key: 'X1',
      workflow: 'default',
      force: false,
      minimal: false,
    });

    const second = command.run({
      cwd: projectRoot,
      name: 'X',
      key: 'X1',
      workflow: 'default',
      force: false,
      minimal: false,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe(ErrorCode.AlreadyInitialized);
  });

  it('rejects an invalid project key', () => {
    const result = new InitCommand().run({
      cwd: projectRoot,
      name: 'X',
      key: 'lowercase',
      workflow: 'default',
      force: false,
      minimal: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.ConfigInvalid);
  });

  it('scaffolds a .gitignore that ignores only the local state cache', () => {
    new InitCommand().run({
      cwd: projectRoot,
      name: 'X',
      key: 'X1',
      workflow: 'default',
      force: false,
      minimal: false,
    });
    const gitignore = readFileSync(path.join(projectRoot, '.gitignore'), 'utf-8');
    // The cache is ignored…
    expect(gitignore).toContain('.mnema/state/');
    // …and so is the personal per-repo override…
    expect(gitignore).toContain('.mnema/config.local.json');
    // …but the versioned mirror and audit log are NOT.
    expect(gitignore).not.toMatch(/^\.mnema\/backlog\/?$/m);
    expect(gitignore).not.toMatch(/^\.mnema\/audit\/?$/m);
    expect(gitignore).not.toMatch(/^\.mnema\/?$/m);
  });

  it('scaffolds a .gitattributes giving the audit log a union merge driver', () => {
    new InitCommand().run({
      cwd: projectRoot,
      name: 'X',
      key: 'X1',
      workflow: 'default',
      force: false,
      minimal: false,
    });
    const attrs = readFileSync(path.join(projectRoot, '.gitattributes'), 'utf-8');
    expect(attrs).toContain('.mnema/audit/**/*.jsonl merge=union');
  });

  it('does not duplicate the gitignore/gitattributes blocks on a second init --force', () => {
    const opts = {
      cwd: projectRoot,
      name: 'X',
      key: 'X1',
      workflow: 'default',
      minimal: false,
    };
    new InitCommand().run({ ...opts, force: false });
    new InitCommand().run({ ...opts, force: true });
    const gitignore = readFileSync(path.join(projectRoot, '.gitignore'), 'utf-8');
    const attrs = readFileSync(path.join(projectRoot, '.gitattributes'), 'utf-8');
    const countIgnore = gitignore.split('.mnema/state/').length - 1;
    const countAttrs = attrs.split('merge=union').length - 1;
    expect(countIgnore).toBe(1);
    expect(countAttrs).toBe(1);
  });
});

describe('audit log merges append-only under the scaffolded .gitattributes', () => {
  let repo: string;

  // A hermetic git env so the test never reads the developer's global
  // config and never prompts (identity, default branch, no signing).
  function git(args: string[]): string {
    return execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf-8',
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    });
  }

  // Writes land in this machine's tail (`audit/m-<id>/`); resolve it so the
  // union-merge test appends to the file the writer actually uses.
  const auditFile = (): string => {
    const auditDir = path.join(repo, '.mnema', 'audit');
    const tail = readdirSync(auditDir, { withFileTypes: true }).find(
      (d) => d.isDirectory() && /^m-[0-9a-f]{12}$/.test(d.name),
    );
    return path.join(tail ? path.join(auditDir, tail.name) : auditDir, 'current.jsonl');
  };

  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'mnema-audit-merge-'));
    git(['init', '-b', 'main']);
    new InitCommand().run({
      cwd: repo,
      name: 'X',
      key: 'X1',
      workflow: 'default',
      force: false,
      minimal: false,
    });
    git(['add', '-A']);
    git(['commit', '-m', 'init']);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('merges two branches that both appended to the audit log without a conflict', () => {
    // Branch A appends one event.
    git(['checkout', '-b', 'feature']);
    appendFileSync(auditFile(), '{"event":"A"}\n', 'utf-8');
    git(['commit', '-am', 'event A']);

    // main appends a different event.
    git(['checkout', 'main']);
    appendFileSync(auditFile(), '{"event":"B"}\n', 'utf-8');
    git(['commit', '-am', 'event B']);

    // The union driver must merge both tails without raising a conflict.
    git(['merge', 'feature', '-m', 'merge']);

    const merged = readFileSync(auditFile(), 'utf-8');
    expect(merged).not.toContain('<<<<<<<');
    expect(merged).toContain('"event":"A"');
    expect(merged).toContain('"event":"B"');
  });

  it('negative control: the SAME merge conflicts without the union driver', () => {
    // Remove the scaffolded .gitattributes so the audit log merges with
    // git's default text driver. This proves the union attribute is what
    // prevents the conflict above — the positive test is not vacuous.
    rmSync(path.join(repo, '.gitattributes'), { force: true });
    git(['commit', '-am', 'drop gitattributes']);

    git(['checkout', '-b', 'feature']);
    appendFileSync(auditFile(), '{"event":"A"}\n', 'utf-8');
    git(['commit', '-am', 'event A']);

    git(['checkout', 'main']);
    appendFileSync(auditFile(), '{"event":"B"}\n', 'utf-8');
    git(['commit', '-am', 'event B']);

    // Without the union driver this merge must fail (conflict on the tail).
    let conflicted = false;
    try {
      git(['merge', 'feature', '-m', 'merge']);
    } catch {
      conflicted = true;
    }
    expect(conflicted).toBe(true);
    expect(readFileSync(auditFile(), 'utf-8')).toContain('<<<<<<<');
  });
});

describe('InitCommand wizard helpers', () => {
  it('derives a project key from a multi-word name', () => {
    expect(_internal.deriveKey('My Web App')).toBe('MYWEBA');
  });

  it('strips diacritics and punctuation', () => {
    expect(_internal.deriveKey('Açaí — Backend')).toBe('ACAIBA');
  });

  it('returns undefined when the name has no usable letters', () => {
    expect(_internal.deriveKey('?? !!')).toBeUndefined();
  });
});

describe('InitCommand.run — committed .mnema/README.md', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-init-readme-'));
  });
  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('scaffolds a source-of-truth map that names each dir role', () => {
    const result = new InitCommand().run({
      cwd: projectRoot,
      name: 'My App',
      key: 'MYAPP',
      workflow: 'default',
      force: false,
      minimal: false,
    });
    expect(result.ok).toBe(true);

    const readmePath = path.join(projectRoot, '.mnema', 'README.md');
    expect(existsSync(readmePath)).toBe(true);
    const body = readFileSync(readmePath, 'utf-8');
    expect(body).toContain('Source of truth');
    expect(body).toContain('Rebuildable cache');
    expect(body).toContain('Public verification material');
    expect(body).toContain('.mnema/state/');
    expect(body).toContain('mnema sync');
    expect(body).toContain('~/.config/mnema');
  });

  it('is non-destructive: a second init leaves an existing README untouched', () => {
    const opts = {
      cwd: projectRoot,
      name: 'My App',
      key: 'MYAPP',
      workflow: 'default',
      force: true,
      minimal: false,
    };
    new InitCommand().run(opts);
    const readmePath = path.join(projectRoot, '.mnema', 'README.md');
    const custom = '# my custom .mnema notes\n';
    appendFileSync(readmePath, custom);
    new InitCommand().run(opts);
    // The re-run must not clobber the customised README.
    expect(readFileSync(readmePath, 'utf-8')).toContain('my custom .mnema notes');
  });
});
