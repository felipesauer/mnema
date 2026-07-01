import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CONFIG_FILE_RELATIVE,
  ConfigInvalidError,
  ConfigLoader,
  ConfigNotFoundError,
  LOCAL_CONFIG_RELATIVE,
  LocalConfigInvalidError,
  USER_CONFIG_RELATIVE,
  UserConfigInvalidError,
} from '@/config/config-loader.js';

const validConfig = {
  version: '1.0',
  mnema_version: '0.1.0',
  project: { key: 'TEST', name: 'Test project' },
};

function writeConfig(root: string, payload: unknown): string {
  const configPath = path.join(root, CONFIG_FILE_RELATIVE);
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(payload));
  return configPath;
}

describe('ConfigLoader', () => {
  let tempRoot: string;
  let loader: ConfigLoader;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-config-'));
    loader = new ConfigLoader();
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  describe('findConfigFile', () => {
    it('finds the config file in the start directory', () => {
      const configPath = writeConfig(tempRoot, validConfig);

      const result = loader.findConfigFile(tempRoot);

      expect(result).toBe(configPath);
    });

    it('finds the config file in an ancestor directory', () => {
      const configPath = writeConfig(tempRoot, validConfig);
      const deep = path.join(tempRoot, 'a', 'b', 'c');
      mkdirSync(deep, { recursive: true });

      const result = loader.findConfigFile(deep);

      expect(result).toBe(configPath);
    });

    it('returns null when no config file is reachable', () => {
      const isolated = mkdtempSync(path.join(tmpdir(), 'mnema-isolated-'));
      try {
        const result = loader.findConfigFile(isolated);
        expect(result).toBeNull();
      } finally {
        rmSync(isolated, { recursive: true, force: true });
      }
    });
  });

  describe('load', () => {
    it('returns a typed config with defaults applied when valid', () => {
      writeConfig(tempRoot, validConfig);

      const config = loader.load(tempRoot);

      expect(config.project.key).toBe('TEST');
      expect(config.project.name).toBe('Test project');
      expect(config.workflow).toBe('default');
      expect(config.mode).toBe('single');
      // The default layout puts every Mnema-managed artefact under .mnema/.
      expect(config.paths.state).toBe('.mnema/state');
      expect(config.paths.audit).toBe('.mnema/audit');
      expect(config.paths.backlog).toBe('.mnema/backlog');
      expect(config.sync.agent_buffer_flush_seconds).toBe(30);
      expect(config.features.fts_search).toBe(true);
    });

    it('throws ConfigNotFoundError when no config exists', () => {
      const isolated = mkdtempSync(path.join(tmpdir(), 'mnema-notfound-'));
      try {
        expect(() => loader.load(isolated)).toThrow(ConfigNotFoundError);
      } finally {
        rmSync(isolated, { recursive: true, force: true });
      }
    });

    it('throws ConfigInvalidError when payload violates the schema', () => {
      const broken = { version: '1.0', mnema_version: '0.1.0', project: { key: 'lowercase' } };
      writeConfig(tempRoot, broken);

      let caught: unknown;
      try {
        loader.load(tempRoot);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ConfigInvalidError);
      expect((caught as ConfigInvalidError).issues).toBeTruthy();
    });
  });

  describe('user-level config (~/.config/mnema/config.json)', () => {
    let fakeHome: string;
    let scopedLoader: ConfigLoader;

    function writeUserConfig(payload: unknown): void {
      const file = path.join(fakeHome, USER_CONFIG_RELATIVE);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(payload));
    }

    beforeEach(() => {
      // Isolate the home dir so the test never reads the real ~/.config.
      fakeHome = mkdtempSync(path.join(tmpdir(), 'mnema-home-'));
      scopedLoader = new ConfigLoader(() => fakeHome);
    });

    afterEach(() => {
      rmSync(fakeHome, { recursive: true, force: true });
    });

    it('applies a user default when the project omits the key', () => {
      writeConfig(tempRoot, validConfig); // no enforcement_mode
      writeUserConfig({ enforcement_mode: 'blocking' });

      const config = scopedLoader.load(tempRoot);
      expect(config.enforcement_mode).toBe('blocking');
    });

    it('lets the project override the user default', () => {
      writeConfig(tempRoot, { ...validConfig, enforcement_mode: 'advisory' });
      writeUserConfig({ enforcement_mode: 'blocking' });

      const config = scopedLoader.load(tempRoot);
      expect(config.enforcement_mode).toBe('advisory');
    });

    it('deep-merges sync: project sub-fields win, user sub-fields fill the gaps', () => {
      writeConfig(tempRoot, { ...validConfig, sync: { agent_buffer_flush_count: 99 } });
      writeUserConfig({ sync: { mode: 'push', agent_buffer_flush_count: 10 } });

      const config = scopedLoader.load(tempRoot);
      expect(config.sync.agent_buffer_flush_count).toBe(99); // project wins
      expect(config.sync.mode).toBe('push'); // user fills the gap
    });

    it('applies a user-level aging.stale_after_days when the project omits it', () => {
      writeConfig(tempRoot, validConfig);
      writeUserConfig({ aging: { stale_after_days: 9 } });

      const config = scopedLoader.load(tempRoot);
      expect(config.aging.stale_after_days).toBe(9);
    });

    it('lets the project override the user-level aging threshold', () => {
      writeConfig(tempRoot, { ...validConfig, aging: { stale_after_days: 2 } });
      writeUserConfig({ aging: { stale_after_days: 9 } });

      const config = scopedLoader.load(tempRoot);
      expect(config.aging.stale_after_days).toBe(2); // project wins
    });

    it('changes nothing when no user config exists', () => {
      writeConfig(tempRoot, validConfig);
      const config = scopedLoader.load(tempRoot);
      expect(config.enforcement_mode).toBe('strict'); // schema default
    });

    it('rejects a user config that sets a project-only key', () => {
      writeConfig(tempRoot, validConfig);
      writeUserConfig({ project: { key: 'OTHER', name: 'Nope' } });

      expect(() => scopedLoader.load(tempRoot)).toThrow(UserConfigInvalidError);
    });
  });

  describe('per-repo override (.mnema/config.local.json)', () => {
    function writeLocalConfig(payload: unknown): void {
      const file = path.join(tempRoot, LOCAL_CONFIG_RELATIVE);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(payload));
    }

    it('overrides the project config when present', () => {
      writeConfig(tempRoot, { ...validConfig, enforcement_mode: 'blocking' });
      writeLocalConfig({ enforcement_mode: 'advisory' });

      const config = loader.load(tempRoot);
      expect(config.enforcement_mode).toBe('advisory'); // local wins over project
    });

    it('changes nothing when the local file is absent', () => {
      writeConfig(tempRoot, { ...validConfig, enforcement_mode: 'blocking' });
      const config = loader.load(tempRoot);
      expect(config.enforcement_mode).toBe('blocking');
    });

    it('deep-merges sync: local sub-fields win, project sub-fields fill the gaps', () => {
      writeConfig(tempRoot, {
        ...validConfig,
        sync: { mode: 'push', agent_buffer_flush_count: 99 },
      });
      writeLocalConfig({ sync: { agent_buffer_flush_count: 5 } });

      const config = loader.load(tempRoot);
      expect(config.sync.agent_buffer_flush_count).toBe(5); // local wins
      expect(config.sync.mode).toBe('push'); // project fills the gap
    });

    it('recursively merges a nested record (aging.sla_days) instead of replacing it', () => {
      writeConfig(tempRoot, {
        ...validConfig,
        aging: { sla_days: { IN_REVIEW: 5, BLOCKED: 2 } },
      });
      // The local override touches a single state's SLA…
      writeLocalConfig({ aging: { sla_days: { IN_REVIEW: 1 } } });

      const config = loader.load(tempRoot);
      expect(config.aging.sla_days?.IN_REVIEW).toBe(1); // local wins for the one it set
      expect(config.aging.sla_days?.BLOCKED).toBe(2); // …the project's other SLA survives
    });

    it('sits on top of the whole stack: user < project < local', () => {
      // user says blocking, project says strict, local says advisory → advisory
      const fakeHome = mkdtempSync(path.join(tmpdir(), 'mnema-home-stack-'));
      try {
        const stackLoader = new ConfigLoader(() => fakeHome);
        const userFile = path.join(fakeHome, USER_CONFIG_RELATIVE);
        mkdirSync(path.dirname(userFile), { recursive: true });
        writeFileSync(userFile, JSON.stringify({ enforcement_mode: 'blocking' }));
        writeConfig(tempRoot, { ...validConfig, enforcement_mode: 'strict' });
        writeLocalConfig({ enforcement_mode: 'advisory' });

        expect(stackLoader.load(tempRoot).enforcement_mode).toBe('advisory');
      } finally {
        rmSync(fakeHome, { recursive: true, force: true });
      }
    });

    it('rejects a local override that sets a project-only key', () => {
      writeConfig(tempRoot, validConfig);
      writeLocalConfig({ project: { key: 'OTHER', name: 'Nope' } });

      expect(() => loader.load(tempRoot)).toThrow(LocalConfigInvalidError);
    });
  });
});
