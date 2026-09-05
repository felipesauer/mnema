/**
 * EVERY SANDBOX MADE UNDER `tmpdir()` IS REMOVED BY THE NAME THAT WAS MADE.
 *
 * WHERE THIS COMES FROM. `packages/copilot/tests/support/chain.ts` made a sandbox with
 * `mkdtempSync(join(tmpdir(), 'mnema-copilot-'))` and nothing in that file removed anything.
 * Measured on 21/08/2026: **296 directories per suite run**, **47.237** of them left in `/tmp`,
 * the newest one from the run that counted them. Three days of that had gone unnoticed because
 * a leaked directory costs nothing anybody looks at.
 *
 * AND THE FIFTEEN CALLERS ALL CLEANED UP, which is the part worth writing down. Every test file
 * using that helper had an `afterEach` doing `rmSync(bench.root, …)` — and `bench.root` is the
 * CHAIN root, several levels inside the sandbox. They emptied the sandbox and left the sandbox.
 * So the defect was not missing cleanup; it was cleanup aimed at what the helper EXPOSED rather
 * than at what the helper CREATED, in a place that was not the place that created it. The fix
 * is A6 read strictly — whoever creates destroys, in the same function — and this case is the
 * cheapest thing that would have gone red on it.
 *
 * THE DISCRIMINANT IS "CREATES IN `tmpdir()`", NOT "CALLS `mkdtemp`". This distinction is the
 * whole instrument, and getting it wrong was the first thing that happened when the sweep was
 * done by hand: `packages/code/tests/support/pty.ts` calls `mkdtempSync` and contains no
 * `rmSync` anywhere, so a rule reading "makes a temp dir and never removes one" accuses it —
 * and it is innocent, because it makes its directory inside `fixture.scratch`, a sandbox its
 * caller owns and its caller removes. There is a case below that holds exactly that file
 * against exactly that mistake, because an instrument that has a known way of being wrong needs
 * a case about being wrong that way.
 *
 * THIS FILE USED TO SAY IT READ THE FILE AND NOT THE PATH, AND THAT IT COULD NOT DO BETTER. The
 * premise was that following the created name to its removal accuses innocents: *"the shape that
 * would do it (bind the name on the left of the `mkdtemp` and demand it inside an `rmSync`) was
 * tried against this corpus and accused six innocent files, all of which collect their roots
 * into an array and remove them through a loop variable."* The measurement was right and the
 * conclusion did not follow. Re-run on 05/09/2026, that bare shape accuses **seven** files, and
 * every one of them is innocent in one of four readable ways — so the answer was to read the
 * four ways, not to stop following the name:
 *
 * | how the name reaches its removal | who does it |
 * |---|---|
 * | `for (const r of [a, b])` — an array LITERAL the loop drains | `topology/locate.test.ts`, `topology/compose.test.ts`, `integration/cross-entity.test.ts` |
 * | `for (const r of roots)` — a VARIABLE the name entered by `= [x]` or `.push(x)` | `workflow/skill-operations.test.ts`, `workflow/decision-operations.test.ts`, `workflow/session-operations.test.ts` |
 * | `while (…) rmSync(sandboxes.pop())` — a stack drained to empty | `code/tests/the-sampler-counts-or-refuses.test.ts` |
 * | `return { root }`, removed later as `rmSync(a.root)` — the name leaves as a FIELD | `integration/enrollment-e2e.test.ts` |
 *
 * The fourth row is the one no earlier sweep had: it is not an array and not a loop, and a rule
 * built to forgive collections alone still accuses it. `namesLeftBehind` below reads all four,
 * and over the corpus it accuses **nobody** — measured, and each of the four legs is load-bearing:
 * deleting the loop leg accuses 6 files, the collection leg 4, the field leg 1. Every case below
 * that names a shape names it on source this file owns, because an assertion over a corpus that
 * is clean today proves the rule silent, not right.
 *
 * IT ALSO USED TO READ ITS OWN PROSE AS CODE, and that is how the paragraph above got into the
 * corpus. The header quoted `mkdtempSync(join(tmpdir(), 'mnema-copilot-'))` and the sentence about
 * the fifteen callers quoted `rmSync(bench.root, …)`, so this file listed ITSELF among the files
 * that make a sandbox under `tmpdir()` — and passed, because the second quotation excused the
 * first. Rewording one sentence would have turned the guard red against itself. It reads
 * `codeOnly` now, which is the workspace's one answer to "what does this file say once the
 * comments and the strings are gone" and already had four callers; this was the fifth site that
 * had written the question out for itself and got it wrong. Measured: 232 makings become 230 and
 * 160 creators become 159, and the one that leaves is this file.
 *
 * WHAT THIS STILL DOES NOT COVER. It reads one file at a time, so a name that leaves as a field
 * is cleared by any `rmSync(<anything>.<that field>)` in the same file, and a sandbox created in
 * one file and removed in another is not followed at all. The path across files is watched where
 * the path is known — `packages/copilot/tests/the-bench-leaves-nothing-behind.test.ts` names the
 * directory `makeBench` created and asks the filesystem whether it went — and, for the 187
 * prefixes this corpus builds under, by `.github/what-the-suite-left-behind/`, which sweeps the
 * real `/tmp` with the suite stopped at both ends. Neither is this case, and neither is free:
 * the first covers one prefix and the second does not run inside `pnpm test`.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codeOnly } from './support/reading-source.js';

/** The workspace root — this file is `packages/code/tests/…`. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * EVERY SOURCE THE WORKSPACE HOLDS, ASKED OF GIT. A hand-written list of directories carries
 * whoever wrote it's blind spot, and a package added next month would simply not be swept.
 */
