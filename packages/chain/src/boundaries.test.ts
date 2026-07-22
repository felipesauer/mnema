import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The proof engine must stay a pure, zero-dependency core: it is the surface
 * that carries tamper-evidence, so it cannot be contaminated by the domain,
 * the surfaces, or any third-party runtime code. These guards fail loudly the
 * moment that invariant is about to erode — a broken boundary here is a design
 * regression, not a passing test with a warning.
 */
describe('@mnema/chain boundaries', () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf-8'),
  ) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };

  it('declares no runtime dependencies', () => {
    expect(manifest.dependencies ?? {}).toEqual({});
  });

  it('declares no peer dependencies', () => {
    expect(manifest.peerDependencies ?? {}).toEqual({});
  });

  // A clean package.json is necessary but not sufficient: an import of
  // `@mnema/core` (or any bare package) would resolve through the workspace at
  // test time and never touch `dependencies`, so the manifest checks above would
  // stay green while the boundary was already broken. This walks the actual
  // source and fails on any import that is not relative or a `node:` builtin —
  // the only two kinds the zero-dependency proof engine may use.
  it('imports nothing but relative modules and node builtins (no upward or bare imports)', () => {
    const srcDir = fileURLToPath(new URL('.', import.meta.url));
    const offenders: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      const text = readFileSync(file, 'utf-8');
      for (const spec of importSpecifiers(text)) {
        const allowed = spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('node:');
        if (!allowed) {
          offenders.push(`${file.slice(srcDir.length)} imports "${spec}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/** Every `.ts` source file under a directory, recursively, tests excluded. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

/** The module specifiers of every static `import`/`export ... from` in a file. */
function importSpecifiers(text: string): string[] {
  const specs: string[] = [];
  // Matches `from '...'` / `from "..."` of import and re-export statements —
  // the static module graph. Dynamic import() is not used in the chain.
  const re = /\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    specs.push(m[1] as string);
  }
  // Bare `import '...'` side-effect imports too.
  const sideEffect = /\bimport\s*['"]([^'"]+)['"]/g;
  for (let m = sideEffect.exec(text); m !== null; m = sideEffect.exec(text)) {
    specs.push(m[1] as string);
  }
  return specs;
}
