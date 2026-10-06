/**
 * THE EXTENSION'S FILE HOLDS NO DATABASE.
 *
 * The editor runs an extension in Electron, whose native ABI is not the one `better-sqlite3` was
 * built for, so a bundle that reaches `@mnema/core`'s entry installs fine and fails to start. This
 * builds the file the way `package` does and reads what it is made of: the source files whose code
 * is in it, and every module it asks the runtime for. Putting `import ... from '@mnema/core'` (or
 * `@mnema/context`) back in `rules.ts` in place of the two functions it uses today pulls the whole
 * barrel in, and this goes red on `better-sqlite3`.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BUNDLE = fileURLToPath(new URL('../build/bundle.mjs', import.meta.url));

let sources: string[];
let text: string;
let scratch: string;

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'mnema-bundle-test-'));
  const { bundle } = (await import(BUNDLE)) as {
    bundle: (outfile: string) => Promise<string[]>;
  };
  sources = await bundle(join(scratch, 'extension.cjs'));
  text = readFileSync(join(scratch, 'extension.cjs'), 'utf8');
}, 60_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('the bundled extension', () => {
  it('asks the runtime for node built-ins and the editor, and for nothing installed', () => {
    const asked = [...text.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
    expect(asked).toContain('vscode');
    const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
    expect(asked.filter((name) => name !== 'vscode' && !builtins.has(name))).toEqual([]);
  });

  it('carries no database, not the native addon and not the core entry that opens it', () => {
    expect(text).not.toContain('better-sqlite3');
    expect(sources.filter((file) => /better-sqlite3|\/core\/dist\/index\.js$/.test(file))).toEqual(
      [],
    );
  });

  it('is its own sources and the two pure functions it asks of the workspace packages', () => {
    const workspace = sources.filter((file) => file.startsWith('..'));
    expect(workspace.sort()).toEqual([
      '../context/dist/context/decisions.js',
      '../context/dist/context/disposition.js',
      '../core/dist/workflow/decision-states.js',
    ]);
  });
});
