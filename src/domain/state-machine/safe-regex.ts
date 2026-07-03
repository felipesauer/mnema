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
 * deliberately conservative, dependency-free screen — it rejects the
 * classic ReDoS shape (a quantified group that is itself immediately
 * quantified, e.g. `(a+)+`, `(a*)*`, `(a+)*`, `(?:ab+)+`) and caps the
 * length. It errs toward refusing an exotic-but-safe pattern rather than
 * admitting an unsafe one; the built-in `format`s cover the common cases.
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

  // Nested quantifier: a group closed with `)` followed by a quantifier
  // (`* + ? {`), where the group's contents already contain a quantifier.
  // This is the hallmark of exponential backtracking, e.g. `(a+)+`,
  // `(a*)*`, `(?:x+)*`, `(a{1,9})+`. Non-quantified groups (`(abc)+`) are
  // fine and stay allowed.
  if (NESTED_QUANTIFIER.test(pattern)) {
    return 'pattern contains a nested quantifier (ReDoS risk); simplify it or use a built-in format';
  }

  return null;
}

/**
 * Matches a group whose body contains a quantifier and which is itself
 * immediately quantified — the nested-quantifier ReDoS shape. The body
 * `[^()]*` stays within a single group level (no nesting of parentheses),
 * which is enough to catch the common catastrophic patterns without a
 * full regex parser.
 */
const NESTED_QUANTIFIER = /\([^()]*[*+?}][^()]*\)[*+{]/;
