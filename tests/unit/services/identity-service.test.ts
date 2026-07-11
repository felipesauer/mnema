import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActorKind } from '@/domain/enums/actor-kind.js';
import { IdentityNotConfiguredError, IdentityService } from '@/services/identity-service.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('IdentityService', () => {
  let tempRoot: string;
  let fakeHome: string;
  let adapter: SqliteAdapter;
  let service: IdentityService;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-id-'));
    fakeHome = path.join(tempRoot, 'home');
    mkdirSync(fakeHome, { recursive: true });

    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    service = new IdentityService(new ActorRepository(adapter), () => fakeHome);

    originalEnv = process.env.MNEMA_ACTOR;
    delete process.env.MNEMA_ACTOR;
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env.MNEMA_ACTOR;
    } else {
      process.env.MNEMA_ACTOR = originalEnv;
    }
  });

  describe('getDefaultActor', () => {
    it('uses the MNEMA_ACTOR env var when set', () => {
      process.env.MNEMA_ACTOR = 'env-user';
      expect(service.getDefaultActor()).toBe('env-user');
    });

    it('falls back to ~/.config/mnema/identity.json', () => {
      const cfgDir = path.join(fakeHome, '.config', 'mnema');
      mkdirSync(cfgDir, { recursive: true });
      writeFileSync(
        path.join(cfgDir, 'identity.json'),
        JSON.stringify({ default_actor: 'config-user' }),
      );

      expect(service.getDefaultActor()).toBe('config-user');
    });

    it('throws IdentityNotConfiguredError when neither source is available', () => {
      expect(() => service.getDefaultActor()).toThrow(IdentityNotConfiguredError);
    });

    it('throws when identity.json exists but has no default_actor', () => {
      const cfgDir = path.join(fakeHome, '.config', 'mnema');
      mkdirSync(cfgDir, { recursive: true });
      writeFileSync(path.join(cfgDir, 'identity.json'), JSON.stringify({}));

      expect(() => service.getDefaultActor()).toThrow(IdentityNotConfiguredError);
    });
  });

  describe('resolveAgentActor', () => {
    it('prefixes the agent_handle with "agent:"', () => {
      expect(service.resolveAgentActor({ agent_handle: 'claude-code' })).toBe('agent:claude-code');
    });

    it('returns null when no handle is provided', () => {
      expect(service.resolveAgentActor({})).toBeNull();
      expect(service.resolveAgentActor({ agent_handle: '' })).toBeNull();
    });
  });

  describe('ensureActor', () => {
    it('creates an actor when missing and reuses on subsequent calls', () => {
      const first = service.ensureActor('daniel', ActorKind.Human);
      const second = service.ensureActor('daniel', ActorKind.Human);
      expect(first).toBe(second);
    });
  });

  describe('resolveDefaultActor', () => {
    it('returns source=env when MNEMA_ACTOR is set', () => {
      process.env.MNEMA_ACTOR = 'env-user';
      const resolved = service.resolveDefaultActor();
      expect(resolved.actor).toBe('env-user');
      expect(resolved.source).toBe('env');
    });

    it('returns source=config when env is unset and identity.json has default_actor', () => {
      const cfgDir = path.join(fakeHome, '.config', 'mnema');
      mkdirSync(cfgDir, { recursive: true });
      writeFileSync(
        path.join(cfgDir, 'identity.json'),
        JSON.stringify({ default_actor: 'config-user' }),
      );

      const resolved = service.resolveDefaultActor();
      expect(resolved.actor).toBe('config-user');
      expect(resolved.source).toBe('config');
    });

    it('returns source=none with null actor when nothing is configured', () => {
      const resolved = service.resolveDefaultActor();
      expect(resolved.actor).toBeNull();
      expect(resolved.source).toBe('none');
    });

    it('always reports the configPath so callers can show it', () => {
      const resolved = service.resolveDefaultActor();
      expect(resolved.configPath).toContain('.config/mnema/identity.json');
    });
  });

  describe('setDefaultActor', () => {
    it('persists handle and display in identity.json with version 1.0', () => {
      service.setDefaultActor('alice', 'Alice Smith');

      const cfg = JSON.parse(
        readFileSync(path.join(fakeHome, '.config', 'mnema', 'identity.json'), 'utf-8'),
      );
      expect(cfg.default_actor).toBe('alice');
      expect(cfg.display).toBe('Alice Smith');
      expect(cfg.version).toBe('1.0');
    });

    it('creates the parent directory when missing', () => {
      const cfgDir = path.join(fakeHome, '.config', 'mnema');
      expect(existsSync(cfgDir)).toBe(false);

      service.setDefaultActor('alice');
      expect(existsSync(cfgDir)).toBe(true);
    });

    it('writes the file with mode 0600', () => {
      service.setDefaultActor('alice');
      const stat = statSync(path.join(fakeHome, '.config', 'mnema', 'identity.json'));
      // Mask off file-type bits; only permission bits should remain.
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it('preserves unrelated fields when updating an existing config', () => {
      const cfgDir = path.join(fakeHome, '.config', 'mnema');
      mkdirSync(cfgDir, { recursive: true });
      writeFileSync(
        path.join(cfgDir, 'identity.json'),
        JSON.stringify({ default_actor: 'old', custom_field: 'keep-me' }),
      );

      service.setDefaultActor('new');

      const cfg = JSON.parse(readFileSync(path.join(cfgDir, 'identity.json'), 'utf-8'));
      expect(cfg.default_actor).toBe('new');
      expect(cfg.custom_field).toBe('keep-me');
    });

    it('rejects empty handle, whitespace, and the agent: prefix', () => {
      expect(() => service.setDefaultActor('')).toThrow();
      expect(() => service.setDefaultActor('with space')).toThrow();
      expect(() => service.setDefaultActor('agent:hacker')).toThrow();
    });
  });

  describe('unsetDefaultActor', () => {
    it('is a no-op when the file does not exist', () => {
      expect(() => service.unsetDefaultActor()).not.toThrow();
    });

    it('removes the file when default_actor was the only meaningful field', () => {
      service.setDefaultActor('alice');
      service.unsetDefaultActor();
      expect(existsSync(path.join(fakeHome, '.config', 'mnema', 'identity.json'))).toBe(false);
    });

    it('strips default_actor but keeps the file when other fields remain', () => {
      const cfgDir = path.join(fakeHome, '.config', 'mnema');
      mkdirSync(cfgDir, { recursive: true });
      writeFileSync(
        path.join(cfgDir, 'identity.json'),
        JSON.stringify({ default_actor: 'alice', custom_field: 'survive' }),
      );

      service.unsetDefaultActor();

      const cfg = JSON.parse(readFileSync(path.join(cfgDir, 'identity.json'), 'utf-8'));
      expect(cfg.default_actor).toBeUndefined();
      expect(cfg.custom_field).toBe('survive');
    });
  });

  describe('listActors', () => {
    it('lists ordinary actors', () => {
      service.ensureActor('daniel', ActorKind.Human);
      service.ensureActor('agent:claude-code', ActorKind.Agent);
      const handles = service.listActors().map((a) => a.handle);
      expect(handles).toContain('daniel');
      expect(handles).toContain('agent:claude-code');
    });

    it('omits the reserved `system` seed-author from the discoverable roster', () => {
      // `system` authors the shipped seed skills at init, so it exists in the
      // actors table — but it is not a person and must never be offered as an
      // assignee. It stays out of the roster context_bootstrap surfaces.
      service.ensureActor('system', ActorKind.Human);
      service.ensureActor('daniel', ActorKind.Human);
      const handles = service.listActors().map((a) => a.handle);
      expect(handles).not.toContain('system');
      expect(handles).toContain('daniel');
    });

    it('still resolves the reserved handle when referenced directly', () => {
      // Hidden from the roster ≠ unreferenceable: findActorIdByHandle bypasses
      // listActors, so audit rows authored by `system` still resolve.
      service.ensureActor('system', ActorKind.Human);
      expect(service.findActorIdByHandle('system')).not.toBeNull();
    });
  });

  describe('addKnownActor / listKnownActors / getDisplayFor', () => {
    it('starts with an empty known-actors map', () => {
      expect(service.listKnownActors()).toEqual({});
    });

    it('persists handle, kind and display in the actors map', () => {
      service.addKnownActor('joaop', { kind: 'human', display: 'João Pereira' });
      const known = service.listKnownActors();
      expect(known.joaop).toEqual({ kind: 'human', display: 'João Pereira' });
    });

    it('accepts agent: prefixed handles for agent kind', () => {
      service.addKnownActor('agent:claude-code', { kind: 'agent', display: 'Claude Code' });
      const known = service.listKnownActors();
      expect(known['agent:claude-code']).toEqual({
        kind: 'agent',
        display: 'Claude Code',
      });
    });

    it('replaces an existing entry on re-add (idempotent)', () => {
      service.addKnownActor('joaop', { kind: 'human', display: 'Old Name' });
      service.addKnownActor('joaop', { kind: 'human', display: 'New Name' });
      expect(service.listKnownActors().joaop?.display).toBe('New Name');
    });

    it('returns the handle when no display is registered', () => {
      expect(service.getDisplayFor('unknown')).toBe('unknown');
    });

    it('returns the display when the handle is registered', () => {
      service.addKnownActor('joaop', { kind: 'human', display: 'João Pereira' });
      expect(service.getDisplayFor('joaop')).toBe('João Pereira');
    });

    it('returns the handle when the entry exists but has no display', () => {
      service.addKnownActor('handle-only', { kind: 'human' });
      expect(service.getDisplayFor('handle-only')).toBe('handle-only');
    });

    it('co-exists with default_actor in the same file', () => {
      service.setDefaultActor('felipesauer', 'Felipe Sauer');
      service.addKnownActor('joaop', { kind: 'human', display: 'João Pereira' });

      const cfg = JSON.parse(
        readFileSync(path.join(fakeHome, '.config', 'mnema', 'identity.json'), 'utf-8'),
      );
      expect(cfg.default_actor).toBe('felipesauer');
      expect(cfg.actors.felipesauer.display).toBe('Felipe Sauer');
      expect(cfg.actors.joaop.display).toBe('João Pereira');
    });

    it('removeKnownActor removes only the targeted entry', () => {
      service.addKnownActor('a', { kind: 'human', display: 'A' });
      service.addKnownActor('b', { kind: 'human', display: 'B' });
      service.removeKnownActor('a');
      const known = service.listKnownActors();
      expect(known.a).toBeUndefined();
      expect(known.b?.display).toBe('B');
    });

    it('removeKnownActor is a no-op when the file does not exist', () => {
      expect(() => service.removeKnownActor('any')).not.toThrow();
    });
  });
});
