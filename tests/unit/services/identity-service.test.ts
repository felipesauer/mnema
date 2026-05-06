import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
});
