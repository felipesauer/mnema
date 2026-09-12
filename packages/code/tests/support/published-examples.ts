/**
 * THE PAGES THIS WORKSPACE PUBLISHES A RUNNABLE EXAMPLE ON — read once, by both guards.
 *
 * WHY THIS FILE EXISTS AS A FILE. Two rules now stand over the same roster: the example a
 * package publishes is the example that RUNS (`the-example-is-read-from-the-page.test.ts`)
 * and the example a package publishes TYPE-CHECKS (`the-example-is-type-checked.test.ts`).
 * A second copy of the list is the shape that produces divergence in silence — one guard
 * covering a page the other does not — so the list is written here and read twice.
 *
 * WHAT AN ENTRY CARRIES, AND WHY TWO KINDS OF ELISION LIVE ON IT. `elided` is what the
 * CASE does not carry, because running those lines would found an identity inside this
 * repository; the comparison guard removes them from the page before comparing, and holds
 * the page against them so the declaration cannot go stale. `pagePreamble` is the reverse:
 * names the PAGE itself leaves undeclared, in the prose above its block, which the
 * type-check must supply for the block to be a compilable unit at all. The two never
 * overlap — one is text the page has and the case has not, the other is text the case has
 * and the page has not.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The workspace root, found by its MARKER and never by counting `..` upwards. A count is
 * a fact about where this file sits today; one `mv` turns it into a path that resolves to
 * a directory with no packages in it, and every case reading through it then passes over
 * nothing.
 */
export const ROOT = ((): string => {
  let at = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(at, 'pnpm-workspace.yaml'))) return at;
    const up = dirname(at);
    if (up === at) throw new Error('no pnpm-workspace.yaml above this file');
    at = up;
  }
})();

/** A file of the workspace, by its path from the root. */
export const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

/** A package whose README publishes a runnable example, and the case that runs it. */
export interface PublishedExample {
  /** The package directory under `packages/`. */
  readonly pkg: string;
  /** The public specifier a reader would install and import. */
  readonly specifier: string;
  /** The page, relative to the workspace root. */
  readonly readme: string;
  /** The case holding the marked region, relative to the workspace root. */
  readonly test: string;
  /**
   * How the page's import specifiers read inside the case. The page names the PUBLIC
   * specifier a reader would type; the case reaches the same barrel through the path it
   * has. Every specifier the page's block imports from must appear here, so an import
   * added to the page cannot slip past the comparison of names.
   */
  readonly specifiers: Readonly<Record<string, string>>;
  /**
   * The exact lines the case does not carry, in order, at the top of the page's body.
   * Declared as TEXT, never as a count — a count is a number anyone could raise to
   * swallow a difference.
   */
  readonly elided: readonly string[];
  /** Why those lines are elided. One reason per entry; two entries never share one. */
  readonly whyElided: string;
  /**
   * The declarations standing for names the PAGE uses and does not declare, because its
   * prose elides where they come from. Written with the type the case really produces:
   * an escape hatch here would silence the whole tail of the block, which is why the
   * type-check guard bans one and proves the ban is not decorative.
   */
  readonly pagePreamble: readonly string[];
  /** Why the page elides them, and where the prose says so. Empty when there is none. */
  readonly whyPreamble: string;
}

export const PUBLISHED_EXAMPLES: readonly PublishedExample[] = [
  {
    pkg: 'chain',
    specifier: '@mnema/chain',
    readme: 'packages/chain/README.md',
    test: 'packages/chain/src/readme-example.test.ts',
    specifiers: { '@mnema/chain': './index.js' },
    elided: [
      '// The chain is committed and shared; the private key is not, so the two roots are separate.',
      "const root = '.mnema/chain';",
      "const keyRoot = '/a/path/outside/the/repository';",
      '',
    ],
    whyElided:
      'Running these two literals would create a chain and mint a signing key inside the working tree — the case points both at a sandbox it makes and removes (A6).',
    pagePreamble: [],
    whyPreamble:
      'The page declares everything it uses: the two roots it elides from the CASE are on the page, as literals, so the block stands alone as a unit.',
  },
  {
    pkg: 'core',
    specifier: '@mnema/core',
    readme: 'packages/core/README.md',
    test: 'packages/core/tests/readme-example.test.ts',
    specifiers: {
      '@mnema/chain': '@mnema/chain',
      '@mnema/core': '../src/index.js',
      '@mnema/core/write': '../src/write.js',
    },
    elided: [
      '// The chain is committed and shared; the private key is not, so the two roots are separate.',
      "const root = '.mnema/chain';",
      "const keyRoot = '/a/path/outside/the/repository';",
      '',
    ],
    whyElided:
      'The same two literals, and the same reason: this example WRITES, so running the page verbatim would leave a founded identity and two events in this repository.',
    pagePreamble: [],
    whyPreamble: 'The same: the page carries both roots, so its block stands alone.',
  },
  {
    pkg: 'copilot',
    specifier: '@mnema/copilot',
    readme: 'packages/copilot/README.md',
    test: 'packages/copilot/tests/readme-example.test.ts',
    specifiers: { '@mnema/copilot': '../src/index.js' },
    elided: [],
    whyElided:
      'Nothing is elided: this package only READS, and the state its example reads over is elided by the page itself, in the prose above the block ("given a rebuilt cache over your chain").',
    pagePreamble: [
      "import type { ProjectionCache } from '@mnema/core';",
      'declare const cache: ProjectionCache;',
      'declare const chainRoot: string;',
    ],
    whyPreamble:
      'The prose above the block says "given a rebuilt cache over your chain" and names `chainRoot` as "that tree\'s chain directory", so the block opens neither. These are the two types the case really produces — `bench.cache()` and `bench.root`.',
  },
];

/**
 * A package README that publishes no runnable TypeScript, and why. Reconciled against the
 * disk in both directions by the comparison guard — an entry that grows a ```ts block is
 * accused, and so is a README in neither list.
 */
export const NO_RUNNABLE_EXAMPLE: readonly { pkg: string; why: string }[] = [
  {
    pkg: 'code',
    why: 'It is the manual for a command line, not for a library: 996 lines with ZERO ```ts blocks and 22 shell ones. A guard over it means running the built binary twenty-two times in a sandbox, which is a piece of work with a cost of its own and no overlap with reading a page.',
  },
];

/**
 * The fence languages that count as published TypeScript. Three pages use the first one
 * today; the other two are here so a page cannot leave the reach of either guard by
 * spelling its fence differently. Detecting a block and extracting one read the SAME list,
 * because a sweep that finds a page whose block the extractor then cannot see would accuse
 * the page for the wrong reason.
 */
export const TYPESCRIPT_FENCES = ['ts', 'tsx', 'typescript'];

const FENCED = '^```(?:' + TYPESCRIPT_FENCES.join('|') + ')$';

/** Whether a page publishes TypeScript at all — the discriminant the roster is swept by. */
export function publishesTypeScript(markdown: string): boolean {
  return new RegExp(FENCED, 'm').test(markdown);
}

/**
 * The single TypeScript block of a page, as lines. A page with none, or with two, is
 * refused: this reads a page the roster has already said publishes exactly one.
 */
export function publishedBlock(markdown: string): string[] {
  const blocks = [
    ...markdown.matchAll(new RegExp(FENCED.slice(0, -1) + '\\n([\\s\\S]*?)^```$', 'gm')),
  ].map((m) => m[1] as string);
  if (blocks.length !== 1) {
    throw new Error(`expected exactly one TypeScript block, found ${blocks.length}`);
  }
  return (blocks[0] as string).replace(/\n$/, '').split('\n');
}
