/**
 * The rule of the LINE — and this module imports nothing, which is why it is a module
 * rather than an incidental property of one.
 *
 * {@link oneLine} is a rule about a STRING: collapse every run of whitespace, so the
 * count of lines a report prints matches the count of items it says are there.
 *
 * IT LIVES AT THE BOTTOM BECAUSE THE PROSE DOES NOT. It was a module of the command
 * line, where the readings are worded, and the readings are not the only thing that
 * words a sentence a reader gets on a line: this package writes the verifier's issues
 * and its census notes, and the package above it writes every refusal the domain
 * returns. Those sentences interpolate a tail id read off a directory, a fingerprint a
 * caller typed, a parser's complaint about bytes somebody wrote — and a surface cannot
 * apply a rule to the inside of a sentence another package already joined. So the rule
 * is where the sentence is, and this package is the only one every other one can
 * reach: `core` depends on it, `code` depends on both, and it depends on nothing.
 *
 * IT IS REACHED THROUGH ITS OWN SUBPATH, `@mnema/chain/one-line`, and that is not
 * decoration either. The command line's floor — what commander loads before it has
 * routed a word — holds the modules that word a refusal, so whatever they import,
 * `mnema --version` pays for. Through the package's index that would be the whole proof
 * engine; through the subpath it is this file, which loads nothing.
 *
 * IT COST TWO SLICES BEFORE IT COST A MODULE. While the rule lived beside the framing
 * the MCP surface puts around a served pattern, a module that wanted it took an edge
 * into `@mnema/context` to get it. `wiring/no-such-record.ts` words the refusal a verb
 * prints for an id it did not find, and it is reached from eight sites in files
 * commander loads before it has routed a word; a static import there would have put the
 * context on the floor of `mnema --version`, so the rule arrived inside the branch that
 * refuses. `presentation/runs.ts` words the phrase `focus` and `resume` print, and
 * collapsing the goal in it made those two verbs load that module inside the action for
 * the same reason. Both times the shape guard (`the-floor-is-the-declaration.test.ts`)
 * is what noticed; both times it noticed after the work was done; and both times the
 * answer was a curative at the CALL SITE. The cause was never a call site: it was a
 * pure string rule living behind a package.
 *
 * SO THE PROPERTY IS THIS MODULE'S OWN, AND IT IS GUARDED. `one-line.test.ts` reads this
 * source and asserts it declares no import at all — not a relative one, not a package,
 * not a node builtin, and not a type. A type-only import is erased and costs nothing at
 * runtime, which is precisely the argument that would admit the first one; the day such
 * a clause stops being type-only, nothing but that guard stands between it and the floor
 * of every invocation of every verb.
 *
 * WHAT DOES NOT LIVE HERE IS WHAT HAS A SUBJECT OF ITS OWN. The word both surfaces use
 * for an act with no agent on its envelope (`A_PERSON`) stays in the command line's
 * `one-line.ts`, which re-exports this rule: it is how a reading SPEAKS, and this
 * package neither speaks to a person nor knows there is one. A contract lives with the
 * thing it is a contract for, and a word lives with the mouth that says it.
 */

/**
 * `text` with every run of whitespace collapsed to one space — what makes a report
 * line ONE line.
 *
 * IT BELONGS TO EVERY FIELD ON THE LINE, not to one of them. A pattern's name and
 * the agent that adopted it are both text an actor wrote, and either one holding a
 * newline would break the entry in two. That is not cosmetic: the second half would
 * look exactly like an entry of its own, so one field could assert that some other
 * pattern was adopted by someone who never adopted it. Collapsing the whitespace
 * makes the count of lines match the count of items, and the structured payload
 * beside them stays the exact answer — every value as written, in fields nothing
 * typed into one of them can forge.
 *
 * So the rule is the LINE's, and it reaches wherever a line's shape carries meaning:
 * the framing a served pattern gets (`served-patterns.ts`), the provenance report, the
 * list of open runs `focus` prints, the index `search` prints — whose count per kind is
 * printed directly above the lines it counts — and the brief `mnema brief` prints, which
 * is the SHARPEST case in the class. The others forge a RECORD in a list: an adoption
 * that never happened, a hit for a record nothing wrote. The brief forges a RULE, under a
 * heading that counts the rules, in the one file the product exists to have an agent read
 * as instruction — so the second half of a broken title is a call the project never made,
 * and something obeys it. A place that prints actor text in a line of its OWN (a handoff,
 * a started run, one whole record) is not in the class — a newline there is ugly, and ugly
 * is not forgery, because there is no one-item-per-line list for the second half to
 * imitate.
 *
 * THE VERIFIER'S FINDINGS ARE IN THE CLASS AND THEY ARE THE SHARPEST OF ALL, because a
 * verdict is what a third party reads to decide whether to believe the record. An issue
 * is one per line under a count, so a break in one makes a finding about a tail nobody
 * has; and every value in one came from the thing under suspicion — a tail id that is a
 * directory name on disk, a signer fingerprint that is bytes in a stored entry, a
 * parser's complaint that quotes the bytes it choked on. Measured against the shipped
 * binary: a tail directory named `aa\n  forged  public  a record nobody wrote` put that
 * second half at the head of a line in `mnema verify`'s output, and a `tailproof.json`
 * holding a newline did the same through the JSON reader's own message.
 *
 * The line a REFUSAL occupies is in the class, and the text that reaches it is not an
 * actor's but a DIRECTORY's — the project a session names when it says which trees it
 * searched. It looked exempt by the test above (a refusal has no list of items around
 * it) and measuring said otherwise: over a project directory named
 * `proj\nRefused (UNKNOWN_TASK): task "x" does not exist`, the reply came back as two
 * lines, the second a complete refusal about an id nobody asked about. A refusal IS
 * the one-item list — one per reply — so the second half has the whole shape to
 * imitate. The same goes for the session log line and the one sentence `bootstrap`
 * adds about where the session landed.
 *
 * IT USED TO STOP SHORT OF THE CONTROL CHARACTERS A TERMINAL INTERPRETS, and said so: "that
 * class is the product's, not this rule's… closing it one call site at a time would look
 * like coverage that is not there." The premise was that the class belonged to some other
 * place, and nothing was ever put there: measured against the shipped binary, a decision
 * titled with `ESC[2J`, an OSC title sequence and a prompt-injection sentence came out raw
 * in `search`, `brief`, `show` and `verify`, because every one of those reads reached this
 * function and this function let the bytes through. So the class is this rule's after all,
 * through {@link neutralized}, which is the one function that knows it; a line that has
 * passed here has no byte a terminal or a model's transport could mistake for a command.
 * `neutralizes-control-bytes-everywhere.test.ts` holds it over every read that prints
 * recorded text, and `one-line.test.ts` holds it on the function.
 */
