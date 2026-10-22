import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileBehindAPath } from './file-behind-a-path.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-file-behind-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

describe('fileBehindAPath', () => {
  it('says a file exists and gives the digest of its bytes', () => {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n');
    expect(fileBehindAPath(root, 'src/a.ts')).toEqual({
      path: 'src/a.ts',
      exists: true,
      kind: 'file',
      bytes: 20,
      sha256: sha256('export const a = 1;\n'),
    });
  });

  it('reads an absolute path under the root and a ./ spelling as the same file', () => {
    writeFileSync(join(root, 'a.txt'), 'x');
    const relative = fileBehindAPath(root, 'a.txt');
    expect(fileBehindAPath(root, './a.txt')).toEqual(relative);
    expect(fileBehindAPath(root, join(root, 'a.txt'))).toEqual(relative);
  });

  it('says a path that is not there is not there, and gives no digest', () => {
    expect(fileBehindAPath(root, 'nothere.txt')).toEqual({ path: 'nothere.txt', exists: false });
  });

  it('names a directory and does not hash it', () => {
    mkdirSync(join(root, 'docs'));
    expect(fileBehindAPath(root, 'docs')).toEqual({
      path: 'docs',
      exists: true,
      kind: 'directory',
    });
  });

  it('does not follow a link: it says what it is', () => {
    writeFileSync(join(root, 'a.txt'), 'x');
    symlinkSync(join(root, 'a.txt'), join(root, 'link.txt'));
    expect(fileBehindAPath(root, 'link.txt')).toEqual({
      path: 'link.txt',
      exists: true,
      kind: 'other',
    });
  });

  it('answers nothing for a path outside the root: it is not read', () => {
    expect(fileBehindAPath(root, '../elsewhere')).toBeUndefined();
    expect(fileBehindAPath(root, '/etc/passwd')).toBeUndefined();
  });

  it('answers nothing for a file reached through a directory link that leads out of the project', () => {
    const outside = mkdtempSync(join(tmpdir(), 'mnema-outside-'));
    try {
      writeFileSync(join(outside, 'outside.txt'), 'secret');
      symlinkSync(outside, join(root, 'lnk'));
      expect(fileBehindAPath(root, 'lnk/outside.txt')).toBeUndefined();
      // Any component, not only the first: a link one level down leads out the same way.
      mkdirSync(join(root, 'a'));
      symlinkSync(outside, join(root, 'a', 'deep'));
      expect(fileBehindAPath(root, 'a/deep/outside.txt')).toBeUndefined();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('still follows a directory link that stays inside the project', () => {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.ts'), 'x');
    symlinkSync(join(root, 'src'), join(root, 'alias'));
    expect(fileBehindAPath(root, 'alias/a.ts')).toMatchObject({
      exists: true,
      kind: 'file',
      sha256: sha256('x'),
    });
  });

  it('answers nothing for an id: an entity is not a file', () => {
    expect(fileBehindAPath(root, '01a164a2-d991-7000-b03a-58c41c82ec80')).toBeUndefined();
  });
});
