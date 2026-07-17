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
      expect(config.sync.agent_buffer_flush_seconds).toBe(30);
      expect(config.features.knowledge).toBe(true);
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
        sync: { agent_buffer_flush_seconds: 7, agent_buffer_flush_count: 99 },
      });
      writeLocalConfig({ sync: { agent_buffer_flush_count: 5 } });

      const config = loader.load(tempRoot);
      expect(config.sync.agent_buffer_flush_count).toBe(5); // local wins
      expect(config.sync.agent_buffer_flush_seconds).toBe(7); // project fills the gap
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

    it('the stack is exactly two layers: project < local', () => {
      writeConfig(tempRoot, { ...validConfig, enforcement_mode: 'strict' });
      writeLocalConfig({ enforcement_mode: 'advisory' });

      expect(loader.load(tempRoot).enforcement_mode).toBe('advisory');
    });

    it('deep-merges eval and archive too — every top-level object block merges by derivation', () => {
      // The merge set is DERIVED from the schema shape, so blocks that a
      // hand-written list once forgot (eval, archive) merge by construction.
      writeConfig(tempRoot, { ...validConfig, archive: { terminal_after_months: 3 } });
      writeLocalConfig({ eval: { guided_proxy: 'bootstrap' } });

      const config = loader.load(tempRoot);
      expect(config.eval.guided_proxy).toBe('bootstrap');
      expect(config.archive.terminal_after_months).toBe(3);
    });

    it('rejects an unknown top-level key in the local override', () => {
      writeConfig(tempRoot, validConfig);
      writeLocalConfig({ not_a_real_key: true });

      expect(() => loader.load(tempRoot)).toThrow(LocalConfigInvalidError);
    });

    it('a bad local VALUE fails post-merge with the schema error (single validation)', () => {
      writeConfig(tempRoot, validConfig);
      writeLocalConfig({ enforcement_mode: 'nonsense' });

      expect(() => loader.load(tempRoot)).toThrow(ConfigInvalidError);
    });

    it('rejects a local override that sets a project-only key', () => {
      writeConfig(tempRoot, validConfig);
      writeLocalConfig({ project: { key: 'OTHER', name: 'Nope' } });

      expect(() => loader.load(tempRoot)).toThrow(LocalConfigInvalidError);
    });
  });
});
