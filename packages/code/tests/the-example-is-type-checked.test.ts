/**
 * THE EXAMPLE A PACKAGE PUBLISHES IS TYPE-CHECKED — against what the package publishes.
 *
 * WHAT THE COMPARISON GUARD DOES NOT DO, MEASURED. `the-example-is-read-from-the-page`
 * proves the page and the body that runs are one text. It cannot prove that text is
 * CORRECT: two identical copies pass whether they compile or not. Measured on 11/09/2026
 * against `9248fec8`, with the script this delivery was handed
 * (`evidence/verification-type-error-returns-2026-09-11.sh`): putting `id: 'task-01'` back
 * into `createTask`'s input — one of the ten type errors the comparison guard's own
 * delivery had just fixed by hand — on the PAGE and in the CASE together left the suite at
 * `19 passed (19)` and `tsc -b` at exit 0. Nine of those ten can return the same way.
 *
 * WHY NOTHING ELSE SEES IT, and the three halves matter separately. The body that runs
 * lives in a `.test.ts`, and in this repository `tsc -b` EXCLUDES tests while vitest erases
 * types without checking them — so a type error inside a case is invisible to the build and
 * to the suite. The comparison is textual, so two wrong copies agree. And an excess
 * property is a type-only error: the example still RUNS, so the executing half of the guard
 * does not see it either.
 *
 * WHAT THIS FILE IS, AND WHAT IT IS NOT. It is not the compiler checking itself: `tsc -b`
 * never reads a fenced code block, and adding the blocks to a project is not open to it
 * (they are Markdown). This file EXTRACTS each page's block, writes it into a sandbox of
 * its own as a module a stranger could have written, and runs `tsc` over it — the same
 * reading the comparison guard's delivery did by hand once and did not keep. The blocks are
 * checked as text handed to a compiler, never as part of this repository's build.
 *
 * WHAT THEY ARE CHECKED AGAINST, AND WHY IT IS THE BUILT `.d.ts`. The sandbox carries a
 * `node_modules/@mnema/<pkg>` symlink to each package directory, so every specifier on the
 * page — `@mnema/core` and `@mnema/core/write` alike — resolves through that package's own
 * `exports` map, to the declarations it publishes. A mapping written here instead would
 * make THIS file decide what `@mnema/core/write` means; the package decides. The cost is a
 * dependency on `dist` being current: a stale build makes this guard lie in both directions,
 * which is why amarra A7 runs `pnpm build` before the suite, and why a case below refuses to
 * run over a `.d.ts` that is not on disk.
 *
 * THE STRICTNESS IS THE REPOSITORY'S, NOT A SECOND OPINION. The sandbox `tsconfig.json`
 * EXTENDS `tsconfig.base.json` by absolute path, so `strict`, `noUncheckedIndexedAccess`
 * and `exactOptionalPropertyTypes` are the ones the product is held to, and raising them
 * raises this. Only the keys in `RELAXED` below differ, each with its reason, and a case
 * refuses any relaxation that touches strictness.
 *
 * THE PREAMBLE, AND WHY IT CANNOT ACCEPT ANYTHING. One page elides in prose the state its
 * example reads over, so its block names `cache` and `chainRoot` without declaring them and
 * is not a compilable unit alone. `pagePreamble` supplies them — and a preamble is exactly
 * where a guard like this goes quietly vacuous, so two things hold it:
 *   - EVERY DECLARED NAME IS ONE THE PAGE NEEDS, AND NO OTHER. The same block is compiled a
 *     second time WITHOUT the preamble, and the names the compiler then cannot find must be
 *     precisely the names declared. A declaration for something the page does not use is
 *     accused; a name the page starts eliding and nobody declares is accused too.
 *   - THE DECLARED TYPE IS LOAD-BEARING. Measured, in this sandbox: with `cache: any` the
 *     compiler reports ZERO errors over the whole block, and `cache: never` also reports
 *     zero — so either one would silence every line below it. With a type the case does not
 *     produce, five. So the escape hatches are banned in text, and a case below compiles the
 *     block against a wrong type and requires it to go red, which is what says the ban is
 *     protecting something rather than decorating it.
 *
 * A COMPILER THAT NEVER RAN LOOKS EXACTLY LIKE A CLEAN COMPILE, so one file in the sandbox
 * is written to be WRONG. `CANARY` below is a type error a stranger could not argue with,
 * and a case requires the compiler to have said so. Without it, a `tsc` that fails to start
 * — a missing binary, a sandbox that could not be written — hands back an empty report, and
 * every case above reads "no diagnostics about my file" as success. This bench has twice
 * shipped a mutation matrix whose runner died before running anything and whose parser read
 * that silence as zero failures; this is the same hole in a different instrument.
 *
 * THE ROSTER IS SWEPT, NOT LISTED. The rule is "a published TypeScript block is checked",
 * so the discriminant is a ```ts fence in a tracked file — not a README under `packages/`.
 * The comparison guard reconciles the README of each directory under `packages`, which is
 * four files of the forty-two tracked Markdown files in this workspace: it is blind to
 * `packages/chain/verifier/README.md` and `plugin/README.md`, to thirteen further READMEs
 * under `measurements` and `.github`, and to twenty-three other pages besides. The case at
 * the bottom sweeps all forty-two instead, so a block published anywhere new must be
 * classified before it can be ignored.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PUBLISHED_EXAMPLES,
  type PublishedExample,
  publishedBlock,
  ROOT,
  read,
} from './support/published-examples.js';

/**
 * What the sandbox project changes about `tsconfig.base.json`, and why each one. Everything
 * absent from here is the repository's own setting, inherited through `extends`.
 */
