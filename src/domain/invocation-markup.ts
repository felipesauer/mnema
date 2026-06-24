/**
 * Guards against tool-invocation markup leaking into free-text fields.
 *
 * When an agent records an ADR (or any text field) via an MCP tool, a
 * malformed tool call can spill the invocation's own XML — `<parameter
 * name="...">`, `</invoke>`, or a stray closing tag for the field it was
 * filling (`</decision>`) — into the VALUE of a parameter. The persisted text
 * then ends with a garbage trailer and the sibling fields it was meant to fill
 * arrive empty.
 *
 * These markers do not occur in ordinary ADR prose, so we can both reject them
 * on write and strip them on read of already-persisted rows (the audit chain is
 * immutable, so legacy rows are cleaned at display time, never in storage).
 */

// Markers that only appear when tool-invocation XML has leaked in:
//   <invoke ...>            </invoke>
//   <parameter name="...">  </parameter>
//   a stray field-closing tag for a known ADR text field, e.g. </decision>.
// Case-insensitive; matches an opening or closing form of each.
const INVOCATION_MARKUP_RE =
  /<\/?(?:invoke|parameter)\b|<\/(?:decision|context|rationale|consequences|title)>/i;

/**
 * True when `text` contains tool-invocation markup.
 */
export function hasInvocationMarkup(text: string): boolean {
  return INVOCATION_MARKUP_RE.test(text);
}

/**
 * Returns `text` truncated at the first tool-invocation marker, trimmed of
 * trailing whitespace. A clean body is returned unchanged. Use this to display
 * legacy rows whose stored bytes still carry a leaked trailer — it never
 * mutates storage, only the rendered value.
 */
export function stripInvocationMarkup(text: string): string {
  const match = INVOCATION_MARKUP_RE.exec(text);
  if (match === null) return text;
  return text.slice(0, match.index).trimEnd();
}
