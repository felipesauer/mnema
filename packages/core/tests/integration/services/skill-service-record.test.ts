import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActorKind } from '@/domain/enums/actor-kind.js';
import { ErrorCode } from '@/errors/error-codes.js';
import type { CommandRunner } from '@/services/git/github-pr-service.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { IdentityService } from '@/services/integrity/identity-service.js';
import { SkillService } from '@/services/knowledge/skill-service.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { SkillRepository } from '@/storage/sqlite/repositories/skill-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';
import { chainedAuditWriter } from '../../setup/audit-writer.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

const KNOWN_TOOLS = new Set(['task_create', 'tasks_list']);

// record() returns a Result; these suites assert the happy path, so unwrap.
function recordOk(service: SkillService, input: Parameters<SkillService['record']>[0]) {
  const result = service.record(input);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

describe('SkillService (record/show/use)', () => {
  let tempRoot: string;
  let skillsDir: string;
  let adapter: SqliteAdapter;
  let service: SkillService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-skill-rec-'));
    skillsDir = path.join(tempRoot, '.mnema', 'skills');
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const audit = new AuditService(chainedAuditWriter(adapter, path.join(tempRoot, '.audit')));
    const repo = new SkillRepository(adapter);
    const identity = new IdentityService(new ActorRepository(adapter));
    identity.ensureActor('daniel', ActorKind.Human);

    service = new SkillService(skillsDir, KNOWN_TOOLS, repo, identity, audit);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('creates v1 when slug is unknown', () => {
    const result = recordOk(service, {
      slug: 'safe-migration',
      name: 'Safe migration rollout',
      description: 'How to roll a migration safely under load',
      content: '## Steps\n1. ...',
      actor: 'daniel',
    });
    expect(result.action).toBe('created');
    expect(result.skill.version).toBe(1);
    // ADR-51: a human/AI-authored skill mirrors under authored/.
    expect(existsSync(path.join(skillsDir, 'authored', 'safe-migration.md'))).toBe(true);
  });

  it('updates in place when mode=update and content differs', () => {
    service.record({
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'A',
      actor: 'daniel',
    });
    const updated = recordOk(service, {
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'B',
      actor: 'daniel',
    });
    expect(updated.action).toBe('updated');
    expect(updated.skill.version).toBe(1);
    expect(updated.skill.content).toBe('B');
  });

  it('a re-record that changes ONLY the scope is not swallowed as a no-op', () => {
    // Audit MEDIUM: scope was omitted from the sameContent check.
    recordOk(service, { slug: 'sc', name: 'S', description: 'd', content: 'A', actor: 'daniel' });
    const updated = recordOk(service, {
      slug: 'sc',
      name: 'S',
      description: 'd',
      content: 'A',
      scope: 'packages/x',
      actor: 'daniel',
    });
    expect(updated.action).toBe('updated');
    expect(updated.skill.scope).toBe('packages/x');
    // Identical re-record (scope unchanged) is still a no-op.
    const again = recordOk(service, {
      slug: 'sc',
      name: 'S',
      description: 'd',
      content: 'A',
      scope: 'packages/x',
      actor: 'daniel',
    });
    expect(again.action).toBe('no_op');
  });

  it('an in-place update without a new rationale preserves the existing one', () => {
    // Audit MEDIUM: update mode nulled change_rationale when none was supplied.
    recordOk(service, {
      slug: 'r',
      name: 'R',
      description: 'd',
      content: 'v1',
      actor: 'daniel',
    });
    // Bump to v2 WITH a rationale.
    const v2 = recordOk(service, {
      slug: 'r',
      name: 'R',
      description: 'd',
      content: 'v2',
      mode: 'new_version',
      changeRationale: 'switched to the async API',
      actor: 'daniel',
    });
    expect(v2.skill.changeRationale).toBe('switched to the async API');
    // Edit v2 in place (default update mode), no rationale supplied.
    const edited = recordOk(service, {
      slug: 'r',
      name: 'R',
      description: 'd',
      content: 'v2-fixed',
      actor: 'daniel',
    });
    expect(edited.action).toBe('updated');
    expect(edited.skill.changeRationale).toBe('switched to the async API');
  });

  it('no-ops when content is byte-equal under mode=update', () => {
    service.record({
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'A',
      actor: 'daniel',
    });
    const again = recordOk(service, {
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'A',
      actor: 'daniel',
    });
    expect(again.action).toBe('no_op');
    expect(again.skill.version).toBe(1);
  });

  it('no_op does NOT advance updated_at', async () => {
    const first = recordOk(service, {
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'A',
      actor: 'daniel',
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const again = recordOk(service, {
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'A',
      actor: 'daniel',
    });
    expect(again.action).toBe('no_op');
    expect(again.skill.updatedAt).toBe(first.skill.updatedAt);
  });

  it('no_op regenerates the mirror when the file went missing', () => {
    const first = recordOk(service, {
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'A',
      actor: 'daniel',
    });
    const mirror = path.join(skillsDir, 'authored', 's.md');
    expect(existsSync(mirror)).toBe(true);
    rmSync(mirror);

    const again = recordOk(service, {
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'A',
      actor: 'daniel',
    });
    expect(again.action).toBe('no_op');
    expect(again.skill.updatedAt).toBe(first.skill.updatedAt);
    expect(existsSync(mirror)).toBe(true);
  });

  it('bumps version when mode=new_version', () => {
    service.record({
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'A',
      actor: 'daniel',
    });
    const bumped = recordOk(service, {
      slug: 's',
      name: 'Skill v2',
      description: 'd',
      content: 'B',
      mode: 'new_version',
      actor: 'daniel',
    });
    expect(bumped.action).toBe('new_version');
    expect(bumped.skill.version).toBe(2);
    expect(service.listVersions('s')).toHaveLength(2);
  });

  it('successive new_version records get distinct sequential versions (atomic bump)', () => {
    service.record({ slug: 's', name: 'S', description: 'd', content: 'v1', actor: 'daniel' });
    const versions = [2, 3, 4].map((_, i) => {
      const r = recordOk(service, {
        slug: 's',
        name: 'S',
        description: 'd',
        content: `body-${i}`,
        mode: 'new_version',
        actor: 'daniel',
      });
      return r.skill.version;
    });
    expect(versions).toEqual([2, 3, 4]);
    expect(service.listVersions('s')).toHaveLength(4);
  });

  it('records use, incrementing usage_count', () => {
    service.record({
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'A',
      actor: 'daniel',
    });
    const after = service.recordUse('s', 'daniel');
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.usageCount).toBe(1);
    expect(after.value.lastUsedAt).not.toBeNull();
  });

  it('show returns latest by default and a specific version when asked', () => {
    service.record({
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'A',
      actor: 'daniel',
    });
    service.record({
      slug: 's',
      name: 'Skill',
      description: 'd',
      content: 'B',
      mode: 'new_version',
      actor: 'daniel',
    });
    const latest = service.show('s');
    expect(latest.ok).toBe(true);
    if (latest.ok) expect(latest.value.version).toBe(2);

    const v1 = service.show('s', 1);
    expect(v1.ok).toBe(true);
    if (v1.ok) expect(v1.value.content).toBe('A');
  });

  it('writes a mirror .md whose body matches the latest content', () => {
    service.record({
      slug: 's',
      name: 'Skill',
      description: 'desc',
      content: '## Hello world',
      actor: 'daniel',
    });
    const mirror = readFileSync(path.join(skillsDir, 'authored', 's.md'), 'utf-8');
    expect(mirror).toContain('## Hello world');
    expect(mirror).toContain('name: Skill');
  });

  it('lint still works in lint-only mode (no record deps)', () => {
    writeFileSync(
      path.join(tempRoot, 'lint-only.md'),
      '---\nname: x\nversion: 1.0.0\ndescription: hello\ntools_used: []\n---\n## Example\nbody',
      'utf-8',
    );
    const lintOnly = new SkillService(tempRoot, KNOWN_TOOLS);
    const report = lintOnly.lint();
    expect(report.errorCount).toBe(0);
  });

  it('2.3: rebuildMirrors recreates missing mirrors from SQLite without touching present ones', () => {
    // Create 2 slugs, then delete one mirror by hand.
    service.record({ slug: 'a', name: 'A', description: 'd', content: 'x', actor: 'daniel' });
    service.record({ slug: 'b', name: 'B', description: 'd', content: 'y', actor: 'daniel' });
    const mirrorA = path.join(skillsDir, 'authored', 'a.md');
    const mirrorB = path.join(skillsDir, 'authored', 'b.md');
    expect(existsSync(mirrorA) && existsSync(mirrorB)).toBe(true);

    rmSync(mirrorA);
    const before = readFileSync(mirrorB, 'utf-8');
    const rebuilt = service.rebuildMirrors();

    expect(rebuilt).toEqual(['a']);
    expect(existsSync(mirrorA)).toBe(true);
    // Untouched mirror stays byte-identical.
    expect(readFileSync(mirrorB, 'utf-8')).toBe(before);
  });

  it('ADR-51: a seed authored by `system` mirrors under default/, authored elsewhere', () => {
    // `system` is the reserved seed author.
    recordOk(service, {
      slug: 'seeded',
      name: 'S',
      description: 'd',
      content: 'x',
      actor: 'system',
    });
    recordOk(service, { slug: 'mine', name: 'M', description: 'd', content: 'y', actor: 'daniel' });
    expect(existsSync(path.join(skillsDir, 'default', 'seeded.md'))).toBe(true);
    expect(existsSync(path.join(skillsDir, 'authored', 'mine.md'))).toBe(true);
    // Not the other way around.
    expect(existsSync(path.join(skillsDir, 'authored', 'seeded.md'))).toBe(false);
    expect(existsSync(path.join(skillsDir, 'default', 'mine.md'))).toBe(false);
  });

  it('ADR-51: rebuildMirrors migrates a flat pre-layout skill into authored/', () => {
    recordOk(service, {
      slug: 'legacy',
      name: 'L',
      description: 'd',
      content: 'z',
      actor: 'daniel',
    });
    const canonical = path.join(skillsDir, 'authored', 'legacy.md');
    const flat = path.join(skillsDir, 'legacy.md');
    // Simulate a pre-ADR-51 flat mirror.
    rmSync(canonical);
    writeFileSync(flat, '# stale flat\n', 'utf-8');

    const rebuilt = service.rebuildMirrors();
    expect(rebuilt).toContain('legacy');
    expect(existsSync(canonical)).toBe(true);
    expect(existsSync(flat)).toBe(false);
  });

  it('records an invocable skill with dynamic context (trigger flag persisted)', () => {
    const result = recordOk(service, {
      slug: 'pick-next',
      name: 'Pick next task',
      description: 'Choose what to work on next',
      content: '## Steps',
      invocable: true,
      dynamicContext: ['mnema tasks ready'],
      actor: 'daniel',
    });
    expect(result.skill.invocable).toBe(true);
    expect(result.skill.dynamicContext).toEqual(['mnema tasks ready']);

    // The fields round-trip through show…
    const shown = service.show('pick-next');
    expect(shown.ok).toBe(true);
    if (shown.ok) {
      expect(shown.value.invocable).toBe(true);
      expect(shown.value.dynamicContext).toEqual(['mnema tasks ready']);
    }
    // …and into the mirror frontmatter.
    const mirror = readFileSync(path.join(skillsDir, 'authored', 'pick-next.md'), 'utf-8');
    expect(mirror).toContain('invocable: true');
    expect(mirror).toContain('dynamic_context: ["mnema tasks ready"]');
  });

  it('a passive skill stays invocable=false with no dynamic context, and its mirror omits the fields', () => {
    service.record({
      slug: 'passive',
      name: 'Passive',
      description: 'Just docs',
      content: 'read me',
      actor: 'daniel',
    });
    const shown = service.show('passive');
    if (shown.ok) {
      expect(shown.value.invocable).toBe(false);
      expect(shown.value.dynamicContext).toEqual([]);
    }
    // Byte-level: the mirror carries neither field, so existing skills are
    // unchanged by this feature.
    const mirror = readFileSync(path.join(skillsDir, 'authored', 'passive.md'), 'utf-8');
    expect(mirror).not.toContain('invocable');
    expect(mirror).not.toContain('dynamic_context');
  });

  it('supersede drops the superseded latest version from list() and search-facing surface', () => {
    service.record({
      slug: 'old-flow',
      name: 'Old',
      description: 'd',
      content: 'A',
      actor: 'daniel',
    });
    service.record({
      slug: 'new-flow',
      name: 'New',
      description: 'd',
      content: 'B',
      actor: 'daniel',
    });
    expect(
      service
        .list()
        .map((s) => s.slug)
        .sort(),
    ).toEqual(['new-flow', 'old-flow']);
    const mirror = path.join(skillsDir, 'authored', 'old-flow.md');
    expect(existsSync(mirror)).toBe(true);

    const result = service.supersede('old-flow', 'new-flow', 'daniel');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.slug).toBe('new-flow');

    // The superseded slug drops out of the default listing…
    expect(service.list().map((s) => s.slug)).toEqual(['new-flow']);
    // …its row survives with the pointer set to the successor's row id…
    const successor = service.show('new-flow');
    const shown = service.show('old-flow');
    expect(shown.ok).toBe(true);
    if (shown.ok && successor.ok) {
      expect(shown.value.supersededBy).toBe(successor.value.id);
    }
    // …and its mirror no longer lingers as a live-looking entry.
    expect(existsSync(mirror)).toBe(false);
  });

  it('supersede targets a specific version when one is given', () => {
    service.record({ slug: 's', name: 'S', description: 'd', content: 'v1', actor: 'daniel' });
    service.record({
      slug: 's',
      name: 'S',
      description: 'd',
      content: 'v2',
      mode: 'new_version',
      actor: 'daniel',
    });
    service.record({ slug: 'heir', name: 'Heir', description: 'd', content: 'x', actor: 'daniel' });

    const result = service.supersede('s', 'heir', 'daniel', 1);
    expect(result.ok).toBe(true);
    // v1 carries the pointer; the latest (v2) is untouched, so the slug stays.
    const v1 = service.show('s', 1);
    const v2 = service.show('s', 2);
    if (v1.ok) expect(v1.value.supersededBy).not.toBeNull();
    if (v2.ok) expect(v2.value.supersededBy).toBeNull();
    expect(service.list().map((s) => s.slug)).toContain('s');
  });

  it('supersede rejects a skill superseding itself with SELF_SUPERSEDE', () => {
    service.record({ slug: 's', name: 'S', description: 'd', content: 'x', actor: 'daniel' });
    const result = service.supersede('s', 's', 'daniel');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe(ErrorCode.SelfSupersede);
      if (result.error.kind === ErrorCode.SelfSupersede) {
        expect(result.error.entity).toBe('skill');
        expect(result.error.ref).toBe('s@v1');
      }
    }
    const shown = service.show('s');
    if (shown.ok) expect(shown.value.supersededBy).toBeNull();
  });

  it('supersede rejects a target that is already superseded (no silent no-op)', () => {
    service.record({ slug: 'a', name: 'A', description: 'd', content: 'x', actor: 'daniel' });
    service.record({ slug: 'b', name: 'B', description: 'd', content: 'y', actor: 'daniel' });
    service.record({ slug: 'c', name: 'C', description: 'd', content: 'z', actor: 'daniel' });
    const first = service.supersede('a', 'b', 'daniel');
    expect(first.ok).toBe(true);
    const bId = first.ok ? first.value.id : '';

    const result = service.supersede('a', 'c', 'daniel');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe(ErrorCode.SupersededEntity);
      if (result.error.kind === ErrorCode.SupersededEntity) expect(result.error.ref).toBe('a@v1');
    }
    // The pointer still aims at the original successor's id, unchanged.
    const shown = service.show('a', 1);
    if (shown.ok) expect(shown.value.supersededBy).toBe(bId);
  });

  it('supersede rejects a successor whose latest version is already superseded', () => {
    service.record({ slug: 'a', name: 'A', description: 'd', content: 'x', actor: 'daniel' });
    service.record({ slug: 'b', name: 'B', description: 'd', content: 'y', actor: 'daniel' });
    service.record({ slug: 'c', name: 'C', description: 'd', content: 'z', actor: 'daniel' });
    expect(service.supersede('a', 'b', 'daniel').ok).toBe(true); // a is retired

    const result = service.supersede('c', 'a', 'daniel');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe(ErrorCode.SupersededEntity);
      if (result.error.kind === ErrorCode.SupersededEntity) {
        expect(result.error.entity).toBe('skill');
        expect(result.error.ref).toBe('a@v1');
      }
    }
    const shown = service.show('c');
    if (shown.ok) expect(shown.value.supersededBy).toBeNull();
  });

  it('supersede errors when the target or successor slug is unknown', () => {
    service.record({ slug: 'exists', name: 'E', description: 'd', content: 'x', actor: 'daniel' });

    const unknownTarget = service.supersede('ghost', 'exists', 'daniel');
    expect(unknownTarget.ok).toBe(false);
    if (!unknownTarget.ok) expect(unknownTarget.error.kind).toBe(ErrorCode.SkillNotFound);

    const unknownSuccessor = service.supersede('exists', 'ghost', 'daniel');
    expect(unknownSuccessor.ok).toBe(false);
    if (!unknownSuccessor.ok) expect(unknownSuccessor.error.kind).toBe(ErrorCode.SkillNotFound);
  });

  it('refuses a path-traversal slug and writes nothing outside the skills dir', () => {
    const result = service.record({
      slug: '../../etc/x',
      name: 'Escaped',
      description: 'd',
      content: 'should never land on disk',
      actor: 'daniel',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.ValidationFailed);
    if (result.error.kind !== ErrorCode.ValidationFailed) return;
    expect(result.error.issues[0]?.path).toEqual(['slug']);
    // Nothing persisted, and no file escaped the project via the mirror.
    expect(service.list()).toHaveLength(0);
    expect(existsSync(path.join(skillsDir, '..', '..', 'etc', 'x.md'))).toBe(false);
  });
});

