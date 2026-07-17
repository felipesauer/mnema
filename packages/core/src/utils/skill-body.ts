/** Matches a `## Example` / `## Examples` heading at the start of a line. */
const EXAMPLE_HEADING = /^##\s+examples?\b/i;
/** Matches any top- or second-level Markdown heading (`# ` or `## `). */
const SAME_OR_HIGHER_HEADING = /^#{1,2}\s+/;

/**
 * Splits a skill body into its core prose and its worked-example sections.
 *
 * The skill linter pushes every skill to carry a `## Example` section, so
 * example bodies (sample paths, payloads, throwaway identifiers) would
 * otherwise be indexed at the same weight as the skill's real subject and
 * cause cross-topic false matches in search. Separating them lets the FTS
 * layer weight example tokens far below the core body.
 *
 * Contract: scanning line by line, everything before the first
 * `## Example`/`## Examples` heading is core. From that heading onward the
 * lines are examples — including any further `## Example`-family sections —
 * until the next same-or-higher-level heading (`#` or `##`) that is NOT an
 * Example heading, at which point the remainder returns to core. A body
 * with no Example heading yields `{ core: body, examples: '' }`.
 *
 * Lives in a leaf util (not the service) so the repository can call it on
 * the write path without importing the service and forming a cycle.
 *
 * @param body - The full skill content (no frontmatter)
 * @returns The core body and the concatenated example sections
 */
export function splitSkillExampleSections(body: string): { core: string; examples: string } {
  const lines = body.split('\n');
  const coreLines: string[] = [];
  const exampleLines: string[] = [];
  let inExample = false;

  for (const line of lines) {
    if (inExample) {
      // A same-or-higher heading that is not another Example heading ends the
      // example run; that line and everything after it is core again.
      if (SAME_OR_HIGHER_HEADING.test(line) && !EXAMPLE_HEADING.test(line)) {
        inExample = false;
        coreLines.push(line);
      } else {
        exampleLines.push(line);
      }
    } else if (EXAMPLE_HEADING.test(line)) {
      inExample = true;
      exampleLines.push(line);
    } else {
      coreLines.push(line);
    }
  }

  return { core: coreLines.join('\n'), examples: exampleLines.join('\n') };
}
