/**
 * One rule for "newest first": the comparison every recency listing in this product
 * makes, written once, and a scan that keeps a seventh writing from appearing.
 *
 * SIX SITES HELD THE SAME COMPARISON AND THE SAME DEFECT. The search index's SQL and
 * its cross-tree merge, the opening context's work and awaiting lists, the focus
 * read's runs, the decisions-in-force list, and the usage listing's runs each wrote
 * *instant descending, then id* by hand — and every one of them broke the tie by id
 * ASCENDING. An ascending id is OLDEST first (`mintId` puts a monotonic counter beside
 * the millisecond precisely so that it is), so a listing whose first clause says
 * newest-first and whose second says oldest-first served the oldest record of a
 * millisecond at the top. It was invisible in review at every site because the result
 * is a TOTAL order: the answer was stable, and a stable answer looks correct.
 *
 * The trunk went red on it on 22/08/2026 — `search.test.ts`, two memories written in
 * one millisecond, the newer one not first — and one site was fixed while five stayed
 * wrong until this scan was written. That is the case for the scan and not for a
 * review checklist: a hand-written tie-break that is WRONG looks exactly like one that
 * is right, and there is no diff in which it stands out.
 *
 * WHAT THIS FILE USED TO BE, and what falsified it. It banned two spellings of a
 * descending ternary and NAMED the escapes it could not see — an argument-swapped
 * helper, a subtraction of two `Date.parse` results, a `.reverse()` over an ascending
 * sort. A named escape was then measured on the trunk: adding to `newest-first.ts`
 *
 *     return [...rows].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
 *
 * left this file at 2 passed. So the premise that a ban over SHAPES could hold the rule
 * was false, and it was false by construction rather than by an oversight — the set of
 * ways to spell *descending* is open, and a ban over an open set is a list of the ones
 * somebody thought of. The scan is now built the other way up.
 *
 * WHAT IS ASSERTED, and the four parts are different:
 *   - EVERY ORDERING THE PRODUCT INSTALLS IS ON A ROSTER. An ordering reaches a reader
 *     through `sort`/`toSorted`, through `reverse`/`toReversed`, or through SQL. The
 *     first two are enumerated from the DIRECTORY, not from a list, and each one is
 *     matched against {@link THE_ORDERINGS}. A site that is not on it is red whatever
 *     it is spelled like — which is the half a shape ban cannot have.
 *   - AN ORDERING OVER AN INSTANT CARRIES A NAME. A comparator written inline at the
 *     call may not read an instant field, so every ordering that could be the rule is
 *     forced to be a named function the roster can classify. This is what makes the
 *     roster's three classes exhaustive instead of aspirational.
 *   - AN ORDERING THAT MEANS NEWEST-FIRST ASKS THE RULE. For each roster entry marked
 *     {@link NEWEST}, the named comparator's own body has to reach `newestFirst`. This
 *     assertion has NO shape in it: rewriting `byStartedDesc` into a `Date.parse`
 *     subtraction, or into anything else at all, stops the body reaching the rule and
 *     turns the site red without the scan knowing what a descending comparison looks
 *     like.
 *   - THE RULE POINTS THE WAY IT CLAIMS TO. Asked of the exported function over a real
 *     pair of minted ids in `core/src/projections/newest-first.test.ts`, because a scan
 *     can only say the comparison is in one place; it cannot say that place is right.
 *
 * The old shape ban is KEPT, widened, as a backstop — see {@link DESCENDING_BY_HAND}.
 * It is the only thing watching the bodies of the OLDEST-first comparators, which by
 * construction do not reach `newestFirst` and so have nothing above to check them.
 *
 * WHERE THE SCAN IS STILL BLIND, named rather than left to be discovered:
 *   - A bare `sort()` is allowed with no roster entry. It is not an oversight: with no
 *     comparator, `sort` orders by the string form ASCENDING, and there is no argument
 *     it can be given to point the other way. It cannot express the rule.
 *   - An OLDEST-first comparator rewritten into a descending one has nothing above to
 *     catch it — it does not reach `newestFirst` by design — so it is held only by
 *     {@link DESCENDING_BY_HAND}, which is shape-limited. There is no shared rule to
 *     make it ask, because the four break their ties on four different second keys
 *     (id, who, `from`/`to`/role, id/scope/project) and the instant clause alone is
 *     just a string comparison.
 *     Measured, so the class is not read as uniform: flipping `oldestFirst` in
 *     `exposure.ts` turns 4 red, 3 of them behaviour cases in `exposure.test.ts`.
 *     Flipping `earliestSwitchOffFirst` in `switches.ts` turns 1 red, and it is this
 *     file's backstop — NO behaviour case anywhere names `channelStates`, so nothing
 *     else in the suite sees that direction change.
 *   - An instant read through a computed key (`a[field]`) is invisible to the check
 *     that an inline comparator names no instant. Measured: of the comparators in
 *     `src`, one indexes a tuple by a literal (`a[0]`, in `witness.ts`) and ZERO reach
 *     a field by a variable key.
 *   - SQL is not rostered here. Measured instead: `ORDER BY ... DESC` appears in `src`
 *     exactly once, inside {@link NEWEST_FIRST_SQL}; every other `ORDER BY` is
 *     ascending, and ascending cannot be the rule.
 *
 * WHAT IT COSTS, so the trade is on the record: an ordering added anywhere under a
 * package's `src` now has to be declared here, and a comparator over an instant has to
 * be a named function rather than an arrow at the call site. Three sites were renamed
 * to meet it — `transcripts.ts`, `switches.ts` and `search.ts`. The friction IS the
 * mechanism: the roster entry is where the author has to say which of the three
 * directions the new ordering means, and that sentence is the thing review can check.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The workspace's four packages, from this test file's own location. */
