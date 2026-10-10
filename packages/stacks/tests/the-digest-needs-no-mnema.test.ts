import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stackDigest, stackListing } from '../src/digest.js';
import { readStackFiles } from '../src/files.js';
import { validateStack } from '../src/validate.js';
import { cleanScratch, DIGEST_SH, HELLO_STACK, put, scratchStack } from './support.js';

/** The golden: a literal, computed once with `digest.sh` and written here. Not recomputed by the code under test. */
const HELLO_STACK_DIGEST = 'df9d8d71cdc13bd89b45af349e677ecfcbe98949805278bd42f16e6c0498f9ed';

const shellDigest = (dir: string): string =>
  execFileSync('sh', [DIGEST_SH, dir], { encoding: 'utf8' }).trim();
const libraryDigest = (dir: string): string | undefined =>
  stackDigest(readStackFiles(dir).files).digest;

afterEach(cleanScratch);

describe('the digest of a stack', () => {
  it('is the golden for hello-stack, by the library and by three lines of shell', () => {
    expect(libraryDigest(HELLO_STACK)).toBe(HELLO_STACK_DIGEST);
    expect(shellDigest(HELLO_STACK)).toBe(HELLO_STACK_DIGEST);
  });

  it('signs a listing whose SHA-256 is the digest, and the shell prints the same bytes', () => {
    const listing = stackListing(readStackFiles(HELLO_STACK).files);
    expect(listing).toBeDefined();
    expect(
      createHash('sha256')
        .update(listing as Uint8Array)
        .digest('hex'),
    ).toBe(HELLO_STACK_DIGEST);
    const shell = execFileSync('sh', [DIGEST_SH, HELLO_STACK, '--listing']);
    expect(Buffer.from(shell).equals(Buffer.from(listing as Uint8Array))).toBe(true);
    expect(Buffer.from(shell).toString('utf8').startsWith('LICENSE\0')).toBe(true);
  });

  it('agrees with the shell over names that sort differently by bytes than by habit', () => {
    const dir = scratchStack();
    for (const name of ['Z', 'a-b', 'a.b', 'a/b', 'a_b', 'é', 'x y']) {
      put(dir, `extra/${name}`, `content of ${name}`);
    }
    expect(libraryDigest(dir)).toBe(shellDigest(dir));
  });

  it('leaves out .git/ and the signature at the root, and nothing else', () => {
    const dir = scratchStack();
    const before = libraryDigest(dir);
    put(dir, '.git/HEAD', 'ref: refs/heads/main\n');
    put(dir, 'stack.sigstore.json', '{}');
    expect(libraryDigest(dir)).toBe(before);
    expect(shellDigest(dir)).toBe(before);
    put(dir, 'skills/hello/stack.sigstore.json', '{}');
    expect(libraryDigest(dir)).not.toBe(before);
    expect(shellDigest(dir)).toBe(libraryDigest(dir));
  });

  it('does not normalize line endings: the bytes are the bytes', () => {
    const dir = scratchStack();
    const before = libraryDigest(dir);
    put(dir, 'LICENSE', 'Apache License 2.0 (a fixture: the full text would sit here).\r\n');
    expect(libraryDigest(dir)).not.toBe(before);
    expect(shellDigest(dir)).toBe(libraryDigest(dir));
  });

  it('moves with one byte of any file and with a rename', () => {
    const dir = scratchStack();
    const before = libraryDigest(dir);
    put(dir, 'skills/hello/references/a.md', 'a');
    const withOne = libraryDigest(dir);
    expect(withOne).not.toBe(before);
    put(dir, 'skills/hello/references/a.md', 'b');
    expect(libraryDigest(dir)).not.toBe(withOne);
  });

  it('refuses a symlink, wherever it points', () => {
    const dir = scratchStack();
    symlinkSync('/etc/hostname', join(dir, 'link'));
    expect(readStackFiles(dir).problems.map((p) => p.code)).toEqual(['symlink']);
    expect(validateStack(dir).ok).toBe(false);
  });

  it('refuses a path that leaves the root, a name that is not NFC, and a name with a newline', () => {
    const bytes = new Uint8Array();
    expect(stackDigest([{ path: '../outside', bytes }]).refusals[0]?.problem).toBe(
      'outside-the-root',
    );
    expect(stackDigest([{ path: '/abs', bytes }]).refusals[0]?.problem).toBe('outside-the-root');
    expect(stackDigest([{ path: 'a//b', bytes }]).refusals[0]?.problem).toBe('outside-the-root');
    expect(stackDigest([{ path: 'é', bytes }]).refusals[0]?.problem).toBe('not-normalized');
    expect(stackDigest([{ path: 'a\nb', bytes }]).refusals[0]?.problem).toBe(
      'unreadable-by-the-reproducer',
    );
    expect(
      stackDigest([
        { path: 'a', bytes },
        { path: 'a', bytes },
      ]).refusals[0]?.problem,
    ).toBe('duplicate');
    expect(stackDigest([{ path: '../outside', bytes }]).digest).toBeUndefined();
  });

  it('reports a refused name through the validator, not only the digest', () => {
    const dir = scratchStack();
    mkdirSync(join(dir, 'x'));
    put(dir, 'x/é', 'decomposed');
    const report = validateStack(dir);
    expect(report.problems.map((p) => p.code)).toContain('path-refused');
    expect(report.digest).toBeUndefined();
  });
});