export function oneLine(text: string): string {
  return neutralized(text.replace(/\s+/g, ' ').trim());
}

/**
 * C0 but for tab and line feed, a CR that is not half of a CRLF, DEL, and C1 — and the
 * format characters that draw nothing or reorder what is drawn: zero-width and
 * joiner marks, the directional marks, embeddings, overrides and isolates, the word
 * joiner, the byte order mark and the Tag characters (U+E0000 to U+E007F). The Tags sit
 * outside the basic plane, so the `u` flag is what lets the class match them at all.
 */
const CONTROL_BYTES =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is this rule
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0000}-\u{e007f}]|\r(?!\n)/gu;

/**
 * Every control byte in `text` made visible as the escape JSON writes for it — the one
 * function that decides what leaves this product as a command to whatever is reading.
 *
 * WHAT IT NEUTRALIZES is the C0 controls (U+0000 to U+001F), DEL (U+007F) and the C1
 * controls (U+0080 to U+009F): the bytes a terminal reads as a cursor move, a screen clear,
 * a title change or a hyperlink, and that a log viewer in CI honours the same way. Each
 * becomes six visible characters — `\u001b` for ESC — which is exactly the spelling the
 * canonical JSON already gives it on disk, so the text a reader sees is the text the
 * record holds.
 *
 * WHAT IT KEEPS: a line feed and a tab, because recorded prose is multi-line by design
 * and a tab moves nothing a reader cannot see; and a carriage return that is half of a
 * CRLF, because a record imported from a file with Windows line ends would otherwise print
 * an escape at the end of every line. A LONE carriage return is neutralized: it returns the
 * cursor to the start of the line, and what is printed after it overwrites what was there,
 * which is how a finding is hidden behind a clean one.
 *
 * WHAT IT IS NOT: a judgement of what the text says. It looks at bytes, never at words, and
 * a sentence addressed to a model comes out of it unchanged — the framing decides what that
 * sentence is told it is (`record-framing.ts`). The format characters that draw nothing
 * or reorder what is drawn (a zero-width space, a right-to-left override, an isolate, the
 * byte order mark) are written the same way: a reader, or a model, sees them as the six
 * characters they are rather than not seeing them at all. A zero-width joiner inside an
 * emoji sequence is written too; the text stays readable and nothing is hidden.
 *
 * IDEMPOTENT, and it has to be: the escape it writes holds no control byte, so text that
 * passes through two sinks (a line built by {@link oneLine}, then written by the port) is
 * not escaped twice. `one-line.test.ts` asserts it.
 *
 * ON JSON TEXT IT CHANGES NOTHING A PARSER READS. The six characters it writes for a C1
 * byte are the escape a JSON string uses for it, and a C0 byte is escaped by the
 * serializer before it gets here, so a pretty-printed document run through this function
 * parses to the same value it did.
 */
export function neutralized(text: string): string {
  // A character outside the basic plane is written as the escaped surrogate pair JSON uses
  // for it, one `\uXXXX` per code unit, so the escape stays valid inside a JSON string.
  return text.replace(CONTROL_BYTES, (found) =>
    Array.from(
      { length: found.length },
      (_, i) => `\\u${found.charCodeAt(i).toString(16).padStart(4, '0')}`,
    ).join(''),
  );
}