const PACKAGES = fileURLToPath(new URL('../..', import.meta.url));

/** The one file allowed to write the comparison, relative to {@link PACKAGES}. */
const THE_ONE_SITE = 'core/src/projections/newest-first.ts';

/**
 * The two spellings of a hand-written DESCENDING comparison of an instant field, plus
 * the two escapes that were measured on the trunk after the first version of this file
 * named them as possible.
 *
 * The swapped-helper term reads a PATH and not a bare field. Written `b.at` only, it
 * left `compare(b.row.switchedAt, a.row.switchedAt)` — the real shape of the one site
 * that reads its instant through a nested row — at zero red, which is the second time
 * this file's shape half was measured short of what the product actually writes.
 *
 * This list is a BACKSTOP and not the guard: the set of ways to spell *descending* is
 * open, so any ban over it is a list of what somebody thought of. It is kept because it
 * is the only thing that reads the bodies of the OLDEST-first comparators, and because
 * a shape that was measured escaping is worth a case even when the list around it can
 * never be complete.
 *
 * Matched against the file's CODE — comments and string literals removed, whitespace
 * flattened — because one of the six sites wrote its ternary across five lines and a
 * line-by-line scan saw nothing there, and because a scan that reads prose accuses the
 * doc-comment that names the escape (this file's own, on the first attempt). The field
 * is recognized by name — `at`, or anything ending in `At` — which is what every
 * projection in this record calls its instant.
 */
