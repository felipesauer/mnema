import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MachineKeyService, type PublicKeyRecord } from '@/services/machine-key.js';

/**
 * The per-machine Ed25519 keypair (ADR-37 layer 2) signs the periodic chain
 * head. The PRIVATE key must live outside the repo at
 * ~/.config/mnema/keys/<actor>.ed25519 (0600) and never leak into .mnema/;
 * the PUBLIC key is committed under .mnema/keys/ so a clone can verify. Two
 * machines sharing one actor must not clobber each other's public key.
 * Tests point `userDir` at a temp dir so nothing touches the real ~/.config.
 */
describe('MachineKeyService', () => {
  let root: string;
  let projectRoot: string;
  let userDir: string;
  let svc: MachineKeyService;
  const clock = () => new Date('2026-07-03T12:00:00.000Z');

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'mnema-machinekey-'));
    projectRoot = path.join(root, 'proj');
    userDir = path.join(root, 'home', '.config', 'mnema');
    mkdirSync(path.join(projectRoot, '.mnema'), { recursive: true });
    mkdirSync(userDir, { recursive: true });
    svc = new MachineKeyService(projectRoot, 'felipesauer', userDir, clock);
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

  it('creates the private key at ~/.config/mnema/keys/<actor>.ed25519 with 0600', () => {
    svc.getOrCreate();
    expect(svc.privateKeyPath()).toBe(path.join(userDir, 'keys', 'felipesauer.ed25519'));
    expect(statSync(svc.privateKeyPath()).mode & 0o777).toBe(0o600);
  });

  it('keeps the private key OUTSIDE .mnema/ and its bytes never appear under it', () => {
    svc.getOrCreate();
    const priv = readFileSync(svc.privateKeyPath());
    // Path-level: the key is not under the repo's .mnema/.
    const rel = path.relative(path.join(projectRoot, '.mnema'), svc.privateKeyPath());
    expect(rel.startsWith('..')).toBe(true);
    // Byte-level: the PKCS8 PEM (and its base64 body) appears in NO file
    // under .mnema/. This is the load-bearing security assertion.
    const b64 = Buffer.from(
      priv
        .toString('utf-8')
        .replace(/-----[^-]+-----/g, '')
        .replace(/\s/g, ''),
      'utf-8',
    );
    for (const content of mnemaFileContents()) {
      expect(content.includes(priv)).toBe(false);
      expect(content.includes(b64)).toBe(false);
    }
  });

  it('commits a public-key record under .mnema/keys/ named <actor>.<fp12>.pub', () => {
    const pair = svc.getOrCreate();
    const pubPath = svc.publicKeyPath();
    expect(path.dirname(pubPath)).toBe(path.join(projectRoot, '.mnema', 'keys'));
    expect(path.basename(pubPath)).toMatch(/^felipesauer\.[0-9a-f]{12}\.pub$/);
    expect(path.basename(pubPath)).toBe(`felipesauer.${pair.fingerprint.slice(0, 12)}.pub`);
  });

  it('records actor + algorithm + SPKI-PEM key + sha256(DER) fingerprint in the .pub', () => {
    const pair = svc.getOrCreate();
    const record = JSON.parse(readFileSync(svc.publicKeyPath(), 'utf-8')) as PublicKeyRecord;
    expect(record.version).toBe('1.0');
    expect(record.actor).toBe('felipesauer');
    expect(record.algorithm).toBe('ed25519');
    expect(record.publicKey).toContain('BEGIN PUBLIC KEY');
    expect(record.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(record.fingerprint).toBe(pair.fingerprint);
    expect(record.createdAt).toBe('2026-07-03T12:00:00.000Z');
  });

  it('round-trips: a signature made with the private key verifies with the committed public key', () => {
    svc.getOrCreate();
    const message = Buffer.from('the-head-hash', 'utf-8');
    const sig = svc.sign(message);
    const record = svc.readPublicKey() as PublicKeyRecord;
    expect(MachineKeyService.verify(message, sig, record.publicKey)).toBe(true);
    // A mutated message no longer verifies.
    expect(MachineKeyService.verify(Buffer.from('tampered'), sig, record.publicKey)).toBe(false);
  });

  it('rejects a signature made with a different key', () => {
    svc.getOrCreate();
    const message = Buffer.from('the-head-hash', 'utf-8');
    const sig = svc.sign(message);
    // A second actor's key must not verify the first's signature.
    const other = new MachineKeyService(projectRoot, 'maria', userDir, clock);
    other.getOrCreate();
    const otherRecord = other.readPublicKey() as PublicKeyRecord;
    expect(MachineKeyService.verify(message, sig, otherRecord.publicKey)).toBe(false);
  });

  it('is idempotent: an existing private key is returned untouched, not regenerated', () => {
    const first = svc.getOrCreate();
    const mtime = statSync(svc.privateKeyPath()).mtimeMs;
    // Fresh instance on the same paths sees the same key and does not rewrite.
    const other = new MachineKeyService(projectRoot, 'felipesauer', userDir, clock).getOrCreate();
    expect(other.fingerprint).toBe(first.fingerprint);
    expect(statSync(svc.privateKeyPath()).mtimeMs).toBe(mtime);
  });

  it('self-heals a missing .pub without changing the private key', () => {
    const first = svc.getOrCreate();
    rmSync(svc.publicKeyPath());
    // A fresh instance (cache cleared) must recreate the .pub, same key.
    const fresh = new MachineKeyService(projectRoot, 'felipesauer', userDir, clock);
    const again = fresh.getOrCreate();
    expect(again.fingerprint).toBe(first.fingerprint);
    expect(fresh.readPublicKey()?.fingerprint).toBe(first.fingerprint);
  });

  it('gives two DIFFERENT actors on one machine distinct key files', () => {
    const a = svc.getOrCreate();
    const b = new MachineKeyService(projectRoot, 'maria', userDir, clock).getOrCreate();
    expect(a.fingerprint).not.toBe(b.fingerprint);
    expect(statSync(path.join(userDir, 'keys', 'felipesauer.ed25519')).mode & 0o777).toBe(0o600);
    expect(statSync(path.join(userDir, 'keys', 'maria.ed25519')).mode & 0o777).toBe(0o600);
  });

  it('lets two machines sharing ONE actor write distinct .pub files with no clobber', () => {
    // Machine A.
    svc.getOrCreate();
    const aSig = svc.sign(Buffer.from('head', 'utf-8'));
    const aPub = svc.publicKeyPath();
    // Machine B: same projectRoot + same actor, DIFFERENT userDir (its own
    // private key). It must NOT overwrite A's committed .pub.
    const userDirB = path.join(root, 'home2', '.config', 'mnema');
    mkdirSync(userDirB, { recursive: true });
    const svcB = new MachineKeyService(projectRoot, 'felipesauer', userDirB, clock);
    svcB.getOrCreate();
    const bPub = svcB.publicKeyPath();

    expect(bPub).not.toBe(aPub); // distinct fingerprint ⇒ distinct filename
    // A's committed key still exists and still verifies A's signature.
    const aRecord = MachineKeyService.parsePublicKey(readFileSync(aPub, 'utf-8'));
    expect(MachineKeyService.verify(Buffer.from('head', 'utf-8'), aSig, aRecord.publicKey)).toBe(
      true,
    );
    // Both .pub files coexist under the one keys/ dir.
    const pubs = readdirSync(path.join(projectRoot, '.mnema', 'keys')).filter((f) =>
      f.endsWith('.pub'),
    );
    expect(pubs).toHaveLength(2);
  });

  it('parsePublicKey rejects a record whose fingerprint disagrees with its key', () => {
    svc.getOrCreate();
    const record = JSON.parse(readFileSync(svc.publicKeyPath(), 'utf-8')) as PublicKeyRecord;
    const tampered = JSON.stringify({ ...record, fingerprint: 'deadbeef'.repeat(8) });
    expect(() => MachineKeyService.parsePublicKey(tampered)).toThrow(/fingerprint/i);
  });

  it('rejects an invalid actor handle at construction', () => {
    expect(() => new MachineKeyService(projectRoot, 'agent:claude', userDir)).toThrow(/handle/i);
    expect(() => new MachineKeyService(projectRoot, '..', userDir)).toThrow(/handle/i);
    expect(() => new MachineKeyService(projectRoot, 'has space', userDir)).toThrow(/handle/i);
  });
});
