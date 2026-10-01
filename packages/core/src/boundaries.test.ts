import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The core is the domain, and the dependency direction is copilot -> core -> chain and
 * code -> core: the surfaces above read the core, the core knows nothing of them. A core
 * that imported `@mnema/copilot` or `@mnema/code` would make the layer under the
 * product depend on the product, and the cycle would resolve at test time through the
 * workspace without anything turning red.
 *
 * Three doors are shut, because each one lets the import in without the other two
 * noticing: a bare specifier (`@mnema/copilot`, `@mnema/code`, and any subpath of
 * either), a RELATIVE specifier that climbs out of this package into a sibling's
 * directory, and a manifest that declares either as a dependency of any kind. Tests
 * under this package are read too: a test that reaches up is the same arrow pointing the
 * wrong way, and a `devDependency` is how it would be declared.
 */
const PACKAGE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ABOVE = ['@mnema/copilot', '@mnema/code'] as const;
/** This file spells every forbidden import as a sample, so the walk reads everything BUT it. */
const SELF = fileURLToPath(import.meta.url);

/** Does a specifier name a package above the core, however it is spelled? */
function pointsAbove(spec: string, from: string): boolean {
  if (ABOVE.some((name) => spec === name || spec.startsWith(`${name}/`))) return true;
  if (!spec.startsWith('.')) return false;
  const inside = relative(PACKAGE, resolve(dirname(from), spec));
  return inside === '..' || inside.startsWith(`..${sep}`);
}

/** Every module specifier a file names: static, re-export, side-effect, dynamic, require. */
function specifiers(text: string): string[] {
  const found: string[] = [];
  const forms = [
    /\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const form of forms) {
    for (let m = form.exec(text); m !== null; m = form.exec(text)) found.push(m[1] as string);
  }
  return found;
}

/** Every `.ts` file of the package, tests included, and nothing that is built or installed. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

describe('@mnema/core boundaries', () => {
  it('declares no package above it, as any kind of dependency', () => {
    const manifest = JSON.parse(readFileSync(`${PACKAGE}/package.json`, 'utf-8')) as Record<
      string,
      Record<string, string> | undefined
    >;
    const declared = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
      .flatMap((kind) => Object.keys(manifest[kind] ?? {}))
      .filter((name) => ABOVE.some((above) => name === above));
    expect(declared).toEqual([]);
  });

  it('imports neither @mnema/copilot nor @mnema/code, by name or by a path that climbs out', () => {
    const files = sourceFiles(PACKAGE);
    // A walk that found nothing would pass for the wrong reason.
    expect(files.length).toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const file of files.filter((candidate) => candidate !== SELF)) {
      for (const spec of specifiers(readFileSync(file, 'utf-8'))) {
        if (pointsAbove(spec, file)) offenders.push(`${relative(PACKAGE, file)} imports "${spec}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('recognizes each way of pointing above, or the walk above proves nothing', () => {
    const from = `${PACKAGE}/src/workflow/x.ts`;
    for (const spec of [
      '@mnema/copilot',
      '@mnema/code',
      '@mnema/copilot/context',
      '@mnema/code/dist/cli.js',
      '../../../copilot/src/index.js',
      '../../../code/src/cli.js',
    ]) {
      expect(pointsAbove(spec, from), spec).toBe(true);
    }
    for (const spec of [
      '@mnema/chain',
      '@mnema/code-style',
      './sibling.js',
      '../identity/x.js',
      'node:fs',
    ]) {
      expect(pointsAbove(spec, from), spec).toBe(false);
    }
    expect(
      specifiers(
        [
          "import { a } from '@mnema/copilot';",
          "export * from '@mnema/code';",
          "import '@mnema/code/x';",
          "const m = await import('@mnema/copilot');",
          "const r = require('@mnema/code');",
        ].join('\n'),
      ),
    ).toEqual(['@mnema/copilot', '@mnema/code', '@mnema/code/x', '@mnema/copilot', '@mnema/code']);
  });
});