const DESCENDING_BY_HAND = [
  /\.(?:at|[A-Za-z]+At)\b\s*<[^?;{}]{0,64}\?\s*1\s*:\s*-1/,
  /\.(?:at|[A-Za-z]+At)\b\s*>[^?;{}]{0,64}\?\s*-1\s*:\s*1/,
  /(?:Date\.parse|\.getTime\(\))[^;{}]{0,96}-\s*(?:Date\.parse|new Date|[A-Za-z_$][\w$]*\.getTime)/,
  /\w*[Cc]ompare\w*\(\s*b(?:\.[\w$]+)*\.(?:at|[A-Za-z]+At)\b\s*,\s*a(?:\.[\w$]+)*\.(?:at|[A-Za-z]+At)\b/,
];

/** A field this record would call an instant, wherever it is read. */
const AN_INSTANT_FIELD = /\.(?:at|[A-Za-z]+At)\b/;

/** What a rostered ordering means. The three are exhaustive by the inline-name check. */
const NEWEST = 'newest first — asks the one rule';
const OLDEST = 'oldest first — an ascending tie-break AGREES with the instant here';
const OTHER = 'not an instant';

/** One ordering the product installs: where it is, what it is called, what it means. */
interface Rostered {
  readonly file: string;
  readonly by: string;
  readonly means: string;
  /** For a {@link NEWEST} entry that reaches the rule through another function. */
  readonly via?: string;
}

/**
 * EVERY named comparator installed at a `sort` in any package's `src`, and which of the
 * three directions it means. Enumerated from the directory below and compared against
 * this table, so a comparator that appears without an entry is red — the N+1 site the
 * scan exists to catch.
 */
const THE_ORDERINGS: readonly Rostered[] = [
  { file: 'code/src/commands/usage.ts', by: 'byStartedDesc', means: NEWEST },
  { file: 'code/src/repl/complete.ts', by: 'theOrder', means: OTHER },
  { file: 'code/src/transcripts.ts', by: 'oldestSessionFirst', means: OLDEST },
  { file: 'copilot/src/context/bootstrap.ts', by: 'byUpdatedDesc', means: NEWEST },
  { file: 'copilot/src/context/bootstrap.ts', by: 'byUpdatedDesc', means: NEWEST },
  { file: 'copilot/src/context/decisions.ts', by: 'bySettledDesc', means: NEWEST },
  { file: 'copilot/src/context/focus.ts', by: 'byStartedDesc', means: NEWEST },
  { file: 'copilot/src/context/focus.ts', by: 'byStartedDesc', means: NEWEST },
  {
    file: 'copilot/src/context/search.ts',
    by: 'byTheRecordsOwnOrder',
    means: NEWEST,
    via: 'compareSearchHits',
  },
  { file: 'copilot/src/context/skills.ts', by: 'byNameThenId', means: OTHER },
  { file: 'copilot/src/context/switches.ts', by: 'earliestSwitchOffFirst', means: OLDEST },
  { file: 'copilot/src/intelligence/accountability.ts', by: 'byCountThenWhich', means: OTHER },
  { file: 'copilot/src/intelligence/accountability.ts', by: 'byTotalThenWho', means: OTHER },
  { file: 'copilot/src/intelligence/accountability.ts', by: 'projectlessLast', means: OTHER },
  { file: 'copilot/src/intelligence/antipatterns.ts', by: 'projectlessLast', means: OTHER },
  { file: 'copilot/src/intelligence/exposure.ts', by: 'compare', means: OTHER },
  { file: 'copilot/src/intelligence/exposure.ts', by: 'oldestFirst', means: OLDEST },
  { file: 'copilot/src/intelligence/exposure.ts', by: 'projectlessLast', means: OTHER },
  { file: 'copilot/src/intelligence/governance.ts', by: 'bySpecificity', means: OTHER },
  { file: 'copilot/src/intelligence/provenance.ts', by: 'byNameThenId', means: OTHER },
  { file: 'copilot/src/intelligence/references.ts', by: 'byInstantThenEnds', means: OLDEST },
];

/**
 * EVERY `reverse`/`toReversed` in any package's `src`, with what it turns around.
 *
 * The third vector, and the one a comparator scan cannot see: reversing an ASCENDING
 * ordering serves newest-first without any descending comparison being written. None of
 * the four turns around an ordering — they are bytes and one already-ordered tip — and
 * a fifth has to be declared here before it can exist.
 */
const THE_REVERSALS: readonly (readonly [string, string])[] = [
  ['chain/src/chain/bitcoin.ts', 'a block hash, big-endian to little-endian'],
  ['chain/src/chain/bitcoin.ts', 'a block hash, big-endian to little-endian'],
  ['chain/src/chain/ots.ts', 'the bytes of a message'],
  ['chain/src/chain/store.ts', 'a tip already read in order'],
];

/**
 * A file's CODE: comments and string, template and regex literal bodies removed, then
 * whitespace flattened to single spaces.
 *
 * Both halves are load-bearing. Flattening is what let the five-line ternary be seen at
 * all. Stripping is what stops the scan reading PROSE — the first draft of the widened
 * shape list accused this very file, whose doc-comment spells the escape it names — and
 * it is what makes brace counting safe enough to lift a function body out.
 */
function codeOf(text: string): string {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const here = text[index] as string;
    if (here === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index++;
      out += ' ';
      continue;
    }
    if (here === '/' && text[index + 1] === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index++;
      index += 2;
      out += ' ';
      continue;
    }
    if (here === '/' && startsARegex(out)) {
      index = skipLiteral(text, index, '/');
      out += '/ /';
      continue;
    }
    if (here === "'" || here === '"' || here === '`') {
      index = skipLiteral(text, index, here);
      out += `${here}${here}`;
      continue;
    }
    out += here;
    index++;
  }
  return out.replace(/\s+/g, ' ');
}

