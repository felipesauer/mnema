/**
 * Maximum length of a workflow field `pattern`. Patterns are gate
 * validators, not programs — a legitimate one is short. A cap bounds the
 * work the regex engine can be handed and blocks pathological inputs.
 */
export const MAX_PATTERN_LENGTH = 200;

/**
 * Result of a pattern safety check: `null` when the pattern is safe to
 * compile and run, or a human-readable reason when it must be rejected.
 */
export type PatternRejection = string | null;

/**
 * Screens a workflow field `pattern` before it is ever compiled into a
 * live `RegExp` and matched against agent/user payloads.
 *
 * Workflow files are agent-writable, and `buildString` compiles their
 * `pattern` directly; a catastrophically-backtracking regex (ReDoS) plus
 * a crafted payload would peg the synchronous CLI/MCP process. This is a
 * deliberately conservative, dependency-free screen that rejects two
 * families of super-linear shape:
 *
 * 1. A quantified GROUP whose body can backtrack — its body holds its own
 *    quantifier (`(a+)+`, `(a*)*`, `(?:ab+)+`), an overlapping alternation
 *    (`(a|a)*`, `(a|ab)*`, `([a-z]|[a-z])*`), or a nested group
 *    (`((a+))+`).
 * 2. Two ADJACENT quantified atoms that can match the same character —
 *    `\w*\w*`, `.*.*`, `a+a+`, `[a-z]*[a-z]*` — where a run of the shared
 *    class can be split between them in quadratically many ways. This has
 *    no quantified group at all, so it slips a group-only screen yet still
 *    runs super-linearly at match time.
 *
 * These are the classic exponential/polynomial shapes, and matching them
 * without a full regex parser means treating any quantified group with a
 * "dangerous" body as suspect, and any pair of overlapping adjacent
 * quantifiers as suspect. Plain quantified groups over disjoint literals
 * (`(abc)+`, `(ab|cd)+`) are still refused — we do not try to prove
 * disjointness — which is the cost of erring toward refusal; the built-in
 * `format`s and a length cap cover the common cases.
 *
 * Screening the pattern is necessary but not sufficient on its own — a
 * pattern that slips through still cannot blow up without a long input,
 * so `buildString` also caps the matched value length (defence in depth).
 *
 * @param pattern - The raw pattern string from the workflow spec
 * @returns `null` if safe, otherwise the reason it is rejected
 */
export function screenRegexPattern(pattern: string): PatternRejection {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return `pattern exceeds the ${MAX_PATTERN_LENGTH}-character limit`;
  }

  // Must be a compilable regex in the first place.
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `pattern is not a valid regular expression (${message})`;
  }

  if (hasDangerousQuantifiedGroup(pattern)) {
    return 'pattern contains a quantified group that can backtrack exponentially (nested quantifier, overlapping alternation, or nested group); simplify it or use a built-in format';
  }

  if (hasAdjacentOverlappingQuantifiers(pattern)) {
    return 'pattern contains adjacent quantifiers over overlapping character classes that can backtrack super-linearly (e.g. `\\w*\\w*`, `.*.*`, `a+a+`); simplify it or use a built-in format';
  }

  return null;
}

/**
 * Reports whether `pattern` contains a group that is immediately followed
 * by a `*`/`+`/`{` quantifier and whose body is itself capable of
 * super-linear backtracking. A body is treated as dangerous when it
 * contains another quantifier (`* + ? {`), an alternation (`|`), or a
 * nested group (`(`) — the three shapes behind catastrophic backtracking.
 *
 * This is a scanner, not a parser: it walks the string tracking group
 * depth and, whenever a group closes and is quantified, inspects the body
 * it just closed. Escaped parentheses (`\(`) and character classes
 * (`[...]`, where `(` `)` `|` are literal) are skipped so they neither
 * open a group nor count as a dangerous body character.
 */
function hasDangerousQuantifiedGroup(pattern: string): boolean {
  // Stack of the start index (just past `(`) of each open group.
  const openStarts: number[] = [];
  let inClass = false;

  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];

    if (ch === '\\') {
      i += 1; // skip the escaped character
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === '(') {
      openStarts.push(i + 1);
      continue;
    }
    if (ch === ')') {
      const start = openStarts.pop();
      if (start === undefined) continue; // unbalanced; RegExp() would have thrown
      const next = pattern[i + 1];
      if (next === '*' || next === '+' || next === '{') {
        // Body is [start, i). Dangerous if it can backtrack.
        const body = pattern.slice(start, i);
        if (bodyCanBacktrack(body)) return true;
      }
    }
  }
  return false;
}

/**
 * Whether a quantified group's body can drive super-linear backtracking:
 * it holds another quantifier, an alternation, or a nested group. A
 * leading group prefix — `?:` (non-capturing), `?=` `?!` (lookahead),
 * `?<=` `?<!` (lookbehind), `?<name>` (named) — is stripped first so its
 * `?`/`<` are not mistaken for a quantifier or content.
 */
