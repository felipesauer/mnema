/**
 * Function words dropped from a task's text before matching it against
 * skills. Without this, a common word shared by a task and an unrelated
 * skill (e.g. "with", "runtime") would produce a false suggestion.
 *
 * Shared so that `skill_suggest` and `context_bootstrap`'s relevant-skills
 * pass tokenise identically — they are two entry points to the same
 * "which skills fit this task" question and must agree. The raw `search`
 * tool deliberately does NOT use this: literal search stays literal.
 *
 * Intentionally small — this is a false-positive filter, not a linguistic
 * stopword list.
 */
export const SKILL_SUGGEST_STOPWORDS: ReadonlySet<string> = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'this',
  'that',
  'into',
  'onto',
  'add',
  'new',
  'use',
  'via',
  'when',
  'then',
  'than',
  'over',
  'your',
  'their',
  'have',
  'will',
  'must',
  'should',
]);

/**
 * Tokenises free text into the quoted FTS5 terms used to match skills:
 * lowercased, split on non-alphanumerics, dropping tokens shorter than
 * four characters and any {@link SKILL_SUGGEST_STOPWORDS} entry, then
 * wrapping each survivor in double quotes so nothing is read as FTS5
 * syntax. Both `skill_suggest` and `context_bootstrap` call this so their
 * tokenisation is one implementation, not two that drift apart.
 *
 * @param text - Free text (task title + description + labels)
 * @returns Quoted FTS5 terms, ready to join with ` OR `
 */
export function skillMatchTerms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 4 && !SKILL_SUGGEST_STOPWORDS.has(token))
    .map((token) => `"${token}"`);
}