/**
 * Whether a `/` at the end of what has been read so far opens a regex literal rather
 * than dividing. The usual heuristic: a division needs a value on its left, so anything
 * that cannot end a value opens a literal.
 */
function startsARegex(before: string): boolean {
  const previous = before.replace(/\s+$/, '').slice(-1);
  return previous === '' || '(,=:[!&|?{};+-*%<>~^'.includes(previous);
}

/** The index just past a literal that opens at `index` and closes on the next `end`. */
function skipLiteral(text: string, index: number, end: string): number {
  let at = index + 1;
  while (at < text.length) {
    const here = text[at];
    if (here === '\\') {
      at += 2;
      continue;
    }
    if (here === end) return at + 1;
    at++;
  }
  return text.length;
}

/** The text inside the brackets opening at `open`, and where they closed. */
function balancedAt(code: string, open: number): { inside: string; end: number } | null {
  let depth = 0;
  for (let index = open; index < code.length; index++) {
    const here = code[index] as string;
    if (here === '(' || here === '[' || here === '{') depth++;
    else if (here === ')' || here === ']' || here === '}') {
      depth--;
      if (depth === 0) return { inside: code.slice(open + 1, index), end: index };
    }
  }
  return null;
}

/** The text inside the brackets opening at `open`, or null when they never close. */
function balancedFrom(code: string, open: number): string | null {
  return balancedAt(code, open)?.inside ?? null;
}

/** One `sort`/`toSorted`/`reverse`/`toReversed` found in a file. */
interface Ordering {
  readonly file: string;
  readonly operation: string;
  /** The comparator: its name, `''` for a bare call, or the arrow's own text. */
  readonly argument: string;
}

