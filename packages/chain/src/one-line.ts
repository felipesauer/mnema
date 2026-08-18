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
 * into `@mnema/copilot` to get it. `wiring/no-such-record.ts` words the refusal a verb
 * prints for an id it did not find, and it is reached from eight sites in files
 * commander loads before it has routed a word; a static import there would have put the
 * copilot on the floor of `mnema --version`, so the rule arrived inside the branch that
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
 * It does NOT reach the control characters a terminal interprets — an ANSI escape,
 * or U+0085 NEL, which is not `\s` and stays. That class is the product's, not this
 * rule's: every read that prints recorded text is exposed to it, and closing it
 * one call site at a time would look like coverage that is not there.
 */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
