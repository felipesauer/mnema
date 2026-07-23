import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The copilot is a READ-only layer. It reads the proven record (the core's
 * projections and its gate) and composes context from it — it never emits an
 * event, never writes state, never decides a fact. That is the whole reason it
 * is a package of its own and not folded into the core: the compiler and this
 * suite together make "reads only" an enforced property, not a promise.
 *
 * The boundary is STRUCTURAL, not a hand-maintained list. The core splits its
 * surface in two: `@mnema/core` (reads — projections, the pure gate, workflow
 * tables, identity and scope resolution) and `@mnema/core/write` (every write —
 * the operations that append events, and opening a tree's writer). A read-only
 * layer imports the read surface and NEVER the write subpath. A new write
 * operation added to the core is born on `/write`, so it is caught here with no
 * list to update — the guard is "does the source name the write subpath?".
 *
 * Two writing surfaces exist, so there are two structural bans:
 *   1. `@mnema/core/write` — the core's own write operations.
 *   2. `@mnema/chain` DIRECTLY — the chain is reachable transitively (it is the
 *      core's dependency), and it holds writers the `/write` ban does not cover:
 *      the raw builders, `openChainForWriting`, and `writeAnchor`/`persistKeyPair`
 *      which write to disk WITHOUT going through `.append`. The copilot reaches
 *      every chain TYPE it needs through the core's re-exports, so its source
 *      never names `@mnema/chain` at all. (Test support under `tests/` may — it
 *      builds fixture chains — and is not scanned here, which walks `src/` only.)
 * The `.append(` guard below is a third, independent net for a writer obtained
 * some other way (passed in as a parameter, say).
 */
describe('@mnema/copilot boundaries', () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf-8'),
  ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

  it('depends at runtime on the core alone (a layer above the domain)', () => {
    // The dependency direction is copilot → core → chain. The copilot reaches
    // chain types transitively through the core; declaring the chain as a
    // RUNTIME dependency would let it reach past the domain to the raw
    // writer/builders. (The chain appears in devDependencies only, so the test
    // support can build fixture chains — the shipped package never loads it.)
    const deps = manifest.dependencies ?? {};
    expect(Object.keys(deps)).toEqual(['@mnema/core']);
  });

  it('never imports a writing surface (@mnema/core/write, nor @mnema/chain directly)', () => {
    // The rule that makes read-only future-proof: the copilot source may name
    // neither writing surface. `@mnema/core/write` holds the core's write
    // operations; `@mnema/chain` (reachable transitively) holds the raw builders,
    // `openChainForWriting`, and the disk-writing `writeAnchor`/`persistKeyPair`
    // that the `/write` ban would miss. A write the core grows is born on
    // `/write`; a chain writer is only reachable by naming `@mnema/chain` — so
    // banning both module specifiers catches every path with no list of symbol
    // names to keep in sync. Matches both `from '<spec>'` and a dynamic
    // `import('<spec>')`, single or double quoted. The chain match is anchored so
    // it does not also flag a hypothetical `@mnema/chain-something` read package.
    const FORBIDDEN_IMPORTS = [/@mnema\/core\/write/, /@mnema\/chain(?![\w-])/];
    const offenders: string[] = [];
    const srcDir = fileURLToPath(new URL('.', import.meta.url));
    for (const file of sourceFiles(srcDir)) {
      const text = readFileSync(file, 'utf-8');
      for (const spec of FORBIDDEN_IMPORTS) {
        if (spec.test(text)) offenders.push(`${file.slice(srcDir.length)} names ${spec.source}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('appends to no ChainWriter (no `.append(` call anywhere)', () => {
    // A second, independent guard: the single method by which any event reaches a
    // chain. Even if a writer were somehow obtained (passed in as a parameter, say),
    // a read-only layer never calls `.append(`. Structural ban + this method ban
    // together leave no path to a write.
    const srcDir = fileURLToPath(new URL('.', import.meta.url));
    const offenders: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      const text = readFileSync(file, 'utf-8');
      if (/\.append\s*\(/.test(text)) offenders.push(file.slice(srcDir.length));
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