/** Every ordering operation installed in one file's code. */
function orderingsIn(file: string, code: string): Ordering[] {
  const found: Ordering[] = [];
  for (const match of code.matchAll(/\.(sort|toSorted|reverse|toReversed)\(/g)) {
    const open = (match.index as number) + match[0].length - 1;
    const argument = balancedFrom(code, open);
    expect(argument, `${file}: unbalanced ${match[1]}(`).not.toBeNull();
    found.push({ file, operation: match[1] as string, argument: (argument as string).trim() });
  }
  return found;
}

/**
 * The body of a function declared in this code, or null when it is not declared here.
 *
 * The parameter list is stepped OVER rather than searched past: a comparator here takes
 * an inline object type (`a: { readonly updatedAt: string }`), so the first `{` after
 * the name belongs to a parameter and not to the body. Reading it as the body returned
 * a type literal for two of the five newest-first comparators, which is a false red.
 */
function bodyOf(code: string, name: string): string | null {
  const declared = new RegExp(`\\bfunction\\s+${name}\\s*[(<]`).exec(code);
  if (declared === null) return null;
  const takes = code.indexOf('(', declared.index);
  if (takes === -1) return null;
  const parameters = balancedAt(code, takes);
  if (parameters === null) return null;
  const opens = code.indexOf('{', parameters.end);
  return opens === -1 ? null : balancedFrom(code, opens);
}

/**
 * Every `function` and `const` declared in this code, with its body.
 *
 * Used for one thing: to answer *does this name read an instant*, about a name an inline
 * comparator CALLS. An arrow at the call site that reads no instant of its own but hands
 * the pair to a helper that does is a descending ordering with nothing of the rule in
 * sight — measured at zero red before this was written, and it is the shape the search
 * merge itself was written in until this delivery named it.
 */
function declarationsIn(code: string): Map<string, string> {
  const found = new Map<string, string>();
  const declares = /\b(?:function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*=)/g;
  for (const match of code.matchAll(declares)) {
    if (match[1] !== undefined) {
      const body = bodyOf(code, match[1]);
      if (body !== null) found.set(match[1], body);
      continue;
    }
    // A `const`: everything to the end of the statement, brackets counted so an object
    // or an arrow with a block body is taken whole.
    let depth = 0;
    const from = (match.index as number) + match[0].length;
    let index = from;
    for (; index < code.length; index++) {
      const here = code[index] as string;
      if ('([{'.includes(here)) depth++;
      else if (')]}'.includes(here)) depth--;
      else if (here === ';' && depth <= 0) break;
    }
    found.set(match[2] as string, code.slice(from, index));
  }
  return found;
}

/** Every non-test source file under `<package>/src`, relative to {@link PACKAGES}. */
function sourcesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(PACKAGES, directory), { withFileTypes: true })) {
    const here = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourcesUnder(here));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(here);
  }
  return found;
}

/** Every source of the workspace, asked of the directory rather than of a list. */
const SOURCES = readdirSync(PACKAGES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => {
    try {
      return sourcesUnder(join(entry.name, 'src'));
    } catch {
      return [];
    }
  })
  .map((file) => file.split(sep).join('/'));

/** Each source's code, read once. */
const CODE = new Map(
  SOURCES.map((file) => [file, codeOf(readFileSync(join(PACKAGES, file), 'utf8'))]),
);

/** Every ordering the product installs, from the directory rather than from a list. */
const INSTALLED = SOURCES.flatMap((file) => orderingsIn(file, CODE.get(file) as string));

/**
 * Every name declared anywhere in `src` whose body reads an instant field.
 *
 * `newestFirst` is in it, deliberately: an ordering that means newest-first has to be a
 * NAMED comparator the roster classifies, so reaching the rule from an arrow at the call
 * site is red too. The answer to that red is a name, not an exception.
 */
const TOUCHES_AN_INSTANT = new Set(
  SOURCES.flatMap((file) =>
    [...declarationsIn(CODE.get(file) as string)]
      .filter(([, body]) => AN_INSTANT_FIELD.test(body))
      .map(([name]) => name),
  ),
);

/**
 * Whether this piece of code reaches an instant — by naming one of its fields, or by
 * calling something that does.
 *
 * The second half is the one that was measured missing. Asked of an arrow at a call
 * site it is what stops an unclassified ordering; asked of a comparator the roster
 * calls {@link OTHER} it is what stops the roster's own classification going stale.
 */
function reachesAnInstant(code: string): boolean {
  if (AN_INSTANT_FIELD.test(code)) return true;
  return [...code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].some((call) =>
    TOUCHES_AN_INSTANT.has(call[1] as string),
  );
}

