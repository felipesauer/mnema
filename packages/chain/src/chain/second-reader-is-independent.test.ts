/**
 * THE SECOND READER IMPORTS NOTHING OF THIS PRODUCT — the guard on the only thing that
 * makes it worth having.
 *
 * A second implementation that copied the first proves nothing, and the interoperability
 * literature has a name for what it would be: self-compatibility, which *proves very
 * little*. The trouble is that "it was written from the document" is a claim about how
 * somebody worked, and no test can check that. What a test CAN check is the residue: a
 * verifier that read the TypeScript would have no reason not to import it, and one that
 * imports nothing of it cannot be a translation of it.
 *
 * So this guard holds two things, and both are enumerated FROM THE TREE rather than from a
 * list somebody maintains:
 *
 *   - nothing in `packages/chain/verifier/` names this product. Not an import, not a path,
 *     not a comment — the scan is over the RAW TEXT, because a comment pointing at
 *     `hash.ts` is exactly the residue of having read `hash.ts`, and it changes no
 *     behaviour at all, so a behavioural test could never see it.
 *   - every module it imports is the Python standard library or its own package. A wheel
 *     is a second thing that has to still exist in ten years, and a verifier a stranger
 *     has to install something for is a verifier a stranger does not run.
 *
 * NON-VACUITY, TWICE, AND BOTH MUTATIONS CHANGE NO BEHAVIOUR. That is the point of them:
 * if a mutation changed what the verifier DID, a behavioural test would already have
 * caught it and this guard would be redundant. A comment naming a product module and an
 * unused standard-library import are both invisible to every other test in this suite, and
 * the guard is what stands between them and nobody noticing.
 *
 * The scan is a pure function of (name, text), so the mutations are applied to the text
 * and never to the tree — a guard whose non-vacuity proof edits the repository is a guard
 * that can leave the repository edited.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const VERIFIER_DIR = fileURLToPath(new URL('../../verifier/', import.meta.url));
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * What "this product" looks like in text.
 *
 * Each entry is a way a reference to the TypeScript could survive into the Python: a
 * package name, a source path, a compiled path, a module with a `.ts` extension. `mnema`
 * on its own is deliberately NOT here — the verifier's own package is called
 * `mnemaverify`, and a pattern that matched its own name would match every file and
 * measure nothing.
 */
