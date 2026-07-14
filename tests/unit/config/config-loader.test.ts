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
      // The npm update check is opt-in and OFF by default (ADR-40) — the
      // offline / zero-telemetry default must hold without config.
      expect(config.features.update_check).toBe(false);
    });

    describe('audit.anchor (layer 3)', () => {
      it('defaults the anchor provider to none', () => {
        writeConfig(tempRoot, validConfig);
        const config = loader.load(tempRoot);
        expect(config.audit.anchor.provider).toBe('none');
      });

      it('is backward-compatible: a config with no audit.anchor still loads', () => {
        // validConfig has no `audit` block at all.
        writeConfig(tempRoot, validConfig);
        expect(() => loader.load(tempRoot)).not.toThrow();
      });

      it('rejects opentimestamps — declared in the enum but not implemented yet', () => {
        // The provider is a documented-but-unshipped target (MNEMA-163): the
        // enum keeps it, but selecting it must fail at config load with an
        // actionable message rather than throwing a raw "unknown anchor
        // provider" deep in the factory at first use.
        writeConfig(tempRoot, {
          ...validConfig,
          audit: { anchor: { provider: 'opentimestamps', interval: { seconds: 86400 } } },
        });
        let caught: unknown;
        try {
          loader.load(tempRoot);
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(ConfigInvalidError);
        // The issue must name the shortfall actionably, not just fail opaquely.
        const issues = JSON.stringify((caught as ConfigInvalidError).issues);
        expect(issues).toMatch(/not implemented yet/);
      });

      it('parses a valid git-signed config with remote and ref', () => {
        writeConfig(tempRoot, {
          ...validConfig,
          audit: {
            anchor: { provider: 'git-signed', remote: 'origin', ref: 'refs/mnema/anchors' },
          },
        });
        const config = loader.load(tempRoot);
        expect(config.audit.anchor.provider).toBe('git-signed');
        expect(config.audit.anchor.remote).toBe('origin');
      });

      it('parses a valid rfc3161 config with a tsa url', () => {
        writeConfig(tempRoot, {
          ...validConfig,
          audit: { anchor: { provider: 'rfc3161', tsa: 'https://tsa.example.com' } },
        });
        const config = loader.load(tempRoot);
        expect(config.audit.anchor.tsa).toBe('https://tsa.example.com');
      });

      it('rejects rfc3161 without a tsa url', () => {
        writeConfig(tempRoot, {
          ...validConfig,
          audit: { anchor: { provider: 'rfc3161' } },
        });
        expect(() => loader.load(tempRoot)).toThrow(ConfigInvalidError);
      });

      it('rejects an unknown provider', () => {
        writeConfig(tempRoot, {
          ...validConfig,
          audit: { anchor: { provider: 'blockchain-magic' } },
        });
        expect(() => loader.load(tempRoot)).toThrow(ConfigInvalidError);
      });

      it('rejects a non-https tsa url (file:// — local-file/SSRF vector)', () => {
        writeConfig(tempRoot, {
          ...validConfig,
          audit: { anchor: { provider: 'rfc3161', tsa: 'file:///etc/passwd' } },
        });
        expect(() => loader.load(tempRoot)).toThrow(ConfigInvalidError);
      });

      it('rejects a plain-http tsa url (loopback/metadata SSRF vector)', () => {
        writeConfig(tempRoot, {
          ...validConfig,
          audit: { anchor: { provider: 'rfc3161', tsa: 'http://169.254.169.254/' } },
        });
        expect(() => loader.load(tempRoot)).toThrow(ConfigInvalidError);
      });

      it('rejects an ext:: remote (git remote-helper command execution)', () => {
        // `git push 'ext::sh -c <payload>'` runs an arbitrary command; the
        // schema must fail closed at load, never handing it to git.
        writeConfig(tempRoot, {
          ...validConfig,
          audit: {
            anchor: { provider: 'git-signed', remote: "ext::sh -c 'touch /tmp/pwned'" },
          },
        });
        expect(() => loader.load(tempRoot)).toThrow(ConfigInvalidError);
      });

      it('rejects a remote starting with "-" (arg parsed as a flag)', () => {
        writeConfig(tempRoot, {
          ...validConfig,
          audit: {
            anchor: { provider: 'git-signed', remote: '--upload-pack=touch /tmp/x' },
          },
        });
        expect(() => loader.load(tempRoot)).toThrow(ConfigInvalidError);
      });

      it('accepts an https remote URL for git-signed', () => {
        writeConfig(tempRoot, {
          ...validConfig,
          audit: {
            anchor: { provider: 'git-signed', remote: 'https://example.com/r.git' },
          },
        });
        const config = loader.load(tempRoot);
        expect(config.audit.anchor.remote).toBe('https://example.com/r.git');
      });
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

    it('rejects a paths.* entry with a ".." segment (traversal)', () => {
      writeConfig(tempRoot, {
        ...validConfig,
        project: { key: 'TEST', name: 'Test project' },
        paths: { backlog: '../../../tmp/escape' },
      });
      expect(() => loader.load(tempRoot)).toThrow(ConfigInvalidError);
    });

    it('rejects a paths.* entry with an absolute path', () => {
      writeConfig(tempRoot, {
        ...validConfig,
        project: { key: 'TEST', name: 'Test project' },
        paths: { audit: '/etc/evil' },
      });
      expect(() => loader.load(tempRoot)).toThrow(ConfigInvalidError);
    });

    it('accepts a nested-but-contained relative paths.* entry', () => {
      writeConfig(tempRoot, {
        ...validConfig,
        project: { key: 'TEST', name: 'Test project' },
        paths: { backlog: './.mnema/sub/backlog' },
      });
      expect(() => loader.load(tempRoot)).not.toThrow();
    });

    it('throws ConfigInvalidError (not a raw SyntaxError) on malformed JSON', () => {
      // Write raw, syntactically broken JSON — not JSON.stringify.
      const configPath = path.join(tempRoot, CONFIG_FILE_RELATIVE);
      mkdirSync(path.dirname(configPath), { recursive: true });
      writeFileSync(configPath, '{ "version": "1.0", broken json');

      let caught: unknown;
      try {
        loader.load(tempRoot);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ConfigInvalidError);
      expect(caught).not.toBeInstanceOf(SyntaxError);
      // The SyntaxError is carried as the issues cause for diagnostics.
      expect((caught as ConfigInvalidError).issues).toBeInstanceOf(SyntaxError);
    });

    it('accepts the argv hook shape { command, args }', () => {
      writeConfig(tempRoot, {
        ...validConfig,
        hooks: { on_task_done: [{ command: './notify.sh', args: ['--to', 'done'] }] },
      });
      const config = loader.load(tempRoot);
      expect(config.hooks.on_task_done).toEqual([
        { command: './notify.sh', args: ['--to', 'done'] },
      ]);
    });

    it('rejects a legacy string hook with an actionable message', () => {
      writeConfig(tempRoot, { ...validConfig, hooks: { on_task_done: ['./notify.sh'] } });

      let caught: unknown;
      try {
        loader.load(tempRoot);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ConfigInvalidError);
      // The message must guide the migration, not just say "expected object".
      const issues = JSON.stringify((caught as ConfigInvalidError).issues);
      expect(issues).toContain('command');
      expect(issues).toContain('./notify.sh');
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

    it('throws UserConfigInvalidError (not a raw SyntaxError) on malformed user JSON', () => {
      writeConfig(tempRoot, validConfig);
      const file = path.join(fakeHome, USER_CONFIG_RELATIVE);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, '{ not valid json ');

      let caught: unknown;
      try {
        scopedLoader.load(tempRoot);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(UserConfigInvalidError);
      expect(caught).not.toBeInstanceOf(SyntaxError);
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

    it('deep-merges the claims block so a local override does not wipe project fields', () => {
      // claims has a single field today, so this guards the merge PATH: a
      // local override of lease_minutes wins, and claims is not replaced
      // wholesale (which is what would silently drop a sibling field the day
      // claims grows a second one — the reason it is in DEEP_MERGE_KEYS).
      writeConfig(tempRoot, {
        ...validConfig,
        claims: { lease_minutes: 45 },
      });
      writeLocalConfig({ claims: { lease_minutes: 10 } });

      const config = loader.load(tempRoot);
      expect(config.claims.lease_minutes).toBe(10); // local wins
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