const RELAXED: Readonly<Record<string, { readonly value: unknown; readonly why: string }>> = {
  noEmit: { value: true, why: 'Nothing consumes output: the question is whether it compiles.' },
  composite: { value: false, why: '`composite` requires emit, and there is none.' },
  declaration: {
    value: false,
    why: 'A declaration file for an extracted block is consumed by nobody — the block is a leaf.',
  },
  declarationMap: {
    value: false,
    why: 'A map back to a block extracted into a sandbox points at a file that is removed when the run ends.',
  },
  sourceMap: {
    value: false,
    why: 'The same: there is no emitted file for a map to be about.',
  },
  noUnusedLocals: {
    value: false,
    why: 'A page names results to SHOW them — `const lastGoal = …` is the documentation. Under the repository setting every such line would be an error, which would say nothing about the example.',
  },
  noUnusedParameters: { value: false, why: 'The same reason, for a callback a page writes out.' },
  lib: { value: ['ES2022'], why: 'The blocks use `Date` and nothing from a DOM.' },
  types: {
    value: [],
    why: 'A consumer of these packages is not required to have `@types/node`; if a published example needed it, that would be a fact about the page worth learning.',
  },
};

/** Options a relaxation may never touch: the check is never laxer than the repository. */
const STRICTNESS = [
  'strict',
  'strictNullChecks',
  'strictFunctionTypes',
  'strictBindCallApply',
  'strictPropertyInitialization',
  'noImplicitAny',
  'noImplicitThis',
  'noUncheckedIndexedAccess',
  'exactOptionalPropertyTypes',
  'noImplicitOverride',
  'useUnknownInCatchVariables',
];

/**
 * What a declared type may not be. `any` and `never` were both MEASURED to take the whole
 * block down to zero diagnostics; `unknown` refuses every use instead, which would turn the
 * check into noise; a cast or a `@ts-` directive is the same silence written differently.
 */
const ESCAPE_HATCHES = ['any', 'never', 'unknown'];

/**
 * A file written to be WRONG, so silence from the compiler can be told apart from a clean
 * compile. The error is chosen to survive any strictness setting: assigning a string to a
 * `number` is refused by `tsc` with every flag off.
 */
const CANARY = {
  name: 'a-compiler-that-ran.ts',
  text: "const refused: number = 'not a number';",
};

/** The names a preamble declares, read from the preamble itself so there is one list. */
export function declaredNames(preamble: readonly string[]): string[] {
  return [...preamble.join('\n').matchAll(/^declare const (\w+)\s*:/gm)]
    .map((match) => match[1] as string)
    .sort();
}