/** A `sort`/`toSorted` whose comparator is a plain name. */
const NAMED = INSTALLED.filter(
  (each) => each.operation !== 'reverse' && each.operation !== 'toReversed',
).filter((each) => /^[A-Za-z_$][\w$]*$/.test(each.argument));

/** How an entry is compared, so a table row and a found site are the same string. */
const asKey = (file: string, by: string): string => `${file} :: ${by}`;

describe('the instrument itself', () => {
  it('reads code and not prose', () => {
    // The case this instrument was born owing: the widened shape list below spells the
    // escape it bans, and a scan that read comments would accuse the file that carries
    // the doc-comment naming it.
    expect(codeOf('const a = 1; // b.at, a.at\n const c = 2;')).toBe('const a = 1; const c = 2;');
    expect(codeOf('/* Date.parse(b.at) - Date.parse(a.at) */ const a = 1;')).toBe(' const a = 1;');
    expect(codeOf("const a = 'b.at < a.at ? 1 : -1';")).toBe("const a = '';");
    expect(codeOf(`const a = \`\${x.at}\`;`)).toBe('const a = ``;');
    expect(codeOf('const a = /["\'{]/.test(s);')).toBe('const a = / /.test(s);');
    // And it still sees the code the strings and comments were hiding.
    expect(codeOf('x.sort(\n  (a, b) =>\n    a.at < b.at ? 1 : -1,\n);')).toBe(
      'x.sort( (a, b) => a.at < b.at ? 1 : -1, );',
    );
  });

  it('lifts a function body out, and says nothing when there is none', () => {
    const code = codeOf('function up(a, b) { return { k: 1 }; }\nfunction down() {}');
    expect(bodyOf(code, 'up')).toBe(' return { k: 1 }; ');
    expect(bodyOf(code, 'down')).toBe('');
    expect(bodyOf(code, 'sideways')).toBeNull();
  });
});

