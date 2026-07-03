import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectSecretService } from '@/services/project-secret.js';

/**
 * The per-project HMAC secret (ADR-37 layer 2) must live outside the repo
 * at ~/.config/mnema/projects/<key>/hmac.key (0600), never leak into
 * .mnema/, and be anchored by a committed non-secret fingerprint. Tests
 * point `home` at a temp dir so nothing touches the real ~/.config.
 */
describe('ProjectSecretService', () => {
  let root: string;
  let projectRoot: string;
  let home: string;
  let svc: ProjectSecretService;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'mnema-secret-'));
    projectRoot = path.join(root, 'proj');
    home = path.join(root, 'home');
    mkdirSync(path.join(projectRoot, '.mnema'), { recursive: true });
    mkdirSync(home, { recursive: true });
    svc = new ProjectSecretService(projectRoot, 'SMOKE', () => home);
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
    expect(svc.secretPath()).toBe(
      path.join(home, '.config', 'mnema', 'projects', 'SMOKE', 'hmac.key'),
    );
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
    const other = new ProjectSecretService(projectRoot, 'SMOKE', () => home).getOrCreate();
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
});