/**
 * Where a preamble reaches for silence instead of a type, as one complaint per line. The
 * hatches are matched as whole WORDS: `declare const many: string;` contains "any" and is
 * not a hatch, and a case below holds that.
 */
export function reachesForSilence(preamble: readonly string[]): string[] {
  const found: string[] = [];
  for (const line of preamble) {
    const annotation = /^declare const \w+\s*:(.*)$/.exec(line)?.[1] ?? '';
    for (const hatch of ESCAPE_HATCHES) {
      if (new RegExp(`\\b${hatch}\\b`).test(annotation)) found.push(`${hatch} in: ${line}`);
    }
    if (/@ts-/.test(line) || /\bas\b/.test(line)) found.push(`cast or directive in: ${line}`);
  }
  return found;
}

/** One thing the compiler said about one file. */
interface Diagnostic {
  readonly file: string;
  readonly code: number;
  readonly text: string;
}

/** The codes that mean "this name is not in scope", and the name each one is about. */
const UNDEFINED_NAME = new Map<number, RegExp>([
  [2304, /Cannot find name '([^']+)'/],
  [2552, /Cannot find name '([^']+)'/],
  [18004, /No value exists in scope for the shorthand property '([^']+)'/],
]);

/**
 * `tsc`'s report, one entry per accusation, attributed to the file it names. Run with the
 * sandbox as the working directory so a file is named by its own basename.
 */