const SOURCES: readonly string[] = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: ROOT, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 },
)
  .split('\n')
  .filter((where) => /\.(ts|mts|cts|js|mjs|cjs)$/.test(where));

/** One call to `mkdtempSync`, with whatever follows it on its line. */
const A_MAKING = /mkdtempSync\(([^;]*)/g;
/** The base that call builds on, when the base is the machine's own temp directory. */
const THE_MACHINES_TEMP = /\btmpdir\(\)/;
/** A base at all — some expression is being passed. This is what makes "unreadable" mean it. */
const SOME_BASE = /\S/;
/** A removal — any removal, which is what the file-wide case (and only it) asks about. */
const A_REMOVAL = /\brmSync\(/;

/** An identifier, and a dotted path of them. */
const A_NAME = String.raw`[A-Za-z_$][\w$]*`;
/** `const x = ` / `x = ` immediately before a making: the name the sandbox is bound to. */
const BOUND_TO = new RegExp(
  String.raw`(?:^|[;{}(,\s])(?:const\s|let\s|var\s)?\s*(${A_NAME})\s*=\s*$`,
);
/** `const x = { y: ` before a making: the sandbox is born as a field, and `x.y` is its name. */
const BOUND_AS_FIELD = new RegExp(
  String.raw`(?:^|[;{}(,\s])(?:const\s|let\s|var\s)?\s*(${A_NAME})\s*=\s*\{\s*(${A_NAME})\s*:\s*$`,
);
/** A removal whose subject is exactly a name, or a dotted path ending in one. */
const A_PLAIN_SUBJECT = new RegExp(String.raw`^${A_NAME}(?:\.${A_NAME})*$`);
/** A removal whose subject is a collection being drained — `sandboxes.pop() as string`. */
const A_DRAINED_COLLECTION = new RegExp(
  String.raw`^(${A_NAME})\.(?:pop|shift)\(\)(?:\s+as\s+${A_NAME})?$`,
);
/** `for (const r of <expr>)`: the loop variable, and what it walks. */
const A_LOOP = new RegExp(String.raw`for\s*\(\s*(?:const|let|var)\s+(${A_NAME})\s+of\s+([^)]*)\)`);
/** `xs.push(<expr>)`: a name entering a collection. */
const A_PUSH = new RegExp(String.raw`(${A_NAME})\.push\(([^;]*)\)`);
/** `xs = [<expr>]`: names entering a collection all at once. */
const AN_ARRAY = new RegExp(String.raw`(?:^|[;{}\s])(${A_NAME})\s*=\s*\[([^\]]*)\]`);
/** `return { a, b: c }`: the fields a value leaves the function as. */
const A_RETURNED_SHAPE = /return\s*\{([^}]*)\}/g;
/** One field of such a shape: `root` (shorthand) or `root: made`. */
const A_RETURNED_FIELD = new RegExp(String.raw`^\s*(${A_NAME})\s*(?::\s*(${A_NAME})\s*)?$`);

/** Every identifier in a fragment. */
const namesIn = (fragment: string): string[] =>
  [...fragment.matchAll(new RegExp(A_NAME, 'g'))].map((found) => found[0]);

const globally = (pattern: RegExp): RegExp => new RegExp(pattern.source, 'g');

/**
 * The subject of every `rmSync(` in a file: its first argument, read with balanced brackets
 * so `rmSync(join(a, b), { … })` yields `join(a, b)` and not `join(a`. Reading it by regex
 * stopped at the first `)` and made `sandboxes.pop() as string` unreadable, which is the
 * shape one of the four legs exists for.
 */
function removalSubjects(code: string): string[] {
  const subjects: string[] = [];
  for (const call of code.matchAll(/\brmSync\(/g)) {
    const from = (call.index ?? 0) + call[0].length;
    let at = from;
    let depth = 0;
    for (; at < code.length; at += 1) {
      const char = code[at];
      if (char === '(' || char === '[' || char === '{') depth += 1;
      else if (char === ')' || char === ']' || char === '}') {
        if (depth === 0) break;
        depth -= 1;
      } else if (char === ',' && depth === 0) break;
    }
    subjects.push(code.slice(from, at).trim());
  }
  return subjects;
}

/**
 * The names a file's removals reach. A name is reached directly (`rmSync(root, …)`), through a
 * collection a removal drains (a `for…of` over it, or `rmSync(xs.pop())`), or by leaving the
 * function as a field some removal names (`return { root }` against `rmSync(a.root, …)`).
 *
 * The three indirect legs feed each other — a name pushed into an array walked by a loop whose
 * variable is removed — so they run to a fixed point rather than in one pass.
 */
function namesRemovalsReach(code: string): Set<string> {
  const reached = new Set<string>();
  const fields = new Set<string>();
  for (const subject of removalSubjects(code)) {
    const drained = A_DRAINED_COLLECTION.exec(subject);
    if (drained?.[1] !== undefined) {
      reached.add(drained[1]);
      continue;
    }
    if (!A_PLAIN_SUBJECT.test(subject)) continue;
    reached.add(subject);
    const segments = subject.split('.');
    const last = segments[segments.length - 1] as string;
    if (segments.length > 1) fields.add(last);
  }
  const loops = [...code.matchAll(globally(A_LOOP))].map((m) => ({ variable: m[1], walks: m[2] }));
  const entries = [
    ...[...code.matchAll(globally(A_PUSH))].map((m) => ({ collection: m[1], from: m[2] })),
    ...[...code.matchAll(globally(AN_ARRAY))].map((m) => ({ collection: m[1], from: m[2] })),
  ];
  const returned = [...code.matchAll(A_RETURNED_SHAPE)].flatMap((shape) =>
    (shape[1] ?? '')
      .split(',')
      .map((field) => A_RETURNED_FIELD.exec(field))
      .flatMap((pair) =>
        pair?.[1] === undefined ? [] : [{ as: pair[1], from: pair[2] ?? pair[1] }],
      ),
  );
  for (;;) {
    const before = reached.size;
    for (const loop of loops) {
      if (reached.has(loop.variable as string))
        for (const n of namesIn(loop.walks ?? '')) reached.add(n);
    }
    for (const entry of entries) {
      if (reached.has(entry.collection as string))
        for (const n of namesIn(entry.from ?? '')) reached.add(n);
    }
    for (const field of returned) if (fields.has(field.as)) reached.add(field.from);
    if (reached.size === before) return reached;
  }
}

/**
 * The sandboxes a file makes under `tmpdir()` and whose name no removal in it reaches, and the
 * makings it could not bind a name for at all. The second list is not a detail: an unbound
 * making is a sandbox this rule cannot follow, and reporting it is the difference between an
 * instrument with a gap and an instrument that hides one.
 */
function namesLeftBehind(code: string): { readonly orphans: string[]; readonly unbound: number } {
  const made: string[] = [];
  let unbound = 0;
  for (const line of code.split('\n')) {
    for (const making of line.matchAll(A_MAKING)) {
      if (!THE_MACHINES_TEMP.test(making[1] ?? '')) continue;
      const head = line.slice(0, making.index);
      const asField = BOUND_AS_FIELD.exec(head);
      const asName = BOUND_TO.exec(head);
      if (asField?.[1] !== undefined) made.push(`${asField[1]}.${asField[2]}`);
      else if (asName?.[1] !== undefined) made.push(asName[1]);
      else unbound += 1;
    }
  }
  if (made.length === 0) return { orphans: [], unbound };
  const reached = namesRemovalsReach(code);
  return { orphans: [...new Set(made)].filter((name) => !reached.has(name)), unbound };
}

interface Making {
  readonly where: string;
  readonly line: number;
  readonly onTheMachinesTemp: boolean;
  readonly readable: boolean;
}

/** Each swept file's text as code: comments, string literals and regex literals blanked. */
const CODE = new Map<string, string>();
for (const where of SOURCES) {
  const raw = readFileSync(join(ROOT, where), 'utf-8');
  if (raw.includes('mkdtempSync(')) CODE.set(where, codeOnly(raw));
}

/** Every `mkdtempSync` in the workspace's code, classified by the base it builds on. */
const MAKINGS: readonly Making[] = [...CODE].flatMap(([where, code]) =>
  code.split('\n').flatMap((line, index) =>
    [...line.matchAll(A_MAKING)].map((said) => {
      const rest = said[1] ?? '';
      return {
        where,
        line: index + 1,
        onTheMachinesTemp: THE_MACHINES_TEMP.test(rest),
        readable: SOME_BASE.test(rest),
      };
    }),
  ),
);

/** The files that put a directory under `tmpdir()`, and what each of them says about removal. */
const CREATORS = [...new Set(MAKINGS.filter((m) => m.onTheMachinesTemp).map((m) => m.where))]
  .sort()
  .map((where) => {
    const code = CODE.get(where) as string;
    return { where, removes: A_REMOVAL.test(code), ...namesLeftBehind(code) };
  });

describe('the instrument reads what it claims to read', () => {
  it('found the makings at all', () => {
    // NOT VACUOUS: a rename of `mkdtempSync`, a move of the packages, or a `git ls-files` that
    // came back empty would leave every case below passing over nothing at all.
    expect(
      MAKINGS.length,
      'no call to mkdtempSync was found anywhere in the workspace',
    ).toBeGreaterThan(100);
    expect(
      new Set(CREATORS.map((c) => c.where.split('/')[1])).size,
      'sandboxes under tmpdir() were found in only one package — the sweep is too narrow',
    ).toBeGreaterThan(1);
  });

  it('says so when it cannot read a making, rather than passing it over', () => {
    // A making split across lines would arrive here with nothing after the paren. Reporting it
    // is the difference between an instrument with a gap and an instrument that hides one.
    const unreadable = MAKINGS.filter((m) => !m.readable).map((m) => `${m.where}:${m.line}`);
    expect(unreadable, 'a call to mkdtempSync is written in a shape this case cannot read').toEqual(
      [],
    );
  });

  it('binds a name to every sandbox it follows, rather than skipping the ones it cannot', () => {
    // The name-following rule is silent about a making it cannot bind a name for, and silence
    // is what this case converts into a red. `keyRoot = { root: mkdtempSync(…) }` and
    // `` const root = `${mkdtempSync(…)}/` `` are both live in the corpus and both readable;
    // the day a third shape arrives, this says so instead of the rule quietly not applying.
    const unbound = CREATORS.filter((c) => c.unbound > 0).map((c) => `${c.where} ×${c.unbound}`);
    expect(
      unbound,
      'a sandbox under tmpdir() is bound in a shape namesLeftBehind cannot name',
    ).toEqual([]);
  });

  it('does not read its own prose as code', () => {
    // THE FIFTH SITE OF `codeOnly`, and the reason it is the fifth. This header quotes both a
    // making and a removal, so read raw it listed ITSELF as a file that makes a sandbox under
    // tmpdir() and excused itself with the second quotation. Rewording one sentence would have
    // turned the guard red against itself.
    const self = 'packages/code/tests/every-sandbox-is-removed-where-it-was-made.test.ts';
    const raw = readFileSync(join(ROOT, self), 'utf-8');
    expect(
      raw.includes('mkdtempSync(join(tmpdir()'),
      'this header no longer quotes a making, so it stops discriminating raw from code',
    ).toBe(true);
    expect(
      MAKINGS.filter((m) => m.where === self),
      'this file reads its own prose as a making',
    ).toEqual([]);
    expect(CREATORS.map((c) => c.where)).not.toContain(self);
  });

  it('does not accuse a sandbox made inside a sandbox the caller owns', () => {
    // THE INSTRUMENT'S OWN CASE. `support/pty.ts` calls mkdtempSync and has no rmSync at all,
    // so it is the exact file a rule about "mkdtemp without cleanup" gets wrong — and it is
    // innocent, because its base is `fixture.scratch`. If this case ever goes red because that
    // file changed, the answer is to pick another innocent file, not to widen the rule.
    const pty = MAKINGS.filter((m) => m.where === 'packages/code/tests/support/pty.ts');
    expect(
      pty.length,
      'support/pty.ts no longer makes a sandbox — pick another innocent file',
    ).toBe(1);
    expect(
      pty[0]?.onTheMachinesTemp,
      'support/pty.ts is being read as making one under tmpdir()',
    ).toBe(false);
    expect(
      A_REMOVAL.test(readFileSync(join(ROOT, 'packages/code/tests/support/pty.ts'), 'utf-8')),
      'support/pty.ts now removes something, so it no longer discriminates the two rules',
    ).toBe(false);
    expect(CREATORS.map((c) => c.where)).not.toContain('packages/code/tests/support/pty.ts');
  });
});

describe('a sandbox under tmpdir() is removed by the file that made it', () => {
  it('leaves nothing behind, in every file that makes one', () => {
    const leaking = CREATORS.filter((c) => !c.removes).map((c) => c.where);
    expect(
      leaking,
      'these files make a directory under tmpdir() and never remove one — every run of the suite leaves them in /tmp',
    ).toEqual([]);
  });

  it('removes the name it made, and not merely something', () => {
    const astray = CREATORS.filter((c) => c.orphans.length > 0).map(
      (c) => `${c.where} → ${c.orphans.join(', ')}`,
    );
    expect(
      astray,
      'these files make a sandbox under tmpdir() whose name no removal in them reaches — the removal is aimed at something else',
    ).toEqual([]);
  });
});

/**
 * THE RULE ON SOURCE THIS FILE OWNS. The corpus is clean, so every assertion above is a rule
 * saying nothing today; these say what it would say. Each shape is written the way the file
 * named beside it writes it, and each is a leg the corpus depends on: deleting the loop leg
 * accuses six real files, the collection leg four, the field leg one.
 */
describe('the rule follows the name it was given', () => {
  const made = "mkdtempSync(join(tmpdir(), 'mnema-x-'))";

  /**
   * Read exactly as the sweep reads: through `codeOnly` first. Handing these cases raw source
   * would exercise the rule on input the guard never produces — a string literal survives here
   * and is blanked there — and a case that agrees with the product only by accident agrees
   * until the day it does not.
   */
  const reading = (...lines: string[]) => namesLeftBehind(codeOnly(lines.join('\n')));

  it('accuses a file that makes one sandbox and removes another', () => {
    // THE WHOLE POINT, and the thing the file-wide case above cannot say: both these makings
    // are removed by SOMETHING, and one of them is not removed at all.
    const { orphans } = reading(
      `const made = ${made};`,
      `const other = ${made};`,
      'rmSync(other, { recursive: true, force: true });',
    );
    expect(orphans).toEqual(['made']);
  });

  it('accuses a removal aimed inside the sandbox rather than at it', () => {
    // THE ORIGINAL DEFECT, in one file: the fifteen callers removed `bench.root`, which is
    // several levels INSIDE the sandbox, and satisfied every rule about removal there is.
    const { orphans } = reading(
      `const sandbox = ${made};`,
      "rmSync(join(sandbox, 'chain'), { recursive: true });",
    );
    expect(orphans).toEqual(['sandbox']);
  });

  it('clears a for…of over an array literal', () => {
    // `topology/locate.test.ts`, `topology/compose.test.ts`, `integration/cross-entity.test.ts`.
    const { orphans } = reading(
      `const publicRoot = ${made};`,
      `const privateRoot = ${made};`,
      'for (const r of [publicRoot, privateRoot]) rmSync(r, { recursive: true, force: true });',
    );
    expect(orphans).toEqual([]);
  });

  it('clears a for…of over a collection the name entered', () => {
    // `workflow/skill-operations.test.ts`, `decision-operations.test.ts`, `session-operations.test.ts`
    // — one name in by assignment, one by push, both out through the same loop variable.
    const { orphans } = reading(
      `const root = ${made};`,
      'roots = [root];',
      `const clone = ${made};`,
      'roots.push(clone);',
      'for (const r of roots) rmSync(r, { recursive: true, force: true });',
    );
    expect(orphans).toEqual([]);
  });

  it('clears a stack drained by pop', () => {
    // `code/tests/the-sampler-counts-or-refuses.test.ts`.
    const { orphans } = reading(
      `const made = ${made};`,
      'sandboxes.push(made);',
      'while (sandboxes.length > 0) rmSync(sandboxes.pop() as string, { recursive: true });',
    );
    expect(orphans).toEqual([]);
  });

  it('clears a name that leaves as a field of a returned shape', () => {
    // `integration/enrollment-e2e.test.ts`. Not an array and not a loop: the sandbox is made in
    // a helper, leaves as `{ root }`, and is removed through the object the helper handed back.
    const { orphans } = reading(
      'function openMachine(prefix) {',
      `  const root = ${made};`,
      '  return { root, writer: openChainForWriting(root) };',
      '}',
      'rmSync(a.root, { recursive: true, force: true });',
    );
    expect(orphans).toEqual([]);
  });

  it('clears a sandbox born as a field of an object', () => {
    // `chain/src/chain/backup.test.ts` — `keyRoot = { root: mkdtempSync(…) }`, removed as
    // `rmSync(keyRoot.root, …)`. The name this rule follows is the path, not the variable.
    const { orphans, unbound } = reading(
      `keyRoot = { root: ${made} };`,
      'rmSync(keyRoot.root, { recursive: true, force: true });',
    );
    expect({ orphans, unbound }).toEqual({ orphans: [], unbound: 0 });
  });

  it('counts a making it cannot bind a name for, rather than clearing it', () => {
    // The rule's own silence, made loud. A making whose value goes straight into a call binds
    // no name, so there is nothing to follow — and the case above turns this count into a red.
    expect(reading(`roots.push(${made});`)).toEqual({ orphans: [], unbound: 1 });
  });

  it('does not clear a name a removal merely mentions', () => {
    // A removal is aimed at ONE thing. Reading every identifier in `rmSync(join(a, b))` as
    // removed is the loose rule that was measured beside this one: it accuses nobody in this
    // corpus, and it accepts the defect above.
    const { orphans } = reading(
      `const sandbox = ${made};`,
      'rmSync(elsewhere, { recursive: true, force: true });',
    );
    expect(orphans).toEqual(['sandbox']);
  });
});
