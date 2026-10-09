/**
 * What one hook of the host carries to a model, and the one rule this product cuts a text by
 * to stay inside it.
 *
 * THE CEILING IS THE HOST'S, AND IT IS MEASURED. Claude Code hands a command hook's
 * `additionalContext` to the model whole up to 10,000 characters, and over that it saves the
 * text to a file and hands over the path with a preview of the first 2,000 — without asking
 * the model to open the file (code.claude.com/docs/en/hooks, *JSON output*). Measured against
 * the real binary, 2.1.281, with the request it sends afterwards as the evidence: 10,000 arrives whole and 10,001 arrives as a path; the count
 * is the JavaScript string length — UTF-16 code units, so an astral character costs two — and
 * neither code points nor bytes; and each hook of one event is measured on its own, so the two
 * texts a session opens with have a ceiling each.
 *
 * WHERE IT BINDS, AND WHERE IT DOES NOT. It binds the two texts the plugin's `SessionStart`
 * handlers hand over, and only when they ask for it (`mnema brief --hook`, `mnema recall
 * --hook`). The same verbs without the flag print whole: `mnema brief > MNEMA.md` writes a file
 * whose bytes are compared with `diff`, and a file's reader has no ceiling anybody measured —
 * so a cut there would drop rules for a limit that is not there, and would make the staleness
 * check report a difference that is not the record's.
 *
 * AND IT BINDS THE PER-EDIT PUSH, which this paragraph said it did not. It read: "The per-edit
 * push rides a hook too and is not bound here; what it hands over is the rules addressed at ONE
 * path, and that is a different size question from a whole record's." The size question is
 * different, and it did not make the ceiling go away: measured on the same host, an `mcp_tool`
 * hook on `PreToolUse` has the same 10,000 units, inclusive, and the same file path past them
 * (the per-edit table; read once, not held by a file of this tree). The rules at one path rarely come near it,
 * and nothing held that they never would, so `edit-rules-push.ts` cuts by {@link fitWhole} too.
 *
 * WHY THE PRODUCT CUTS AND THE PLUGIN DOES NOT. The handler hands over byte for byte what the
 * verb prints (`plugin/hooks/hand-over.mjs`), and it is right to: cutting there would be a
 * second place deciding what a session is told, and it would have to parse markdown to find
 * where a rule ends. The composition knows where every item ends, so the cut is made where the
 * lines are built, and the declaration of it is made in the same place.
 *
 * ANOTHER HOST, ANOTHER UNIT. Codex measures a hook's text in tokens of four UTF-8 bytes,
 * 2,500 of them, and over that saves it to a file and hands over a preview with its MIDDLE cut —
 * so a text this module cut at 10,000 code units, which runs to more bytes than units wherever
 * a line carries `·` or `—`, arrived cut in the middle of a rule. The host table says the
 * ceiling of a host that has one of its own (`hookText`), and {@link hookCeilingOf} is the one
 * place it becomes a unit and a number; the verb is told the host by the command the plugin
 * generates for it (`--host`), never by guessing.
 */

/**
 * The most a hook's text may hold and still arrive as text, in the host's own unit — see
 * this module's header for the measurement.
 */
export const HOOK_TEXT_CEILING = 10_000;

/** The ceiling as a sentence prints it — derived, so no text spells the number a second time. */
export const HOOK_CEILING_IN_WORDS = HOOK_TEXT_CEILING.toLocaleString('en-US');

/**
 * What the handler puts between a verb's text and what the same run said about the record on
 * its second stream (`plugin/hooks/hand-over.mjs`, `BETWEEN_THE_STREAMS`) — part of the one
 * string the host measures, so part of what the room is taken from.
 */
const BETWEEN_THE_STREAMS = 2;

/**
 * How long lines are once printed — each followed by the newline `writeLines` ends it with —
 * counted the way the host counts.
 *
 * IT IS A LENGTH AND NOT A WIDTH, and that is why this module counts for itself where the rest
 * of the surface asks `width.ts`. A width is how many columns a terminal gives a line; the
 * ceiling is how many units of a JavaScript string the host keeps, measured on the binary, so
 * a wide glyph that takes two columns and one unit counts one here, and an astral character
 * that takes one column and two units counts two.
 */
export function printedLength(
  lines: readonly string[],
  lengthOf: (text: string) => number = unitsOf,
): number {
  return lines.reduce((sum, line) => sum + lengthOf(line) + 1, 0);
}

/** A text's length in UTF-16 code units — Claude Code's unit. */
function unitsOf(text: string): number {
  return text.length;
}

