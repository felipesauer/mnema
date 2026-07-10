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
 * real spill shape: `…body</decision>\n<parameter name="context">…`) OR another
 * field tag (the strong-token-less spill a knowledge tool produces:
 * `…body</content>\n<topics>[…]`). A single field tag mentioned in prose,
 * with no adjacent second field tag, still passes.
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
// `</function_calls\s*>` — no attribute run that could stretch across prose to
// reach a distant `>` (e.g. a later `<b>`). The open forms keep an attribute
// run, but it forbids `<`, `>` AND newlines: excluding `<` both bounds the run
// to a single tag and keeps matching LINEAR — a greedy `[^>]*` made the
// `parameter … name=` token backtrack O(n²) over a long run of `<parameter`
// near-misses (a ~280KB body took seconds). With `<` excluded, each candidate
// tag fails in O(1) locally.
const STRONG_TOKEN = String.raw`<(?:[\w.-]+:)?invoke\b[^<>\n]*>?|<\/(?:[\w.-]+:)?invoke\s*>|<(?:[\w.-]+:)?function_calls\b[^<>\n]*>|<\/(?:[\w.-]+:)?function_calls\s*>|<(?:[\w.-]+:)?parameter\b[^<>\n]*\bname\s*=`;

// The set of field tags an MCP tool spills — every argument name a knowledge
// tool accepts as free text. `content` and `topics` cover the observation /
// memory record shapes (`…body</content>\n<topics>[…]`), the rest cover the
// decision shapes. Shared by the weak introducer and the envelope-pair form.
const FIELD_TAG = String.raw`(?:decision|context|rationale|consequences|title|parameter|content|topics|observation|slug)`;

// A WEAK introducer — a stray field-closing tag (`</decision>`) or a bare
// `</parameter>` — appears in the real spill but ALSO in ordinary prose, so it
// only counts as a leak when it directly precedes (optional whitespace) a
// strong token. That preserves the ADR-28/29 shapes while letting prose that
// merely mentions `</title>` or `</parameter>` pass.
const WEAK_INTRODUCER = String.raw`<\/(?:[\w.-]+:)?${FIELD_TAG}>`;

// An ENVELOPE PAIR — a field-closing tag directly followed (optional
// whitespace) by another field tag, opening or closing — is a leak on its own.
// This is the multi-field spill shape a knowledge tool produces without any
// invoke/parameter strong token: `…body</content>\n<topics>[…]</topics>`. A
// single field tag in prose still passes (there is no adjacent second field
// tag), so mentioning `</title>` or `<decision>…</decision>.` is not flagged.
// No greedy run spans the two tags, so matching stays linear.
const ENVELOPE_PAIR = String.raw`<\/(?:[\w.-]+:)?${FIELD_TAG}>\s*<\/?(?:[\w.-]+:)?${FIELD_TAG}\b`;

const LEAK_RE = new RegExp(
  `(?:${ENVELOPE_PAIR})|(?:${WEAK_INTRODUCER}\\s*)?(?:${STRONG_TOKEN})`,
  'i',
);

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