function bodyCanBacktrack(body: string): boolean {
  const core = body.replace(/^\?(:|=|!|<=|<!|<[A-Za-z_][A-Za-z0-9_]*>)/, '');
  return /[*+?{]/.test(core) || core.includes('|') || core.includes('(');
}

/**
 * The set of characters a single atom can match, modelled coarsely enough
 * to decide whether two atoms can match the same character. `any` is `.`
 * (which we treat as overlapping everything); `unknown` is an atom we do
 * not model precisely (e.g. a group) and never claim to overlap, so it
 * cannot produce a false positive. Concrete sets carry a predicate.
 */
type CharSet =
  | { kind: 'any' }
  | { kind: 'unknown' }
  | { kind: 'set'; matches: (code: number) => boolean };

/** One top-level atom together with whether a repeatable quantifier follows. */
interface QuantifiedAtom {
  chars: CharSet;
  /** True for `*`, `+`, or a `{n,}`/`{n,m}` range whose upper bound > 1. */
  repeatable: boolean;
}

/**
 * Reports whether `pattern` places two adjacent atoms — each carrying a
 * repeatable quantifier — over overlapping character classes, the shape
 * behind quadratic backtracking such as `\w*\w*`, `.*.*a`, `a+a+`, or
 * `[a-z]*[a-z]*x`. A shared run of characters can be divided between the
 * two quantifiers in `O(n)` ways, so a failing tail forces the engine to
 * retry every division.
 *
 * This is a scanner over TOP-LEVEL atoms only: content inside a group is
 * not descended into (a quantified group is already covered by
 * {@link hasDangerousQuantifiedGroup}), and any group atom is modelled as
 * `unknown` so it never triggers a false overlap. Two atoms are adjacent
 * only when nothing separates them; an anchor or a non-overlapping atom
 * between two quantifiers breaks the chain.
 */
function hasAdjacentOverlappingQuantifiers(pattern: string): boolean {
  const atoms = scanTopLevelAtoms(pattern);
  for (let i = 1; i < atoms.length; i += 1) {
    const prev = atoms[i - 1];
    const curr = atoms[i];
    if (prev === undefined || curr === undefined) continue;
    if (prev.repeatable && curr.repeatable && charSetsOverlap(prev.chars, curr.chars)) {
      return true;
    }
  }
  return false;
}

/**
 * Walks `pattern` left to right, emitting one {@link QuantifiedAtom} per
 * top-level atom (literal, `.`, escape class, character class, or group)
 * paired with the quantifier that immediately follows it. Groups are
 * skipped over as a single opaque `unknown` atom — their contents are the
 * quantified-group screen's concern — and anchors/other zero-width markers
 * are emitted as non-repeatable `unknown` atoms so they break adjacency.
 */
function scanTopLevelAtoms(pattern: string): QuantifiedAtom[] {
  const atoms: QuantifiedAtom[] = [];
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i] as string; // in-bounds by the loop guard
    let chars: CharSet;

    if (ch === '\\') {
      chars = escapeCharSet(pattern[i + 1]);
      i += 2;
    } else if (ch === '[') {
      const end = findClassEnd(pattern, i);
      chars = classCharSet(pattern.slice(i + 1, end));
      i = end + 1;
    } else if (ch === '(') {
      // Skip the whole group as one opaque atom; its body is another
      // screen's concern and modelling it as `unknown` avoids false hits.
      i = skipGroup(pattern, i);
      chars = { kind: 'unknown' };
    } else if (ch === '.') {
      chars = { kind: 'any' };
      i += 1;
    } else {
      // A literal char, anchor (`^`/`$`), or alternation bar. Anchors and
      // `|` are zero-width/structural, not overlapping matchers.
      chars = ch === '^' || ch === '$' || ch === '|' ? { kind: 'unknown' } : literalCharSet(ch);
      i += 1;
    }

    const { repeatable, length } = readQuantifier(pattern, i);
    i += length;
    atoms.push({ chars, repeatable });
  }
  return atoms;
}

/** Index just past the `]` closing a character class opened at `open`. */
function findClassEnd(pattern: string, open: number): number {
  let i = open + 1;
  if (pattern[i] === '^') i += 1;
  if (pattern[i] === ']') i += 1; // a leading `]` is a literal member
  while (i < pattern.length && pattern[i] !== ']') {
    if (pattern[i] === '\\') i += 1;
    i += 1;
  }
  return i; // points at the closing `]` (or end if unbalanced)
}

