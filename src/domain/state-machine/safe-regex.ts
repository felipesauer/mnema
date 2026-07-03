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
 * deliberately conservative, dependency-free screen: it rejects an
 * immediately-quantified group whose body could backtrack — whether that
 * body holds its own quantifier (`(a+)+`, `(a*)*`, `(?:ab+)+`), an
 * overlapping alternation (`(a|a)*`, `(a|ab)*`, `([a-z]|[a-z])*`), or a
 * nested group (`((a+))+`). All three are classic exponential shapes, and
 * matching them without a full regex parser means treating any quantified
 * group with a "dangerous" body as suspect. Plain quantified groups
 * (`(abc)+`, `(ab|cd)+` over disjoint literals is still refused — we do
 * not try to prove disjointness) are the cost of erring toward refusal;
 * the built-in `format`s and a length cap cover the common cases.
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
