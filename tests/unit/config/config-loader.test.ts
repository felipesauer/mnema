import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CONFIG_FILE_RELATIVE,
  ConfigInvalidError,
  ConfigLoader,
  ConfigNotFoundError,
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
});