describe('one rule for newest first', () => {
  it('finds the sources at all — the scan is over a record, not an empty directory', () => {
    // The instrument's own case. A wrong root, or a `src` that moved, would empty the
    // list and every assertion below would pass by saying nothing.
    expect(SOURCES.length).toBeGreaterThan(200);
    expect(SOURCES).toContain(THE_ONE_SITE);
  });

  it('finds the orderings at all, and the roster is the size of what is installed', () => {
    // 48 ordering operations over 298 sources on the day this was written. The floor is
    // what makes a scan that suddenly matches nothing a failure rather than a pass.
    expect(INSTALLED.length).toBeGreaterThanOrEqual(44);
    expect(NAMED.length).toBeGreaterThanOrEqual(20);
    expect(THE_ORDERINGS.filter((each) => each.means === NEWEST)).toHaveLength(7);
    expect(THE_ORDERINGS.filter((each) => each.means === OLDEST)).toHaveLength(4);
  });

  it('installs no ordering that is not on the roster', () => {
    const found = NAMED.map((each) => asKey(each.file, each.argument)).sort();
    const rostered = THE_ORDERINGS.map((each) => asKey(each.file, each.by)).sort();

    // The N+1 site, whatever it is spelled like. A comparator reaches a reader only by
    // being installed at a `sort`, so a new writing of the rule — by subtraction, by a
    // swapped helper, by anything — has to appear here before it can matter.
    expect(found).toEqual(rostered);
  });

  it('lets no ordering over an instant hide in an arrow at the call site', () => {
    const inline = INSTALLED.filter(
      (each) =>
        (each.operation === 'sort' || each.operation === 'toSorted') &&
        each.argument !== '' &&
        !/^[A-Za-z_$][\w$]*$/.test(each.argument),
    );

    // What makes the roster's three classes exhaustive: an ordering that could be the
    // rule is forced to carry a name, and a name is what the table above classifies.
    // BOTH ways of reaching an instant are asked, because only asking the first left the
    // escape at ZERO red: an arrow that reads no instant itself and hands the pair to a
    // helper that does — which is how the cross-tree search merge was written.
    expect(inline.length).toBeGreaterThanOrEqual(9);
    const reaching = inline.filter((each) => reachesAnInstant(each.argument));
    expect(reaching.map((each) => `${each.file} :: ${each.argument}`)).toEqual([]);
  });

  it('turns nothing around that was put in order', () => {
    const reversals = INSTALLED.filter(
      (each) => each.operation === 'reverse' || each.operation === 'toReversed',
    );

    // Reversing an ASCENDING ordering serves newest-first with no descending comparison
    // written anywhere — the one vector a comparator scan is structurally blind to.
    expect(reversals.map((each) => each.file).sort()).toEqual(
      THE_REVERSALS.map(([file]) => file).sort(),
    );
  });

  it('makes every ordering that means newest-first ASK the rule', () => {
    const notAsking = THE_ORDERINGS.filter((each) => each.means === NEWEST).filter((each) => {
      const body = bodyOf(CODE.get(each.file) as string, each.by);
      if (body === null) return true;
      if (each.via === undefined) return !/\bnewestFirst\s*\(/.test(body);
      // Through a delegate: the body has to reach it, and the file that DECLARES the
      // delegate has to reach the rule — so the chain is checked and not assumed.
      const declaring = SOURCES.filter(
        (file) => bodyOf(CODE.get(file) as string, each.via as string) !== null,
      );
      return (
        !new RegExp(`\\b${each.via}\\s*\\(`).test(body) ||
        declaring.length === 0 ||
        !declaring.every((file) => /\bnewestFirst\s*\(/.test(CODE.get(file) as string))
      );
    });

    // No shape in this assertion. A comparator rewritten into a `Date.parse` subtraction
    // stops reaching the rule and goes red without the scan knowing what a descending
    // comparison looks like — which is the half the old ban could never have.
    expect(notAsking.map((each) => asKey(each.file, each.by))).toEqual([]);
  });

  it('holds the roster to its own classification — nothing else touches an instant', () => {
    const lying = THE_ORDERINGS.filter((each) => each.means === OTHER).filter((each) => {
      const body = bodyOf(CODE.get(each.file) as string, each.by);
      return body === null || reachesAnInstant(body);
    });

    // Without this, a comparator the table calls `not an instant` could be rewritten
    // into a descending instant comparison of any shape and stay green: its name never
    // changes, so the roster agrees; it means nothing newest-first, so nothing above
    // asks it for the rule. The classification has to be re-earned from the body.
    expect(lying.map((each) => asKey(each.file, each.by))).toEqual([]);
  });

  it('leaves the oldest-first orderings alone — the control', () => {
    const oldest = THE_ORDERINGS.filter((each) => each.means === OLDEST);

    // These four order from the OLDEST, where an ascending tie-break is the one that
    // agrees with the instant. If a tightening of this file ever reddens one of them,
    // the tightening reached past what it was for.
    expect(oldest.map((each) => each.file).sort()).toEqual([
      'code/src/transcripts.ts',
      'copilot/src/context/switches.ts',
      'copilot/src/intelligence/exposure.ts',
      'copilot/src/intelligence/references.ts',
    ]);
    for (const each of oldest) {
      expect(bodyOf(CODE.get(each.file) as string, each.by), asKey(each.file, each.by)).not.toBe(
        null,
      );
    }
  });

  it('is written by hand in exactly ONE file, and that file is newest-first.ts', () => {
    const writing = SOURCES.filter((file) =>
      DESCENDING_BY_HAND.some((shape) => shape.test(CODE.get(file) as string)),
    );

    // The backstop, kept for the OLDEST-first bodies that nothing above can check. Both
    // halves at once: nothing else writes it (the ban), and the one legal site DOES
    // match (the proof that the shapes are the shapes the product uses).
    expect(writing).toEqual([THE_ONE_SITE]);
  });
});