/** A text's length in UTF-8 bytes — the unit Codex's ceiling is a quarter of. */
function bytesOf(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * The ceiling one host puts on a hook's text: how many of its own units arrive whole, how a text
 * is measured in that unit, and how the declaration of a cut says it.
 */
export interface HookCeiling {
  /** The most a text may measure and still arrive whole. */
  readonly most: number;
  /** A text's length, in the unit of {@link most}; additive over the lines of a text. */
  readonly lengthOf: (text: string) => number;
  /**
   * The ceiling as the paragraph that declares a cut words it: a count of characters, or of
   * tokens of so many bytes — the words are the composer's, the numbers are these.
   */
  readonly said: { readonly count: number; readonly bytesPerToken?: number };
}

/** Claude Code's ceiling, and every host's that the host table names none for. */
export const CLAUDE_CODE_CEILING: HookCeiling = {
  most: HOOK_TEXT_CEILING,
  lengthOf: unitsOf,
  said: { count: HOOK_TEXT_CEILING },
};

/**
 * How many bytes this product keeps in hand under a ceiling counted in tokens of four bytes.
 *
 * MEASURED, AND IT IS ZERO. Codex 0.161.0 handed over whole a hook's text of exactly 10,000
 * UTF-8 bytes (2,500 of its tokens) and replaced one of 10,001 by a preview with its middle cut
 * and a file path (`tests/host-contract/codex-opens-and-refuses.codex.test.ts`). Its count is
 * `ceil(bytes / 4)` of the text the hook printed, nothing added; so `ceil(b / 4) <= most` is
 * `b <= 4 * most` exactly, and a margin would only drop a rule that fits. The case that holds the
 * boundary is the one that would go red the day the host counts differently.
 */
const TOKEN_MARGIN_BYTES = 0;

/**
 * The ceiling of a hook's text for a host whose row of the host table names one (`host-names.ts`,
 * `hookText`, read by the caller with `hookTextOf`), or Claude Code's where it names none.
 */
export function hookCeilingOf(
  hookText: { readonly tokens: number; readonly bytesPerToken: number } | undefined,
): HookCeiling {
  if (hookText === undefined) return CLAUDE_CODE_CEILING;
  const { tokens, bytesPerToken } = hookText;
  return {
    most: tokens * bytesPerToken - TOKEN_MARGIN_BYTES,
    lengthOf: bytesOf,
    said: { count: tokens, bytesPerToken },
  };
}

/**
 * How much of the ceiling a verb's text may take, once what the same run says on its second
 * stream has been set aside.
 *
 * The handler appends that second stream to the text, trimmed, with a blank line between, and
 * the host measures the result as ONE string — so a document that filled the ceiling alone
 * would cross it the day the record stopped chaining, which is the day its notice matters
 * most. The lines are the ones the verb writes there, as written.
 */
export function roomBeside(
  alsoSaid: readonly string[],
  ceiling: HookCeiling = CLAUDE_CODE_CEILING,
): number {
  if (alsoSaid.length === 0) return ceiling.most;
  const appended = alsoSaid.join('\n').trim();
  return ceiling.most - (ceiling.lengthOf(appended) + BETWEEN_THE_STREAMS);
}

/**
 * The composition of the most WHOLE items that fits in `room`, taken in the order the text
 * already prints them.
 *
 * `compose(shown)` is the whole text with its first `shown` items, and for `shown < total` it
 * is the text that SAYS it was cut — the declaration is part of what has to fit, so it is part
 * of what is measured. The full text is asked first, and when it fits it is returned as it is:
 * a record under the ceiling prints exactly the bytes it prints without one.
 *
 * NOTHING IS CUT IN THE MIDDLE, AND NOTHING IS REORDERED. An item is in or out, and what is out
 * is a tail of the order the text already has — so a reader told "the last ones in this order
 * are not here" is told the truth, and no shorter rule further down is promoted past a longer
 * one to fill a gap. The walk climbs from none, so it stops as soon as the next item would not
 * fit: the work is bounded by the ceiling, never by how large the record is.
 *
 * A text whose fixed part alone does not fit is returned with no item and its declaration,
 * which is the most this can do; it is not a state the texts this binds reach.
 */
export function fitWhole(
  total: number,
  room: number,
  compose: (shown: number) => string[],
  lengthOf: (text: string) => number = unitsOf,
): string[] {
  const whole = compose(total);
  if (printedLength(whole, lengthOf) <= room) return whole;
  let fitting = compose(0);
  for (let shown = 1; shown < total; shown += 1) {
    const next = compose(shown);
    if (printedLength(next, lengthOf) > room) break;
    fitting = next;
  }
  return fitting;
}
