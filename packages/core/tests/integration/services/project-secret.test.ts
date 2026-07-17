import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectSecretService } from '@/services/integrity/project-secret.js';

/**
 * The per-project HMAC secret (ADR-37 layer 2) must live outside the repo
 * at ~/.config/mnema/projects/<key>/hmac.key (0600), never leak into
 * .mnema/, and be anchored by a committed non-secret fingerprint. Tests
 * point `home` at a temp dir so nothing touches the real ~/.config.
 */
describe('ProjectSecretService', () => {
  let root: string;
  let projectRoot: string;
  let userDir: string;
  let svc: ProjectSecretService;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'mnema-secret-'));
    projectRoot = path.join(root, 'proj');
    // Isolated user-level dir (the `~/.config/mnema` equivalent) so the
    // test never touches the developer's real home.
    userDir = path.join(root, 'home', '.config', 'mnema');
    mkdirSync(path.join(projectRoot, '.mnema'), { recursive: true });
    mkdirSync(userDir, { recursive: true });
    svc = new ProjectSecretService(projectRoot, 'SMOKE', userDir);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Every byte-sequence of every file under the project's .mnema/. */
  function mnemaFileContents(): Buffer[] {
    const dir = path.join(projectRoot, '.mnema');
    const out: Buffer[] = [];
    for (const e of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (e.isFile()) out.push(readFileSync(path.join(e.parentPath, e.name)));
    }
    return out;
  }

  it('generates a 32-byte secret at ~/.config/mnema/projects/<key>/hmac.key with 0600', () => {
    const secret = svc.getOrCreate();
    expect(secret).toHaveLength(32);
    expect(svc.secretPath()).toBe(path.join(userDir, 'projects', 'SMOKE', 'hmac.key'));
    expect(statSync(svc.secretPath()).mode & 0o777).toBe(0o600);
  });

  it('records a committed fingerprint = sha256(secret) and never writes the secret under .mnema', () => {
    const secret = svc.getOrCreate();
    // Fingerprint is committed under .mnema/keys/ and matches sha256(secret).
    expect(svc.fingerprintPath()).toBe(path.join(projectRoot, '.mnema', 'keys', 'project.hmac-id'));
    expect(svc.readFingerprint()).toBe(ProjectSecretService.fingerprint(secret));

    // The raw secret (bytes AND hex) appears in NO file under .mnema/.
    const hex = Buffer.from(secret.toString('hex'), 'utf-8');
    for (const content of mnemaFileContents()) {
      expect(content.includes(secret)).toBe(false);
      expect(content.includes(hex)).toBe(false);
    }
  });

  it('is idempotent: an existing secret is returned untouched, not regenerated', () => {
    const first = svc.getOrCreate();
    const second = svc.getOrCreate();
    expect(second.equals(first)).toBe(true);
    // A second service instance on the same paths sees the same secret.
    const other = new ProjectSecretService(projectRoot, 'SMOKE', userDir).getOrCreate();
    expect(other.equals(first)).toBe(true);
  });

  it('self-heals a missing fingerprint without changing the secret', () => {
    const secret = svc.getOrCreate();
    rmSync(svc.fingerprintPath()); // simulate a clone that has the secret but lost the anchor
    expect(svc.readFingerprint()).toBeNull();

    const again = svc.getOrCreate();
    expect(again.equals(secret)).toBe(true); // secret unchanged
    expect(svc.readFingerprint()).toBe(ProjectSecretService.fingerprint(secret)); // fingerprint restored
  });

  it('returned secret always matches the persisted fingerprint (concurrency-safe contract)', () => {
    const secret = svc.getOrCreate();
    // Whatever getOrCreate returns must verify against what it wrote — the
    // property that must hold even if a concurrent first-write raced.
    expect(ProjectSecretService.fingerprint(secret)).toBe(svc.readFingerprint());
    expect(secret.equals(svc.read() as Buffer)).toBe(true);
  });

  describe('export / import (team credential sharing, ADR-39)', () => {
    /** A second machine: same project root (the clone), a different user dir. */
    function secondMachine(): ProjectSecretService {
      const otherHome = path.join(root, 'home2', '.config', 'mnema');
      mkdirSync(otherHome, { recursive: true });
      return new ProjectSecretService(projectRoot, 'SMOKE', otherHome);
    }

    it('round-trips: export then import into a second home reproduces the same secret', () => {
      const secret = svc.getOrCreate();
      const envelope = svc.exportEnvelope();
      expect(envelope).toMatch(/^mnema-hmac-secret\/v1:SMOKE:/);

      const other = secondMachine();
      expect(other.read()).toBeNull(); // clone-without-import starts empty
      other.install(other.parseEnvelope(envelope));

      const imported = other.read();
      expect(imported).not.toBeNull();
      expect((imported as Buffer).equals(secret)).toBe(true);
      // The installed file is 0600.
      expect(statSync(other.secretPath()).mode & 0o777).toBe(0o600);
      // After import the fingerprint verifies for the clone.
      expect(other.readFingerprint()).toBe(ProjectSecretService.fingerprint(secret));
    });

    it('export refuses (clear error) when no secret exists on this machine', () => {
      // svc has not minted a secret yet.
      expect(() => svc.exportEnvelope()).toThrow(/no project secret on this machine/i);
    });

    it('import rejects a secret whose fingerprint does not match the committed one', () => {
      svc.getOrCreate(); // commits SMOKE's fingerprint
      const other = secondMachine();
      // An envelope for the right project label but a DIFFERENT (wrong) secret.
      const wrong = Buffer.alloc(32, 7);
      const forged = `mnema-hmac-secret/v1:SMOKE:${wrong.toString('base64')}`;
      expect(() => other.install(other.parseEnvelope(forged))).toThrow(/committed fingerprint/i);
    });

    it('import refuses to overwrite an existing secret without force', () => {
      svc.getOrCreate();
      const envelope = svc.exportEnvelope();
      // Re-importing over the SAME machine that already has the secret.
      expect(() => svc.install(svc.parseEnvelope(envelope))).toThrow(/already exists.*--force/i);
      // With force it succeeds (and stays the same secret).
      expect(() => svc.install(svc.parseEnvelope(envelope), { force: true })).not.toThrow();
    });

    it('parseEnvelope rejects a wrong-project envelope', () => {
      svc.getOrCreate();
      const envelope = svc.exportEnvelope().replace('SMOKE', 'OTHER');
      expect(() => svc.parseEnvelope(envelope)).toThrow(
        /project "OTHER".*this project is "SMOKE"/i,
      );
    });

    it('parseEnvelope rejects a corrupted/short blob', () => {
      const shortBlob = `mnema-hmac-secret/v1:SMOKE:${Buffer.alloc(8).toString('base64')}`;
      expect(() => svc.parseEnvelope(shortBlob)).toThrow(/32 bytes, got 8/i);
    });

    it('parseEnvelope rejects a non-envelope string', () => {
      expect(() => svc.parseEnvelope('just some text')).toThrow(
        /not a mnema HMAC secret envelope/i,
      );
    });
  });
});
