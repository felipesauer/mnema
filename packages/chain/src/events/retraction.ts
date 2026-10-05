/**
 * WHO MAY TAKE A NOTE BACK — the one place it is decided.
 *
 * A `note.retracted` takes a memory or an observation out of what the record serves. Only the
 * IDENTITY that wrote the note may do that: the retraction's `who` is the note's `who`. The
 * identity is the anchor and not the key, so any key of it — a second machine enrolled into it,
 * a cold backup restored — retracts, and a key of another identity does not.
 *
 * Asked from three sides, and they cannot disagree because they ask this: the write refuses a
 * retraction it would answer `false` for; the read does not apply one it answers `false` for;
 * `verify` lists each one it answers `false` for in its census, informational, because the
 * event is intact and what fails is its authority over the note (FORMAT.md §6.4).
 *
 * The comparison is on `who` alone because §6.2 already answers whether the event's key may
 * speak for its `who`: an event whose key is not in its anchor's set is a break, not a
 * retraction by that anchor.
 */
export function mayRetract(noteWho: string, retractorWho: string): boolean {
  return noteWho === retractorWho;
}