function compile(dir: string, files: readonly string[]): Diagnostic[] {
  let output = '';
  try {
    execFileSync(
      process.execPath,
      [join(ROOT, 'node_modules/typescript/bin/tsc'), '--pretty', 'false', '-p', 'tsconfig.json'],
      {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
  }
  const said: Diagnostic[] = [];
  for (const line of output.split('\n')) {
    const parsed = /^(\S+?)\(\d+,\d+\): error TS(\d+): (.*)$/.exec(line);
    if (!parsed) continue;
    const file = (parsed[1] as string).replace(/^.*\//, '');
    // A diagnostic naming a file this run did not write is a fact about the instrument,
    // not about a page — it is carried through so a case can accuse it rather than drop it.
    said.push({
      file: files.includes(file) ? file : `UNATTRIBUTED:${parsed[1] as string}`,
      code: Number(parsed[2]),
      text: parsed[3] as string,
    });
  }
  return said;
}

/** Every declared type replaced by one the case does not produce — see the header. */
function withWrongTypes(preamble: readonly string[]): string[] {
  return preamble.map((line) =>
    line.replace(/^(declare const \w+\s*:).*$/, '$1 { readonly aTypeNoCaseProduces: true };'),
  );
}

const sourceName = (example: PublishedExample, suffix: string): string =>
  `${example.pkg}${suffix}.ts`;

/** The one sandbox every case below reads, compiled once. */
let sandbox = '';
let diagnostics: Diagnostic[] = [];
let written: readonly string[] = [];

const about = (file: string): Diagnostic[] => diagnostics.filter((one) => one.file === file);

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-published-example-'));
  mkdirSync(join(sandbox, 'node_modules/@mnema'), { recursive: true });
  for (const example of PUBLISHED_EXAMPLES) {
    symlinkSync(
      join(ROOT, 'packages', example.pkg),
      join(sandbox, 'node_modules/@mnema', example.pkg),
    );
  }
  const files: string[] = [];
  const put = (name: string, lines: readonly string[]): void => {
    writeFileSync(join(sandbox, name), `${lines.join('\n')}\n`);
    files.push(name);
  };
  put(CANARY.name, [CANARY.text]);
  for (const example of PUBLISHED_EXAMPLES) {
    const block = publishedBlock(read(example.readme));
    // The page as a stranger would compile it.
    put(sourceName(example, ''), [...example.pagePreamble, ...block]);
    // The same page with nothing supplied, so the names it needs can be counted.
    put(sourceName(example, '.free'), block);
    if (example.pagePreamble.length > 0) {
      // And with the declarations present but wrong, so the check is shown to depend on them.
      put(sourceName(example, '.wrong'), [...withWrongTypes(example.pagePreamble), ...block]);
    }
  }
  writeFileSync(
    join(sandbox, 'tsconfig.json'),
    JSON.stringify(
      {
        extends: join(ROOT, 'tsconfig.base.json'),
        compilerOptions: Object.fromEntries(
          Object.entries(RELAXED).map(([key, relaxation]) => [key, relaxation.value]),
        ),
        files,
      },
      null,
      2,
    ),
  );
  written = files;
  diagnostics = compile(sandbox, files);
});

afterAll(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

describe('the example a package publishes type-checks against what the package publishes', () => {
  for (const example of PUBLISHED_EXAMPLES) {
    it(`${example.specifier} — the page's block compiles against the built declarations`, () => {
      expect(about(sourceName(example, '')).map((one) => `TS${one.code}: ${one.text}`)).toEqual([]);
    });

    it(`${example.specifier} — the preamble declares every name the page needs, and no other`, () => {
      const free = about(sourceName(example, '.free'));
      const names = new Set<string>();
      const unaccounted: string[] = [];
      for (const one of free) {
        const pattern = UNDEFINED_NAME.get(one.code);
        const named = pattern ? pattern.exec(one.text)?.[1] : undefined;
        if (named) names.add(named);
        // Anything that is not "this name is not in scope" is a real error in the block
        // that the preamble happens to be hiding — named rather than counted away.
        else unaccounted.push(`TS${one.code}: ${one.text}`);
      }
      expect(unaccounted).toEqual([]);
      expect([...names].sort()).toEqual(declaredNames(example.pagePreamble));
    });
  }
});

describe('the preamble cannot accept anything', () => {
  for (const example of PUBLISHED_EXAMPLES.filter((one) => one.pagePreamble.length > 0)) {
    it(`${example.specifier} — a declared type the case does not produce turns the check red`, () => {
      // Without this, `pagePreamble` could hold any type at all and every case above would
      // still be green — which is what `any` and `never` were measured to do.
      expect(about(sourceName(example, '.wrong')).length).toBeGreaterThan(0);
    });
  }

  it('no declaration reaches for silence instead of a type', () => {
    const reaching = PUBLISHED_EXAMPLES.flatMap((example) =>
      reachesForSilence(example.pagePreamble).map((why) => `${example.specifier}: ${why}`),
    );
    expect(reaching).toEqual([]);
  });

  it('every preamble says, in prose, why the page elides what it declares', () => {
    const silent = PUBLISHED_EXAMPLES.filter(
      (example) => example.pagePreamble.length > 0 && example.whyPreamble.length < 40,
    ).map((example) => example.specifier);
    expect(silent).toEqual([]);
  });
});

describe('the check is not laxer than the repository', () => {
  it('every relaxation is declared with a reason', () => {
    const mute = Object.entries(RELAXED)
      .filter(([, relaxation]) => relaxation.why.length < 20)
      .map(([key]) => key);
    expect(mute).toEqual([]);
  });

  it('no relaxation touches strictness', () => {
    expect(Object.keys(RELAXED).filter((key) => STRICTNESS.includes(key))).toEqual([]);
  });

  it('the strictness it inherits is the file the repository builds with', () => {
    // The sandbox extends this by absolute path; if it ever stopped existing, every block
    // would be compiled under `tsc`'s defaults and this guard would go soft in silence.
    expect(existsSync(join(ROOT, 'tsconfig.base.json'))).toBe(true);
    const base = JSON.parse(read('tsconfig.base.json')) as {
      compilerOptions: {
        strict?: boolean;
        noUncheckedIndexedAccess?: boolean;
        exactOptionalPropertyTypes?: boolean;
      };
    };
    expect(base.compilerOptions.strict).toBe(true);
    expect(base.compilerOptions.noUncheckedIndexedAccess).toBe(true);
    expect(base.compilerOptions.exactOptionalPropertyTypes).toBe(true);
  });
});

describe('the roster is every block this workspace publishes', () => {
  it('the compiler ran, and said so — every case above is read from its report', () => {
    // Every other case in this file reads an ABSENCE of diagnostics as a page compiling.
    // This one reads a PRESENCE, so a `tsc` that never started cannot be mistaken for one
    // that found nothing.
    expect(about(CANARY.name).map((one) => one.code)).toEqual([2322]);
  });

  it('the declarations each page is checked against are on disk', () => {
    // A missing `dist` makes every case above pass over a module that cannot be resolved,
    // or fail with a message about resolution that reads like a defect in a page. Named
    // here instead: this guard depends on `pnpm build` having run (A7).
    const missing = PUBLISHED_EXAMPLES.filter((example) => {
      const manifest = JSON.parse(read(`packages/${example.pkg}/package.json`)) as {
        types?: string;
      };
      return !existsSync(join(ROOT, 'packages', example.pkg, manifest.types ?? 'dist/index.d.ts'));
    }).map((example) => example.specifier);
    expect(missing).toEqual([]);
  });

  it('every tracked file publishing a TypeScript block is a page this guard reads', () => {
    // The discriminant is the FENCE, not a directory. `packages/chain/verifier/README.md`
    // and `plugin/README.md` are tracked Markdown outside the READMEs of the package
    // directories, which is
    // all the comparison guard reconciles; a block published in either of them would be
    // read by nothing without this sweep.
    const publishing = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
      .split('\0')
      .filter((file) => file.endsWith('.md'))
      // Every spelling of the fence, not only the one three pages use today: a page that
      // said ```typescript would otherwise publish TypeScript nothing here reads.
      .filter((file) => /^```(ts|tsx|typescript)$/m.test(read(file)))
      .sort();
    expect(publishing).toEqual(PUBLISHED_EXAMPLES.map((example) => example.readme).sort());
  });

  it('every file the sandbox was given was compiled, and nothing else was', () => {
    // A diagnostic naming a file this run did not write means the instrument read something
    // it was not pointed at — the reading above would then be about the wrong text.
    expect(diagnostics.filter((one) => one.file.startsWith('UNATTRIBUTED:'))).toEqual([]);
    const expected =
      1 +
      PUBLISHED_EXAMPLES.length * 2 +
      PUBLISHED_EXAMPLES.filter((one) => one.pagePreamble.length > 0).length;
    expect(written.length).toBe(expected);
  });
});

describe('the reading FIRES', () => {
  // Each reading is shown working on a corpus written here, so a case that finds nothing
  // is distinguishable from one that cannot find anything.
  it('a name is read from the declaration that introduces it', () => {
    expect(declaredNames(['declare const a: A;', 'declare const b: B;'])).toEqual(['a', 'b']);
    expect(declaredNames(["import type { A } from 'x';"])).toEqual([]);
  });

  it('the escape hatches are accused, one complaint each', () => {
    expect(reachesForSilence(['declare const c: any;'])).toHaveLength(1);
    expect(reachesForSilence(['declare const c: never;'])).toHaveLength(1);
    expect(reachesForSilence(['declare const c: unknown;'])).toHaveLength(1);
    expect(reachesForSilence(['declare const c: X as Y;'])).toHaveLength(1);
    expect(reachesForSilence(['// @ts-expect-error'])).toHaveLength(1);
  });

  it('a hatch spelled inside a longer word is not a hatch', () => {
    // `many` contains "any" and `whenever` contains "never": a scan on substrings would
    // accuse both and the ban would be noise nobody could satisfy.
    expect(reachesForSilence(['declare const many: string;'])).toEqual([]);
    expect(reachesForSilence(['declare const x: Whenever;'])).toEqual([]);
  });

  it('a hatch in the NAME is not a hatch — only the type is read', () => {
    expect(reachesForSilence(['declare const any: string;'])).toEqual([]);
  });

  it('a wrong type is written over the annotation and not over the name', () => {
    expect(withWrongTypes(['declare const cache: ProjectionCache;'])).toEqual([
      'declare const cache: { readonly aTypeNoCaseProduces: true };',
    ]);
    expect(withWrongTypes(["import type { A } from 'x';"])).toEqual([
      "import type { A } from 'x';",
    ]);
  });
});
