/**
 * WHO ASSERTS ABOUT A FILE — the question coverage cannot answer.
 *
 * Coverage says a line RAN. It never says anyone looked at what it produced. This
 * repository measured the gap against itself: FOUR files sat at 100% line coverage with
 * no test naming them at all, executed in passing by something asserting about something
 * else. A file like that is green in the report and has not one property pinned. (The
 * plan that opened this said five, and this comment repeated it; the fifth path it named,
 * `core/src/projections/session-store.ts`, is in no commit of this repository.)
 *
 * So this module answers a narrower question than "is it covered", and a wider one than
 * "is it imported":
 *
 *   Does some assertion observe a VALUE this file produced?
 *
 * A test file WITNESSES a product file when it imports it (or imports a `tests/support`
 * helper that imports it) AND an `expect(...)` somewhere in that test mentions an
 * identifier the imported bindings can reach. Reachability is a taint walk over the test's
 * own source: a binding taints what is assigned from it, the function whose body mentions
 * it, and — the case dependency injection needs — every collaborator HANDED to it, because
 * a test that passes a fake in and asserts on the fake is asserting about the callee.
 *
 * WHAT THIS DELIBERATELY DOES NOT COUNT, and why each exclusion is the point rather than a
 * shortcut:
 *
 *   - A CORPUS WALK. Guards here read every file under a directory and assert over the
 *     result ("no module in this layer does X"). By the mutation standard that IS an
 *     assertion about each file — edit one and the sweep reddens. Counting it would make
 *     this guard vacuous: repo-wide sweeps already reach nearly every file in
 *     `packages/code/src`, so every file would be witnessed and the question would answer
 *     itself. What such a sweep pins is one structural fact, never a behaviour, which is
 *     exactly the distance between coverage and the property.
 *   - A PATH LITERAL. Same reason, and it has a second consequence worth stating: because
 *     naming requires an IMPORT, a table of paths cannot name anything. The ledger in
 *     `every-file-has-a-test-that-names-it.test.ts` is nothing but path strings; under a
 *     rule that read literals, listing a file as debt would witness it and the ledger would
 *     dissolve itself. It cannot, here, by construction. How many rows it holds is not
 *     restated here — this said 77 while the table held 81, and a count with no assertion
 *     under it rots the moment the table moves. The count lives where it is pinned, in that
 *     file's `says how many, so a scanner that stopped scanning cannot pass`.
 *   - A PACKAGE SPECIFIER. `import { getRun } from '@mnema/core'` resolves to that
 *     package's BUILT `dist`, not to its source, so it executes and covers a different
 *     file. Measured: a mutation to `packages/core/src/projections/skill-store.ts` left
 *     every case in `packages/code/tests/mcp-session-cache.test.ts` green. Only relative
 *     specifiers are followed, which is precisely the set coverage instruments.
 *   - THE STRENGTH OF THE ASSERTION. `expect(x).toBeDefined()` counts the same as a
 *     round-trip. This says a property is pinned, never that it is a good one.
 *   - AN END-TO-END REACH. A module composed into `cli.ts` and driven by `cli-e2e` is
 *     reddened by mutation and is NOT witnessed here, because nothing observes a value it
 *     returned. That is the largest hole and it is declared, per file, in the ledger.
 *
 * Nothing here decides what to do about an unwitnessed file. It hands back who imports and
 * who asserts; the guard that asks owns the verdict.
 */

/** One file of the test tree, as this scanner reads it. Paths are repo-relative, POSIX. */
export interface TestSource {
  readonly path: string;
  readonly text: string;
}

/** One relative specifier this scanner followed and found nothing at the end of. */
export interface Unresolved {
  /** The file the specifier was written in. */
  readonly from: string;
  /** The specifier, verbatim as written. */
  readonly specifier: string;
}

