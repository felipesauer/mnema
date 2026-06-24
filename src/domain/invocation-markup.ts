/**
 * Guards against tool-invocation markup leaking into free-text fields.
 *
 * When an agent records an ADR (or any text field) via an MCP tool, a
 * malformed tool call can spill the invocation's own XML into the VALUE of a
 * parameter. The persisted text then ends with a garbage trailer and the
 * sibling fields it was meant to fill arrive empty.
 *
 * The reliable signatures of such a leak are the invocation tokens themselves —
 * `<invoke …>` / `</invoke>`, `<function_calls>` / `</function_calls>`, and
 * `<parameter name="…">` — optionally namespace-prefixed (e.g.
 * `<parameter …>`). These never occur in ordinary prose: a `<parameter>`
 * carries a `name=` attribute, and `invoke`/`function_calls` are not English
 * words an ADR would close with a tag.
 *
 * A bare field-closing tag like `</decision>` is deliberately NOT treated as a
 * leak on its own — an ADR may legitimately discuss `</title>` or quote an XML
 * snippet. It only counts when it directly precedes an invocation token (the
 * real spill shape: `…body</decision>\n<parameter name="context">…`).
 */

// A STRONG token unambiguously signals an invocation leak on its own:
//   - <invoke …>  — the OPEN form's closing `>` is optional, so a trailer
//     truncated mid-tag (`…<invoke name="x"`, the real spill shape) is still
//     caught. The `>?` is confined to this form: a genuine spill only ever
//     truncates the open tag it is mid-emitting.
//   - </invoke> and <function_calls> / </function_calls> — these REQUIRE a
//     closing `>`. There is no real-leak scenario producing a bracket-less
//     `</invoke`/`<function_calls` followed by continuing prose, so demanding
//     the `>` avoids flagging prose that merely names the tag.
//   - <parameter … name=…> — the opening form requires a `name=` attribute, so
//     a lone `<parameter>` in prose is not flagged.
// Closing tags carry no attributes, so they match only `</invoke\s*>` /
// `</function_calls\s*>` — no `[^>]*` that could stretch across prose to reach
// a distant `>` (e.g. a later `<b>`). The open `<invoke` keeps an optional `>`
// to catch a mid-emission truncation, but its attribute run forbids `>` AND
// newlines so it cannot swallow following prose.
const STRONG_TOKEN = String.raw`<(?:[\w.-]+:)?invoke\b[^>\n]*>?|<\/(?:[\w.-]+:)?invoke\s*>|<(?:[\w.-]+:)?function_calls\b[^>\n]*>|<\/(?:[\w.-]+:)?function_calls\s*>|<(?:[\w.-]+:)?parameter\b[^>\n]*\bname\s*=`;

// A WEAK introducer — a stray field-closing tag (`</decision>`) or a bare
// `</parameter>` — appears in the real spill but ALSO in ordinary prose, so it
// only counts as a leak when it directly precedes (optional whitespace) a
// strong token. That preserves the ADR-28/29 shapes while letting prose that
// merely mentions `</title>` or `</parameter>` pass.
const WEAK_INTRODUCER = String.raw`<\/(?:[\w.-]+:)?(?:decision|context|rationale|consequences|title|parameter)>`;
const LEAK_RE = new RegExp(`(?:${WEAK_INTRODUCER}\\s*)?(?:${STRONG_TOKEN})`, 'i');

/**
 * True when `text` contains a tool-invocation markup leak.
 */
export function hasInvocationMarkup(text: string): boolean {
  return LEAK_RE.test(text);
}

/**
 * Returns `text` truncated at the start of a leaked invocation trailer, trimmed
 * of trailing whitespace. A clean body — including one that merely mentions a
 * field tag in prose — is returned unchanged, so legitimate content is never
 * cut. Use this to display legacy rows whose stored bytes still carry a leaked
 * trailer; it never mutates storage, only the rendered value.
 */
export function stripInvocationMarkup(text: string): string {
  const match = LEAK_RE.exec(text);
  if (match === null) return text;
  return text.slice(0, match.index).trimEnd();
}
