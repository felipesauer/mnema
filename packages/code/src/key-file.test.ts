import { describe, expect, it } from 'vitest';
import { keyFileLine } from './key-file.js';

describe('where the key file is, and the setting that put it there', () => {
  it('names the directory MNEMA_HOME names, when it is set', () => {
    expect(keyFileLine('/keys/identity/abc.key', '/keys')).toBe(
      'this machine keeps the key file at /keys/identity/abc.key, under /keys, the directory MNEMA_HOME names',
    );
  });

  it('names ~/.mnema, and the variable that moves it, when MNEMA_HOME is unset or empty', () => {
    for (const unset of [undefined, '']) {
      const line = keyFileLine('/home/a/.mnema/identity/abc.key', unset);
      expect(line).toContain('under ~/.mnema, since MNEMA_HOME is not set');
      expect(line).toContain('signs when MNEMA_HOME names that directory');
    }
  });

  it('keeps a path holding a newline to one line', () => {
    expect(keyFileLine('/a\nb.key', '/a\nb')).not.toContain('\n');
  });
});

describe('the one place the line is worded', () => {
  it('is this module: no other source of the package spells it', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join, relative } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const src = fileURLToPath(new URL('.', import.meta.url));
    const spelling: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          if (readFileSync(path, 'utf-8').includes('keeps the key file at')) {
            spelling.push(relative(src, path));
          }
        }
      }
    };
    walk(src);
    expect(spelling).toEqual(['key-file.ts']);
  });
});