/** Who reaches each product file, by the two questions this module separates. */
export interface Witnessing {
  /** Product path to the test files that import it, directly or through a helper. */
  readonly importedBy: ReadonlyMap<string, readonly string[]>;
  /** Product path to the test files whose assertions observe a value from it. */
  readonly witnessedBy: ReadonlyMap<string, readonly string[]>;
  /**
   * Every relative specifier that named nothing — the fact this scanner used to discard.
   *
   * A relative specifier is either a file or a mistake, and the walk that resolves them
   * met both and said nothing about either: it took `undefined` and moved to the next
   * import. THAT IS HOW A WRONG PATH ENTERED THE BRANCH THIS SCANNER IS THE POINT OF.
   * `completion/lookups.test.ts` asked for `'../io.js'`, where no file has ever been —
   * the interface it wanted is under `wiring/` and every sibling spells it that way —
   * and nothing anywhere went red, because `tsc -b` excludes `.test.ts` and esbuild
   * strikes an `import type` before the runner ever loads the module. Two full passes
   * over this guard read past it.
   *
   * So the fact leaves here and the verdict is the caller's, the same split the module
   * comment draws: some of these are legitimate and must be declared with a reason,
   * because this resolver only ever looks for TypeScript under a package — a `.mjs`
   * beside the workflow files cannot resolve however right the path is.
   */
  readonly unresolved: readonly Unresolved[];
}

/** A `.test.ts` is a test; anything else handed in is a helper it may import. */
export function isTestFile(path: string): boolean {
  return path.endsWith('.test.ts');
}

// ---------------------------------------------------------------------------
// Reading the source
// ---------------------------------------------------------------------------

/** `a/b/../c` to `a/c`, with no filesystem behind it. */
export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/**
 * The file a relative specifier points at, or undefined.
 *
 * A bare or scoped specifier resolves to a package's built output rather than to a source
 * file, so it is deliberately not followed — see the module comment.
 */
