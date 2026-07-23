import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The copilot is a READ-only layer. It reads the proven record (the core's
 * projections and its gate) and composes context from it — it never emits an
 * event, never writes state, never decides a fact. That is the whole reason it
 * is a package of its own and not folded into the core: the compiler and this
 * suite together make "reads only" an enforced property, not a promise. If a
 * derivation ever needed to write, it would not be a derivation — it would
 * belong in the core — and these guards fail the moment that line is crossed.
 *
 * This mirrors the chain's zero-dependency boundary, but the invariant is
 * different: the copilot MAY import @mnema/core and node builtins; what it may
 * never touch is anything that WRITES — an operation that appends an event, a
 * function that materializes the cache, or the chain writer itself.
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
    // support can build fixture chains — the shipped package never loads it,
    // and the source guard below proves the source never names its writers.)
    const deps = manifest.dependencies ?? {};
    expect(Object.keys(deps)).toEqual(['@mnema/core']);
  });

  // The names of everything in the core (and, transitively, the chain) that
  // WRITES — appends an event, materializes the cache, or opens/drives the
  // writer. A read-only layer references none of them. This is a denylist, not
  // an allowlist, on purpose: the copilot is free to read anything the core
  // exposes, and only the writing surface is forbidden. A new writing export in
  // the core should be added here the day it lands.
  const FORBIDDEN = [
    // Core operations that emit events onto the chain.
    'captureMemory',
    'createTask',
    'transitionTask',
    'acceptDecision',
    'recordDecision',
    'rejectDecision',
    'supersedeDecision',
    'openTreeForWriting',
    // Core functions that write the projection cache (drop-and-replay is a
    // cache write; the copilot receives an already-rebuilt cache and only reads).
    'rebuild',
    'materializeDecisions',
    'materializeMemories',
    'materializeRuns',
    'materializeTasks',
    // Chain writer/builders (reachable transitively — must never be used). Every
    // event builder the chain exports, plus the two functions that write key
    // material to disk WITHOUT going through `.append` — those would slip past
    // the `.append(` guard below, so they must be named here explicitly.
    'openChainForWriting',
    'taskBirth',
    'taskCreated',
    'taskTransitioned',
    'runStarted',
    'runEnded',
    'memoryCaptured',
    'decisionBirth',
    'decisionRecorded',
    'decisionTransitioned',
    'writeAnchor',
    'persistKeyPair',
    'appendAll',
    'checkpoint',
  ];

  it('references nothing that writes (no event emission, no cache write, no writer)', () => {
    const srcDir = fileURLToPath(new URL('.', import.meta.url));
    const offenders: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      const text = readFileSync(file, 'utf-8');
      for (const name of FORBIDDEN) {
        // A word-boundary match catches both `import { createTask }` and a bare
        // `createTask(...)` call — the copilot may not even name a writer.
        if (new RegExp(`\\b${name}\\b`).test(text)) {
          offenders.push(`${file.slice(srcDir.length)} references "${name}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('appends to no ChainWriter (no `.append(` call anywhere)', () => {
    // The single method by which any event reaches a chain. A read-only layer
    // never calls it; this catches an `.append(` on any object, even one the
    // FORBIDDEN name list would miss (e.g. a writer passed in as a parameter).
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