const PRODUCT_REFERENCES: readonly (readonly [string, RegExp])[] = [
  ['the npm scope', /@mnema\//],
  ['a path into the product source', /packages\/(?:chain|core|code|copilot)\/src/],
  ['a compiled product path', /packages\/[a-z]+\/dist/],
  ['a TypeScript module', /\b[\w./-]+\.ts\b/],
  ['an import of the product', /\b(?:import|from)\s+mnema(?!verify)\b/],
  ['a require of the product', /require\(['"][^'"]*mnema(?!verify)/],
];

/**
 * Modules the verifier may import: the standard library it actually uses, and itself.
 *
 * `mnemaverify` is its own package — the two entry-point scripts reach it absolutely, since
 * they are run as files rather than as a module. Everything else here is standard library,
 * and the case below says the same thing a second way by naming the third-party packages
 * that would otherwise be edited into this list.
 */
const ALLOWED_IMPORTS: readonly string[] = [
  '__future__',
  'mnemaverify',
  'argparse',
  'base64',
  'datetime',
  'enum',
  'hashlib',
  'json',
  'math',
  'os',
  're',
  'shutil',
  'struct',
  'sys',
  'typing',
  'unicodedata',
];

/** Every file under the verifier directory, found by walking it. */
function filesUnder(directory: string): readonly string[] {
  const found: string[] = [];
  for (const name of readdirSync(directory)) {
    if (name === '__pycache__') continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path));
    else found.push(path);
  }
  return found.sort();
}

interface Leak {
  readonly file: string;
  readonly what: string;
  readonly line: string;
}

/**
 * The scan, as a pure function so a mutation can be handed to it without touching disk.
 *
 * It reads the WHOLE text, comments included. That is not an oversight: a comment is where
 * a reference to the implementation survives when the code no longer needs one, and it is
 * the only residue a behavioural test can never see.
 */
function referencesToTheProduct(name: string, text: string): readonly Leak[] {
  const leaks: Leak[] = [];
  for (const [what, pattern] of PRODUCT_REFERENCES) {
    for (const [at, line] of text.split('\n').entries()) {
      if (pattern.test(line)) leaks.push({ file: `${name}:${at + 1}`, what, line: line.trim() });
    }
  }
  return leaks;
}

/** Every module a Python file imports, by name, top-level package only. */
function importsOf(text: string): readonly string[] {
  const found = new Set<string>();
  for (const line of text.split('\n')) {
    const relativeImport = /^\s*from\s+\.(\w*)/.exec(line);
    if (relativeImport !== null) continue; // its own package
    const fromImport = /^\s*from\s+([\w.]+)\s+import\b/.exec(line);
    const plainImport = /^\s*import\s+([\w.]+)/.exec(line);
    const module = fromImport?.[1] ?? plainImport?.[1];
    if (module !== undefined) found.add(module.split('.')[0] as string);
  }
  return [...found].sort();
}

const PYTHON_FILES = filesUnder(VERIFIER_DIR).filter((path) => path.endsWith('.py'));

describe('the verifier tree is what this guard thinks it is', () => {
  it('has Python in it, and enough of it that the scan below is not scanning nothing', () => {
    // NON-VACUITY OF THE ENUMERATION ITSELF. Every case here is a loop over this list; an
    // empty or truncated list would make all of them pass while checking no file at all.
    expect(PYTHON_FILES.length).toBeGreaterThanOrEqual(14);
    const total = PYTHON_FILES.reduce(
      (bytes, path) => bytes + readFileSync(path, 'utf-8').length,
      0,
    );
    expect(total).toBeGreaterThan(50_000);
  });

  it('holds no TypeScript, and no compiled anything', () => {
    const strays = filesUnder(VERIFIER_DIR).filter(
      (path) => path.endsWith('.ts') || path.endsWith('.js') || path.endsWith('.mjs'),
    );
    expect(strays.map((path) => relative(REPO, path))).toEqual([]);
  });

  it('is carried by the repository, which is the only channel it travels by', () => {
    // The same hazard `format-doc.test.ts` names for the vectors: this tree ignores whole
    // directories by name, and a verifier a `.gitignore` swallowed would publish nothing
    // while every other case here stayed green. Git is asked directly.
    const tracked = new Set(
      execFileSync('git', ['ls-files', '--', relative(REPO, VERIFIER_DIR)], {
        cwd: REPO,
        encoding: 'utf-8',
      })
        .split('\n')
        .filter((line) => line !== ''),
    );
    const untracked = PYTHON_FILES.map((path) => relative(REPO, path)).filter(
      (path) => !tracked.has(path),
    );
    expect(untracked, 'the second reader is not in the repository').toEqual([]);
  });
});

describe('nothing in the second reader names this product', () => {
  it.each(PYTHON_FILES.map((path) => [relative(VERIFIER_DIR, path), path] as const))(
    '%s names no product module, path or package',
    (name, path) => {
      expect(referencesToTheProduct(name, readFileSync(path, 'utf-8'))).toEqual([]);
    },
  );

  it('imports only the standard library it declares, and its own package', () => {
    const unexpected = PYTHON_FILES.flatMap((path) =>
      importsOf(readFileSync(path, 'utf-8'))
        .filter((module) => !ALLOWED_IMPORTS.includes(module))
        .map((module) => `${relative(VERIFIER_DIR, path)} imports ${module}`),
    );
    expect(unexpected).toEqual([]);
  });

  it('uses no third-party package, so there is nothing for a stranger to install', () => {
    // Said as an absence of the obvious candidates as well as by the allowlist above,
    // because the allowlist is a list somebody edits and these are the names that would
    // be edited into it. `cryptography` is the one this verifier deliberately does without:
    // its Ed25519 is RFC 8032 by hand, checked against the RFC's own vectors.
    const forbidden = /\b(?:cryptography|nacl|ecdsa|requests|numpy|pytest|opentimestamps)\b/;
    for (const path of PYTHON_FILES) {
      const text = readFileSync(path, 'utf-8');
      for (const [at, line] of text.split('\n').entries()) {
        if (!/^\s*(?:import|from)\s/.test(line)) continue;
        expect(line, `${relative(VERIFIER_DIR, path)}:${at + 1}`).not.toMatch(forbidden);
      }
    }
  });
});

/**
 * THE TWO MUTATIONS, AND WHY THEY CHANGE NOTHING.
 *
 * Both are inert. The comment is a comment; the import is of a standard-library module
 * that is present and never used. Run the verifier with either one applied and every
 * verdict, every digest and every refusal is identical — which is exactly the argument for
 * having a structural guard at all: there is no behavioural test that could ever go red on
 * these, so without this file the residue of having read the implementation would be
 * invisible.
 */
describe('the guard is not vacuous, and neither mutation changes any behaviour', () => {
  const CLEAN = 'from .framed import digest\n\n\ndef f() -> str:\n    return digest("d", b"x")\n';

  it('the clean text it is measured against passes, or the mutations below prove nothing', () => {
    expect(referencesToTheProduct('clean.py', CLEAN)).toEqual([]);
    expect(importsOf(CLEAN).filter((m) => !ALLOWED_IMPORTS.includes(m))).toEqual([]);
  });

  it('reddens on a COMMENT that names a product module — behaviour untouched', () => {
    const mutated = `# the same fold as packages/chain/src/chain/hash.ts\n${CLEAN}`;
    const leaks = referencesToTheProduct('mutated.py', mutated);
    expect(leaks.length).toBeGreaterThan(0);
    expect(leaks.map((leak) => leak.what)).toContain('a path into the product source');
    expect(leaks.map((leak) => leak.what)).toContain('a TypeScript module');
  });

  it('reddens on a bare `hash.ts` in prose, with no path at all', () => {
    // The narrower form of the same residue: no path, just the module's name. This is what
    // a translated implementation's comments actually look like.
    const mutated = `# mirrors hash.ts\n${CLEAN}`;
    const leaks = referencesToTheProduct('mutated.py', mutated);
    expect(leaks.map((leak) => leak.what)).toEqual(['a TypeScript module']);
  });

  it('reddens on an UNUSED standard-library import — behaviour untouched', () => {
    const mutated = `import xml.dom.minidom\n${CLEAN}`;
    const outside = importsOf(mutated).filter((module) => !ALLOWED_IMPORTS.includes(module));
    expect(outside).toEqual(['xml']);
  });

  it('reddens on an import of the product by package name', () => {
    for (const mutated of ['from mnema import chain\n', 'import mnema\n']) {
      const leaks = referencesToTheProduct('mutated.py', `${mutated}${CLEAN}`);
      expect(
        leaks.map((leak) => leak.what),
        mutated,
      ).toContain('an import of the product');
    }
  });

  it('does NOT redden on the verifier own package name, which contains the product name', () => {
    // The pattern that would have made every case above vacuous: matching `mnema` alone
    // matches `mnemaverify`, so every file would leak and the guard would be measuring its
    // own name. Asserted, because that is the shape the first draft of this had.
    expect(referencesToTheProduct('x.py', 'from mnemaverify.framed import digest\n')).toEqual([]);
    expect(referencesToTheProduct('x.py', 'import mnemaverify\n')).toEqual([]);
  });
});

/**
 * THE GAP REGISTRY IS CITED, AND EVERY CITATION RESOLVES.
 *
 * The gaps are the deliverable half of a second implementation — they are the evidence
 * that the document, and not the code, was what was read. A citation that pointed at
 * nothing would be the same failure `format-doc.test.ts` guards against on the other side:
 * a claim with nothing behind it.
 */
describe('every gap the verifier cites is in its registry', () => {
  const REGISTRY = readFileSync(join(VERIFIER_DIR, 'mnemaverify', 'gaps.py'), 'utf-8');
  const DECLARED = new Set([...REGISTRY.matchAll(/"(G\d\d)"/g)].map((found) => found[1]));

  it('declares a registry big enough to be the point of the delivery', () => {
    expect(DECLARED.size).toBeGreaterThanOrEqual(20);
  });

  it('cites no gap the registry does not hold', () => {
    const dangling = PYTHON_FILES.filter((path) => !path.endsWith('gaps.py')).flatMap((path) => {
      const text = readFileSync(path, 'utf-8');
      return [...text.matchAll(/\bG\d\d\b/g)]
        .map((found) => found[0] as string)
        .filter((gap) => !DECLARED.has(gap))
        .map((gap) => `${relative(VERIFIER_DIR, path)} cites ${gap}`);
    });
    expect(dangling).toEqual([]);
  });

  it('cites the four the walker cannot read a record without', () => {
    // NON-VACUITY: a scan that found no citation at all would pass the case above.
    const cited = new Set(
      PYTHON_FILES.filter((path) => !path.endsWith('gaps.py')).flatMap((path) =>
        [...readFileSync(path, 'utf-8').matchAll(/\bG\d\d\b/g)].map((found) => found[0] as string),
      ),
    );
    for (const gap of ['G01', 'G02', 'G03', 'G10']) expect([...cited]).toContain(gap);
  });
});