/** Index just past the `)` closing a group opened at `open`. */
function skipGroup(pattern: string, open: number): number {
  let depth = 0;
  let inClass = false;
  for (let i = open; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return pattern.length; // unbalanced; RegExp() would have thrown earlier
}

/**
 * Reads the quantifier (if any) at `i`, returning whether it is repeatable
 * — allows more than one repetition, so a shared run can be split — and
 * how many characters it spans. A trailing lazy `?` is consumed too.
 */
function readQuantifier(pattern: string, i: number): { repeatable: boolean; length: number } {
  const ch = pattern[i];
  if (ch === '*' || ch === '+') {
    const lazy = pattern[i + 1] === '?' ? 1 : 0;
    return { repeatable: true, length: 1 + lazy };
  }
  if (ch === '?') return { repeatable: false, length: 1 };
  if (ch === '{') {
    const close = pattern.indexOf('}', i);
    if (close === -1) return { repeatable: false, length: 0 }; // literal `{`
    const spec = pattern.slice(i + 1, close);
    const match = /^(\d+)(,(\d*))?$/.exec(spec);
    if (match === null) return { repeatable: false, length: 0 }; // literal `{`
    const lower = Number(match[1]);
    const hasComma = match[2] !== undefined;
    const upperStr = match[3];
    // Repeatable when the range admits more than one repetition: `{n,}`
    // (open) or `{n,m}` with m > 1. `{n}` and `{0,1}`/`{1}` cannot split.
    const upper = hasComma ? (upperStr === '' ? Infinity : Number(upperStr)) : lower;
    const lazy = pattern[close + 1] === '?' ? 1 : 0;
    return { repeatable: upper > 1, length: close - i + 1 + lazy };
  }
  return { repeatable: false, length: 0 };
}

/** Character set for a single escaped atom `\x`. */
function escapeCharSet(next: string | undefined): CharSet {
  switch (next) {
    case 'w':
      return { kind: 'set', matches: isWordChar };
    case 'W':
      return { kind: 'set', matches: (c) => !isWordChar(c) };
    case 'd':
      return { kind: 'set', matches: isDigit };
    case 'D':
      return { kind: 'set', matches: (c) => !isDigit(c) };
    case 's':
      return { kind: 'set', matches: isSpace };
    case 'S':
      return { kind: 'set', matches: (c) => !isSpace(c) };
    default:
      // An escaped literal (`\.`, `\+`, `\\`, …). Treat as that single char.
      return next === undefined ? { kind: 'unknown' } : literalCharSet(next);
  }
}

/** Character set for a single literal character. */
function literalCharSet(ch: string): CharSet {
  const code = ch.charCodeAt(0);
  return { kind: 'set', matches: (c) => c === code };
}

/**
 * Character set for the body of `[...]` (between the brackets). Parses
 * ranges (`a-z`), escape classes (`\w`, `\d`, `\s` and negations), and
 * literal members. A negated class (`[^...]`) is modelled as `unknown`:
 * proving overlap of a complement precisely is not worth the risk, so we
 * decline to flag it rather than risk a false positive.
 */
function classCharSet(body: string): CharSet {
  if (body.startsWith('^')) return { kind: 'unknown' };
  const predicates: Array<(code: number) => boolean> = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i] as string; // in-bounds by the loop guard
    if (ch === '\\') {
      const inner = escapeCharSet(body[i + 1]);
      if (inner.kind === 'set') predicates.push(inner.matches);
      else if (inner.kind === 'any') return { kind: 'any' };
      i += 2;
      continue;
    }
    // A range `a-z`: a member, a `-`, and a member, none of them the end.
    const rangeEnd = body[i + 2];
    if (body[i + 1] === '-' && rangeEnd !== undefined && rangeEnd !== '\\') {
      const lo = ch.charCodeAt(0);
      const hi = rangeEnd.charCodeAt(0);
      predicates.push((c) => c >= lo && c <= hi);
      i += 3;
      continue;
    }
    const code = ch.charCodeAt(0);
    predicates.push((c) => c === code);
    i += 1;
  }
  return { kind: 'set', matches: (c) => predicates.some((p) => p(c)) };
}

function isWordChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 95 // _
  );
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isSpace(code: number): boolean {
  // \s per JS: space, tab, LF, VT, FF, CR, plus a few Unicode marks we
  // approximate with the common ASCII whitespace set.
  return code === 32 || (code >= 9 && code <= 13) || code === 160;
}

/**
 * Whether two atom character sets can match the same character. `any` (a
 * `.`) overlaps every concrete set; `unknown` overlaps nothing (so an
 * unmodelled atom can never produce a false positive). Two concrete sets
 * overlap when some code point in the printable ASCII range satisfies
 * both — the range legitimate gate patterns operate over.
 */
function charSetsOverlap(a: CharSet, b: CharSet): boolean {
  if (a.kind === 'unknown' || b.kind === 'unknown') return false;
  if (a.kind === 'any' || b.kind === 'any') return true; // `.` overlaps any concrete set
  for (let code = 0; code <= 0x7f; code += 1) {
    if (a.matches(code) && b.matches(code)) return true;
  }
  return false;
}