export function resolveImport(
  from: string,
  specifier: string,
  known: ReadonlySet<string>,
): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = normalizePath(`${from.slice(0, from.lastIndexOf('/'))}/${specifier}`);
  const candidates = [base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}/index.ts`];
  return candidates.find((candidate) => known.has(candidate));
}

/**
 * Every `import`/`export ... from '<specifier>'`, with the clause that precedes `from`.
 *
 * THE CLAUSE IS SPELLED OUT, and the premise that let it be `[\s\S]*?` was that a lazy
 * match stops at the first `from` and so cannot go far. It can. A line-initial `export`
 * that begins a DECLARATION carries no `from` of its own, so the lazy run leaves the
 * declaration and keeps going until it finds someone else's — and because `matchAll` does
 * not overlap, whatever it crossed is gone. Measured over `packages/`: twenty-three such
 * invented clauses in twenty files, the largest of them out of `mcp/server.ts`.
 *
 * THOSE LENGTHS ARE DATED, and this paragraph used to write one as though it were not. It
 * said "the largest 466 lines long, out of `every-file-has-a-test-that-names-it.test.ts`",
 * which was two claims and both fell: the largest anywhere is `mcp/server.ts`, and 466 was
 * the guard's own clause when it was measured at `60d4df0f` — a file of 994 lines then.
 * An invented clause runs from a declaration to somebody else's `from`, so its length is a
 * property of how long the file has since become, and every edit moves it. A number for it
 * belongs beside the commit it was taken at, which is why the ledger this module feeds
 * counts clauses and not lines.
 *
 * One of them RESOLVES: `wiring/verb.ts` opens at `export interface Wiring {`, runs
 * fifty-one lines to the `from` on the re-export below it, lands on `record-effect.ts`,
 * and would hand `boundNames` eight fragments of doc-comment prose as the names that file
 * bound — while the real `export type { RecordEffect }` it crossed is never seen at all.
 * So the old reading both invented a file's bindings and erased a true one, in one site.
 * WOULD, not did: this scanner is only ever handed the test tree, and that file is `src`,
 * so nothing here ever read it. The narrowing is what recovers the true re-export, and
 * over `packages/` it is the one specifier the change GAINS.
 *
 * A clause holds identifiers, `type`, `as`, `*`, commas, braces and whitespace, and that
 * is the whole grammar; naming it is what closes the run-on, because `(`, `;`, `=` and `:`
 * end any declaration this could wander into. Over the tree this scanner reads the change
 * drops the three invented clauses and not one true declaration — 2351 matches to 2348.
 *
 * THE COST IS A COMMENT INSIDE A CLAUSE, and it is written here, once. This paragraph used
 * to declare that cost as a BLOCK comment and then say none existed; the second half was
 * read as being about comments in clauses, and about those it is false. What falsified it
 * is `copilot/src/index.ts:26`, an `export type {` carrying three LINE comments among the
 * names, with slashes, apostrophes and em-dashes on their way to `} from '@mnema/core'`.
 * The grammar above admits none of that, so the statement is not matched wrong — it is not
 * matched at all: handed that file this returns twenty-four clauses and `@mnema/core` is
 * not among them, where `[\s\S]*?` returned twenty-five and it was. Measured over
 * `packages/`, that clause is the ONLY one holding a character outside the set, and the
 * block comment the paragraph predicted is in no clause at all — the twenty-two others the
 * narrowing drops are the run-on's own inventions, whose specifiers read `not a member`
 * and `the plugin was not installed that week`.
 *
 * AND IT IS INERT FOR A REASON THAT IS NOT THE FORM'S ABSENCE. Not the coverage exclude
 * either: `witnessing` is handed a product file as a PATH and never as text, so no `src`
 * file's clause is read here by anything. The barrel stays out because it is not a test,
 * and it is already carried as an unresolved row for the case that imports it. Written
 * inside `tests/`, a clause of this shape would be dropped in silence, and that is the
 * trade worth naming rather than leaving to be discovered.
 *
 * BOTH QUOTES, and that reason is unchanged. Written with single quotes alone, a lone
 * `from "./two.js"` made the following `export { e } from './three.js'` bind `b` and `d`,
 * which is the ledger being told about the wrong file. The repository writes single quotes
 * and its formatter enforces them, so that one is not live; it costs a character.
 *
 * A bare `import './x.js'` has no `from` and so is not seen, and neither is
 * `await import('./x.js')`. Both are declared in the guard rather than implied here: the
 * six dynamic imports in this test tree all name a file some static import already
 * reaches, so no ledger row turns on them.
 */
export function importClauses(text: string): { clause: string; specifier: string }[] {
  const found: { clause: string; specifier: string }[] = [];
  for (const match of text.matchAll(
    /(?:^|\n)\s*(?:import|export)\b([\w$*,{}\s]*?)from\s*(['"])([^'"]+)\2/g,
  )) {
    found.push({ clause: match[1] as string, specifier: match[3] as string });
  }
  return found;
}

/**
 * Whether a clause is type-only for its WHOLE specifier — `import type { X } from '...'`.
 *
 * esbuild ERASES such an import: the module is never loaded, nothing it would produce can
 * have been observed, and calling it an import overstates what happened by the widest
 * margin this scanner is capable of. Measured on this repository: seventy-three clauses
 * are shaped this way, and six product files were called witnessed on the strength of
 * them alone — the GUARD's header names which, at its point 5, and says what falsified
 * the earlier reading. This sentence used to send the reader to the module comment above,
 * which names none of them; the list has only ever been in the guard.
 *
 * Type-only in PART is a different fact. `import { a, type B }` still loads the module,
 * so it IS an import; `boundNames` drops the `B` and keeps the `a`. The keyword needs a
 * name after it to be a keyword: `import type from '...'` binds a default called `type`,
 * and is not this.
 */
export function isTypeOnlyClause(clause: string): boolean {
  return /^\s*type\s+\S/.test(clause);
}

/**
 * The names a clause binds: `{ a, b as c }`, a default, and `* as ns`.
 *
 * A binding is what the emitted code can still reach, so a type never is. The whole-clause
 * form binds nothing at all, and an inline `type B` is dropped from among its siblings —
 * which is the same rule read once, not twice.
 */
export function boundNames(clause: string): string[] {
  if (isTypeOnlyClause(clause)) return [];
  const names = new Set<string>();
  const braced = clause.match(/\{([\s\S]*?)\}/);
  if (braced) {
    for (const part of (braced[1] as string).split(',')) {
      const one = part.trim();
      if (one === '') continue;
      // `type B` and `type B as C` bind nothing. `type` and `type as t` are a binding
      // that happens to be named `type`, which is not a reserved word.
      if (/^type\s+(?!as\b)\S/.test(one)) continue;
      const renamed = one.match(/(\S+)\s+as\s+(\S+)/);
      names.add(renamed ? (renamed[2] as string) : one);
    }
  }
  const rest = clause.replace(/\{[\s\S]*?\}/, '');
  for (const star of rest.matchAll(/\*\s+as\s+([A-Za-z_$][\w$]*)/g)) names.add(star[1] as string);
  for (const plain of rest.matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/g)) {
    names.add(plain[1] as string);
  }
  return [...names];
}

/** Every identifier a chunk of code mentions. */
function identifiersIn(chunk: string): Set<string> {
  return new Set(chunk.match(/[A-Za-z_$][\w$]*/g) ?? []);
}

/** The offset just past the construct that opens at `from`, matching brackets. */
function endOfBracketed(code: string, from: number): number {
  let depth = 0;
  for (let at = from; at < code.length; at++) {
    const char = code[at] as string;
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0) return at + 1;
    }
  }
  return code.length;
}

/** The offset just past a `<...>` type-parameter or type-argument list. */
function endOfAngled(code: string, from: number): number {
  let depth = 0;
  for (let at = from; at < code.length; at++) {
    const char = code[at] as string;
    if (char === '=' && code[at + 1] === '>') continue;
    if (char === '<') depth += 1;
    else if (char === '>') {
      depth -= 1;
      if (depth === 0) return at + 1;
    }
  }
  return code.length;
}

/**
 * The offset of a function's BODY brace, or -1 where a declaration has none.
 *
 * The naive read is the first `{` after the name, and THREE shapes defeat it, all of them
 * live in this repository: a brace among the type parameters
 * (`landed<T extends { ok: boolean }>`), a brace in a parameter's own type, and a brace in
 * the return annotation (`fixedClock(): { clock: Clock; tick: () => void } {`). Each makes
 * the ANNOTATION the captured body — and an annotation mentions types, never values, so the
 * taint walk goes quiet over a function that in truth carries everything.
 *
 * Measured with both readings taking the SAME blanked source, so the blanker is not a
 * variable in it: over the 1271 declarations in this test tree, the first-brace reading
 * captured a different body for a couple of hundred of them. It cut both ways, which is
 * why it could not be left standing as the conservative side of a guard —
 * `packages/core/src/workflow/clock.ts` was absent from the ledger because of it, and
 * `packages/code/src/version.ts` was present in the ledger because of it.
 *
 * THOSE FIGURES NEEDED THEIR INSTRUMENT, and this paragraph gave them without it. It said
 * 1270 declarations, a different body for 224, none found at all for 4, across 127 files.
 * The declaration count is 1271. The other three cannot be reproduced from anything that
 * exists: they compare against a first-brace reading that was deleted, so re-deriving them
 * means rebuilding it, and a rebuilt one gives 233 across 126 files with nothing unfound.
 * A number only a deleted instrument can produce is given as a magnitude, and the one that
 * outlives its instrument is given exactly.
 *
 * The rule for the annotation is one line long: a `{` inside a group belongs to a type, and
 * a `{` at the top belongs to the body UNLESS what precedes it still WANTS a type — after
 * `:`, `|`, `&`, `,`, or an arrow. That is the entire difference between `: { a } {`, where
 * the first brace is a type, and `: Promise<{ a }> {`, where it is not.
 */
function bodyBrace(code: string, afterName: number): number {
  let at = afterName;
  const skipSpace = (): void => {
    while (at < code.length && /\s/.test(code[at] as string)) at += 1;
  };
  skipSpace();
  if (code[at] === '<') {
    at = endOfAngled(code, at);
    skipSpace();
  }
  if (code[at] !== '(') return -1;
  at = endOfBracketed(code, at);
  skipSpace();
  if (code[at] === '{') return at;
  if (code[at] !== ':') return -1;
  at += 1;
  let wants = true;
  let angle = 0;
  let group = 0;
  while (at < code.length) {
    const char = code[at] as string;
    if (char === '=' && code[at + 1] === '>') {
      wants = true;
      at += 2;
      continue;
    }
    if (char === '{') {
      if (angle === 0 && group === 0 && !wants) return at;
      at = endOfBracketed(code, at);
      wants = false;
      continue;
    }
    if (char === '<') angle += 1;
    else if (char === '>') {
      if (angle > 0) angle -= 1;
      wants = false;
    } else if (char === '(' || char === '[') group += 1;
    else if (char === ')' || char === ']') {
      if (group > 0) group -= 1;
      wants = false;
    } else if (char === ':' || char === '|' || char === '&' || char === ',') wants = true;
    else if (char === ';' || char === '}' || char === '=') return -1;
    else if (!/\s/.test(char)) {
      // `readonly` is a MODIFIER and not a type, so what follows it is still the type.
      // Any other word ends the wait, which made the brace of `): readonly { … }[] {`
      // read as the body: six declarations in this tree, each captured as a run of
      // field names that mentions no value a walk could carry.
      if (code.startsWith('readonly', at) && !/[\w$]/.test(code[at + 8] ?? '')) {
        at += 8;
        continue;
      }
      wants = false;
    }
    at += 1;
  }
  return -1;
}

/** The offset the statement holding `from` ends at: a `;`, or a line no chain continues. */
function endOfStatement(code: string, from: number): number {
  let depth = 0;
  for (let at = from; at < code.length; at++) {
    const char = code[at] as string;
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      if (depth < 0) return at;
    } else if (depth === 0 && char === ';') return at;
    else if (depth === 0 && char === '\n') {
      let ahead = at;
      while (ahead < code.length && /\s/.test(code[ahead] as string)) ahead += 1;
      const next = code[ahead];
      if (next === '.' || next === '?' || next === ')') continue;
      return at;
    }
  }
  return code.length;
}

/**
 * Every assertion in a test file, as the text of the whole `expect(...)` statement.
 *
 * The subject is in the parentheses and the expected value is in the matcher, and both
 * halves are kept: `expect(printed).toContain(theHeading)` asserts about whatever produced
 * `theHeading` just as much as about `printed`. Fed comment-blanked source, so `expect(` in
 * prose is not an assertion.
 */
export function assertionStatements(code: string): string[] {
  const out: string[] = [];
  for (const match of code.matchAll(/\bexpect\s*(?:\.\w+)?\s*\(/g)) {
    const opens = (match.index as number) + match[0].length - 1;
    out.push(code.slice(match.index as number, endOfStatement(code, endOfBracketed(code, opens))));
  }
  return out;
}

// ---------------------------------------------------------------------------
// The taint walk
// ---------------------------------------------------------------------------

/** The three shapes a value can travel through inside one test file. */
interface Flows {
  /** `const <pattern> = <initializer>` and its `let`/`var` siblings, plus assignments. */
  readonly bindings: readonly { readonly binds: readonly string[]; readonly from: string }[];
  /** `function name(...) { body }` — the name carries whatever the body reaches. */
  readonly functions: readonly { readonly name: string; readonly body: string }[];
  /** `callee(args)` — what a tainted callee is HANDED is observable through it. */
  readonly calls: readonly { readonly callee: string; readonly args: string }[];
}

/** Reads the three flows out of one test file's comment-blanked source, once. */
export function flowsIn(code: string): Flows {
  const bindings: { binds: readonly string[]; from: string }[] = [];
  for (const match of code.matchAll(/\b(?:const|let|var)\s+([\s\S]{0,400}?)=\s*/g)) {
    const pattern = match[1] as string;
    if (pattern.includes(';')) continue;
    const opens = (match.index as number) + match[0].length;
    bindings.push({
      binds: [...identifiersIn(pattern)],
      from: code.slice(opens, endOfStatement(code, opens)),
    });
  }
  for (const match of code.matchAll(/(?:^|[;{}\n])\s*([A-Za-z_$][\w$]*)\s*=[^=>]/g)) {
    const opens = (match.index as number) + (match[0] as string).length;
    bindings.push({
      binds: [match[1] as string],
      from: code.slice(opens, endOfStatement(code, opens)),
    });
  }
  const functions: { name: string; body: string }[] = [];
  for (const match of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) {
    const brace = bodyBrace(code, (match.index as number) + match[0].length);
    if (brace < 0) continue;
    functions.push({
      name: match[1] as string,
      body: code.slice(brace, endOfBracketed(code, brace)),
    });
  }
  const calls: { callee: string; args: string }[] = [];
  for (const match of code.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
    const opens = (match.index as number) + match[0].length - 1;
    calls.push({
      callee: match[1] as string,
      args: code.slice(opens, endOfBracketed(code, opens)),
    });
  }
  return { bindings, functions, calls };
}

/**
 * The one identifier no walk may reach: the verb the assertions are made with.
 *
 * `asserted` is every identifier inside an `expect(...)` statement, so `expect` is in all of
 * them. A walk that reaches the WORD therefore intersects every assertion in the file, and
 * "some assertion observes a value this file produced" collapses back into "some test
 * imports this file" — which is the question this module exists to be narrower than, so the
 * collapse is total rather than partial.
 *
 * It is reached the ordinary way, by the third rule below: a test that hands `expect` to
 * something tainted taints it. Measured over this repository by taking the guard out and
 * driving the walk exactly as `witnessing` drives it — once per (test, product) pair, from
 * that pair's own seeds — EIGHTEEN test files reach it, sixteen of them through a tainted
 * call's arguments and the other two through a binding or a function body. This comment
 * said seven; that number came from seeding a file's imports all at once instead of pair by
 * pair, which is a different question and answers 4, and neither is what the scanner does.
 * No ledger row moves either way, and nothing here detected that, which is the argument for
 * closing it rather than writing it down.
 */
const THE_ASSERTION_VERB = 'expect';

/**
 * Every identifier a set of seeds can reach, to a fixed point.
 *
 * The three rules, and the third is the one a fake needs: a value taints what is derived
 * from it, a function taints its own name, and a CALL taints its arguments — because the
 * only thing a test can observe about `armSessionClose(fake, close)` is what it did to
 * `fake`.
 */
export function reachedFrom(flows: Flows, seeds: readonly string[]): ReadonlySet<string> {
  const reached = new Set(seeds);
  reached.delete(THE_ASSERTION_VERB);
  for (let pass = 0; pass < 8; pass++) {
    let grew = false;
    const admit = (name: string): void => {
      if (name === THE_ASSERTION_VERB || reached.has(name)) return;
      reached.add(name);
      grew = true;
    };
    for (const call of flows.calls) {
      if (!reached.has(call.callee)) continue;
      for (const name of identifiersIn(call.args)) admit(name);
    }
    for (const binding of flows.bindings) {
      if (binding.binds.some((name) => reached.has(name))) continue;
      if (![...identifiersIn(binding.from)].some((name) => reached.has(name))) continue;
      for (const name of binding.binds) admit(name);
    }
    for (const fn of flows.functions) {
      if (reached.has(fn.name)) continue;
      if (![...identifiersIn(fn.body)].some((name) => reached.has(name))) continue;
      admit(fn.name);
    }
    if (!grew) break;
  }
  return reached;
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

/** One test file, parsed once: nobody re-reads a source per product file. */
interface Scanned {
  readonly path: string;
  readonly flows: Flows;
  readonly asserted: ReadonlySet<string>;
  /** Product file to the names this test brought in for it. */
  readonly seeds: ReadonlyMap<string, Set<string>>;
}

/**
 * Who imports and who asserts, for every product file handed in.
 *
 * `blank` is the comment-and-literal blanker the other structural guards read source
 * with (`reading-source.ts`), passed in rather than imported so this module stays free of
 * the filesystem and can be driven with sources written by hand.
 */
export function witnessing(
  product: readonly string[],
  sources: readonly TestSource[],
  blank: (source: string) => string,
): Witnessing {
  const productPaths = new Set(product);
  const known = new Set([...product, ...sources.map((one) => one.path)]);

  /**
   * The ONE place a specifier is followed, so the miss is recorded wherever it happens.
   *
   * Both walks below resolve imports — the helpers' and the tests' — and a rule written
   * at each of them is two rules, which is the shape this whole file exists to catch. A
   * specifier is recorded once per (file, specifier) pair; a file that imports the same
   * missing module twice is one fact, not two.
   */
  const missed = new Map<string, Unresolved>();
  const follow = (from: string, specifier: string): string | undefined => {
    const target = resolveImport(from, specifier, known);
    if (target === undefined && specifier.startsWith('.')) {
      missed.set(`${from}\0${specifier}`, { from, specifier });
    }
    return target;
  };

  /** What each helper under `tests/` pulls out of production, so a test can relay it. */
  const throughHelper = new Map<string, Set<string>>();
  /** And which helpers a helper imports, because the relay is not one hop deep. */
  const helperToHelper = new Map<string, string[]>();
  for (const source of sources) {
    if (isTestFile(source.path)) continue;
    const reached = new Set<string>();
    const onward: string[] = [];
    for (const { clause, specifier } of importClauses(source.text)) {
      // FOLLOWED FIRST, and the type-only skip comes after: whether esbuild erases
      // the import decides if it is an IMPORT, never whether the path is a path. The
      // wrong specifier that reached this branch was `import type`, so a walk that
      // skipped before following could not have seen it.
      //
      // THE ORDER HERE IS ITS OWN CASE, and it had none: `in the HELPER walk too` is
      // what swapping this pair reddens, and swapping it reddened nothing before that
      // case existed. The skip itself is `relays nothing through a helper whose
      // re-export a compiler erases` — deleting it outright was green too.
      const target = follow(source.path, specifier);
      if (isTypeOnlyClause(clause)) continue;
      if (target === undefined) continue;
      if (productPaths.has(target)) reached.add(target);
      else if (!isTestFile(target)) onward.push(target);
    }
    throughHelper.set(source.path, reached);
    helperToHelper.set(source.path, onward);
  }
  // A helper may reach production through another helper, and this repository has one such
  // chain: `support/pty.ts` imports `support/console.ts`, which imports `repl/floor.ts`.
  // Stopping at one hop would make the answer depend on how deeply somebody nested a
  // helper, so the relay is closed to a fixed point instead. It terminates on a cycle —
  // `pty.ts` and `screen.ts` import each other — because a pass that adds nothing ends it.
  for (let pass = 0; pass < sources.length; pass++) {
    let grew = false;
    for (const [helper, reached] of throughHelper) {
      for (const other of helperToHelper.get(helper) ?? []) {
        for (const file of throughHelper.get(other) ?? []) {
          if (reached.has(file)) continue;
          reached.add(file);
          grew = true;
        }
      }
    }
    if (!grew) break;
  }

  const scanned: Scanned[] = [];
  for (const source of sources) {
    if (!isTestFile(source.path)) continue;
    const seeds = new Map<string, Set<string>>();
    const seed = (file: string, names: readonly string[]): void => {
      const held = seeds.get(file) ?? new Set<string>();
      for (const name of names) held.add(name);
      seeds.set(file, held);
    };
    for (const { clause, specifier } of importClauses(source.text)) {
      // FOLLOWED FIRST, and the type-only skip comes after: whether esbuild erases
      // the import decides if it is an IMPORT, never whether the path is a path. The
      // wrong specifier that reached this branch was `import type`, so a walk that
      // skipped before following could not have seen it — that specifier is the defect
      // this whole guard shipped to catch, and it is what `in the case walk` pins.
      const target = follow(source.path, specifier);
      if (isTypeOnlyClause(clause)) continue;
      if (target === undefined) continue;
      const names = boundNames(clause);
      if (productPaths.has(target)) seed(target, names);
      else for (const file of throughHelper.get(target) ?? []) seed(file, names);
    }
    const code = blank(source.text);
    scanned.push({
      path: source.path,
      flows: flowsIn(code),
      asserted: identifiersIn(assertionStatements(code).join('\n')),
      seeds,
    });
  }

  const importedBy = new Map<string, string[]>(product.map((file) => [file, []]));
  const witnessedBy = new Map<string, string[]>(product.map((file) => [file, []]));
  for (const test of scanned) {
    for (const [file, names] of test.seeds) {
      importedBy.get(file)?.push(test.path);
      if (names.size === 0) continue;
      const reached = reachedFrom(test.flows, [...names]);
      for (const name of test.asserted) {
        if (reached.has(name)) {
          witnessedBy.get(file)?.push(test.path);
          break;
        }
      }
    }
  }
  return { importedBy, witnessedBy, unresolved: [...missed.values()] };
}