describe('SkillService.resolveDynamicContext', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-skill-dyn-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    new IdentityService(new ActorRepository(adapter)).ensureActor('daniel', ActorKind.Human);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  /** Builds a service whose dynamic-context runner is the given mock. */
  function serviceWith(runner: CommandRunner): SkillService {
    const audit = new AuditService(chainedAuditWriter(adapter, path.join(tempRoot, '.audit')));
    const repo = new SkillRepository(adapter);
    const identity = new IdentityService(new ActorRepository(adapter));
    return new SkillService(
      path.join(tempRoot, '.mnema', 'skills'),
      KNOWN_TOOLS,
      repo,
      identity,
      audit,
      null,
      runner,
    );
  }

  /** Records and returns an invocable skill carrying the given commands. */
  function invocableSkill(service: SkillService, commands: string[]) {
    return recordOk(service, {
      slug: 'dyn',
      name: 'Dyn',
      description: 'd',
      content: 'c',
      invocable: true,
      dynamicContext: commands,
      actor: 'daniel',
    }).skill;
  }

  it('runs an allowed `mnema` command and returns its trimmed output', () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const runner: CommandRunner = (command, args) => {
      calls.push({ command, args });
      return { status: 0, stdout: 'TASK-1 ready\nTASK-2 ready\n' };
    };
    const service = serviceWith(runner);
    const skill = invocableSkill(service, ['mnema tasks ready']);

    const resolved = service.resolveDynamicContext(skill);
    expect(resolved).toEqual([
      { command: 'mnema tasks ready', ok: true, output: 'TASK-1 ready\nTASK-2 ready' },
    ]);
    // The `mnema` prefix is stripped from argv; only the subcommand is passed.
    expect(calls).toEqual([{ command: 'mnema', args: ['tasks', 'ready'] }]);
  });

  it('refuses a non-`mnema` command without spawning anything', () => {
    let spawned = false;
    const runner: CommandRunner = () => {
      spawned = true;
      return { status: 0, stdout: 'should not run' };
    };
    const service = serviceWith(runner);
    const skill = invocableSkill(service, ['rm -rf /']);

    const resolved = service.resolveDynamicContext(skill);
    expect(spawned).toBe(false);
    expect(resolved[0]?.ok).toBe(false);
    expect(resolved[0]?.output).toContain('only `mnema');
  });

  it('refuses destructive / arbitrary-I/O mnema subcommands without spawning', () => {
    let spawned = false;
    const runner: CommandRunner = () => {
      spawned = true;
      return { status: 0, stdout: 'should not run' };
    };
    const service = serviceWith(runner);
    // The `mnema` binary itself exposes these — the allowlist must block
    // them even though the first token is `mnema`.
    const dangerous = [
      'mnema destroy --yes',
      'mnema import markdown --from /home/user/.ssh/id_rsa',
      'mnema snapshot --epic X --out /tmp/pwned',
      'mnema task create --title x', // a write subaction of a read/write verb
      'mnema mcp serve',
    ];
    const skill = invocableSkill(service, dangerous);

    const resolved = service.resolveDynamicContext(skill);
    expect(spawned).toBe(false); // nothing was ever executed
    expect(resolved.every((r) => !r.ok)).toBe(true);
    expect(resolved.every((r) => r.output.includes('read-only'))).toBe(true);
  });

  it('allows read-only mnema subcommands (exact and with args)', () => {
    const seen: string[] = [];
    const runner: CommandRunner = (_cmd, args) => {
      seen.push(args.join(' '));
      return { status: 0, stdout: 'ok' };
    };
    const service = serviceWith(runner);
    const skill = invocableSkill(service, [
      'mnema history',
      'mnema tasks ready --sprint S-1',
      'mnema stats',
    ]);

    const resolved = service.resolveDynamicContext(skill);
    expect(resolved.every((r) => r.ok)).toBe(true);
    expect(seen).toEqual(['history', 'tasks ready --sprint S-1', 'stats']);
  });

  it('does not allow a prefix that is only a partial word match', () => {
    let spawned = false;
    const runner: CommandRunner = () => {
      spawned = true;
      return { status: 0, stdout: '' };
    };
    const service = serviceWith(runner);
    // `historyx` starts with the allowed `history` string but is a
    // different command — the space-boundary check must reject it.
    const skill = invocableSkill(service, ['mnema historyx']);

    const resolved = service.resolveDynamicContext(skill);
    expect(spawned).toBe(false);
    expect(resolved[0]?.ok).toBe(false);
  });

  it('degrades to a failure entry when an allowed command exits non-zero', () => {
    const runner: CommandRunner = () => ({ status: 1, stdout: '' });
    const service = serviceWith(runner);
    const skill = invocableSkill(service, ['mnema tasks ready']);

    const resolved = service.resolveDynamicContext(skill);
    expect(resolved[0]?.ok).toBe(false);
    expect(resolved[0]?.output).toContain('command failed');
  });
});
