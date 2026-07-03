import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InitCommand } from '@/cli/commands/init-command.js';

const DIST_ENTRY = path.resolve('dist/index.js');

/**
 * The knowledge CLI was read/curation-only; recording lived only on the
 * MCP surface, yet memory is described as "human-curated" (MNEMA-ADR-38).
 * These exercise the new `record` subcommands end-to-end through the
 * compiled binary — commander → withMutatingCliContext → service — and
 * assert the item is persisted, listable, and produces the same audit
 * event the MCP path emits.
 *
 * Skipped when dist/ is absent (the integration suite expects a prior
 * `pnpm build`, as the sigterm/bench targets already do).
 */
describe.skipIf(!existsSync(DIST_ENTRY))(
  'knowledge CLI record subcommands',
  () => {
    let projectRoot: string;

    // Hermetic env: a real actor via MNEMA_ACTOR, and an isolated HOME so a
    // developer's ~/.config/mnema/identity.json never leaks in.
    function run(args: string[]): string {
      return execFileSync(process.execPath, [DIST_ENTRY, ...args], {
        cwd: projectRoot,
        encoding: 'utf-8',
        env: {
          ...process.env,
          MNEMA_ACTOR: 'recorder',
          HOME: projectRoot,
          USERPROFILE: projectRoot,
        },
      });
    }

    const auditLog = (): string =>
      readFileSync(path.join(projectRoot, '.mnema', 'audit', 'current.jsonl'), 'utf-8');

    beforeEach(() => {
      projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-krec-'));
      new InitCommand().run({
        cwd: projectRoot,
        name: 'Krec',
        key: 'KREC',
        workflow: 'default',
        force: false,
        minimal: false,
      });
    });

    afterEach(() => {
      rmSync(projectRoot, { recursive: true, force: true });
    });

    it('memory record persists, lists, shows, and emits memory_recorded', () => {
      const out = run([
        'memory',
        'record',
        'npm-id',
        '--title',
        'npm identity',
        '--content',
        'pkg is @felipesauer/mnema',
        '--topic',
        'packaging',
        '--topic',
        'npm',
      ]);
      expect(out).toContain('recorded');

      expect(run(['memory', 'list'])).toContain('npm-id');
      const show = run(['memory', 'show', 'npm-id']);
      expect(show).toContain('npm identity');
      expect(show).toContain('pkg is @felipesauer/mnema');

      expect(auditLog()).toContain('"kind":"memory_recorded"');
    });

    it('observation record persists, lists, and emits observation_recorded', () => {
      const out = run([
        'observation',
        'record',
        'chain is keyless sha-256',
        '--topic',
        'integrity',
      ]);
      expect(out).toContain('observation recorded');

      expect(run(['observation', 'list'])).toContain('chain is keyless sha-256');
      expect(auditLog()).toContain('"kind":"observation_recorded"');
    });

    it('skill record persists, lists, shows, and emits skill_recorded', () => {
      const out = run([
        'skill',
        'record',
        'deploy',
        '--name',
        'Deploy',
        '--description',
        'how to ship',
        '--content',
        '1. build 2. test 3. push',
        '--tool',
        'task_show',
        '--invocable',
      ]);
      expect(out).toContain('created');

      expect(run(['skill', 'list'])).toContain('deploy');
      const show = run(['skill', 'show', 'deploy']);
      expect(show).toContain('Deploy');
      expect(show).toContain('1. build 2. test 3. push');

      expect(auditLog()).toContain('"kind":"skill_recorded"');
    });

    it('skill record --new-version bumps the version', () => {
      const common = ['skill', 'record', 'proc', '--name', 'Proc', '--description', 'a procedure'];
      run([...common, '--content', 'v1 body']);
      const bumped = run([...common, '--content', 'v2 body', '--new-version']);
      expect(bumped).toContain('v2');
      expect(run(['skill', 'show', 'proc'])).toContain('v2 body');
    });

    it('memory record without an identity routes through the structured error', () => {
      // No MNEMA_ACTOR and an isolated HOME → resolveDefaultActor finds none,
      // so the mutation must surface IdentityNotConfigured, not a raw throw.
      let stderr = '';
      let failed = false;
      try {
        execFileSync(
          process.execPath,
          [DIST_ENTRY, 'memory', 'record', 'x', '--title', 'T', '--content', 'C'],
          {
            cwd: projectRoot,
            encoding: 'utf-8',
            env: {
              ...process.env,
              MNEMA_ACTOR: '',
              HOME: projectRoot,
              USERPROFILE: projectRoot,
            },
          },
        );
      } catch (error) {
        failed = true;
        const e = error as { stderr?: string; stdout?: string };
        stderr = `${e.stderr ?? ''}${e.stdout ?? ''}`;
      }
      expect(failed).toBe(true);
      expect(stderr).toContain('No identity configured');
    });
    // Each test drives the compiled binary via several cold `execFileSync`
    // spawns; under the full parallel suite (and the per-invocation HMAC
    // secret I/O) that can exceed the 5s default, so give the group headroom.
  },
  30_000,
);
