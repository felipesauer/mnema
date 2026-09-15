/**
 * The word this product says a PROVENANCE with — one string, for every channel that
 * puts one on a line.
 *
 * ## What the word is for, and the defect that made it one place instead of four
 *
 * `mnema decision import` freezes its own `ADR-<n>` into each decision it reads, so a
 * file named `ADR-008` becomes `ADR-2` in the record. That is deliberate and stays: two
 * projects can each hold an ADR-1, and a label re-derived on read would silently cite a
 * different decision. What it costs is that the label stops naming the file. Measured on
 * a real project of 247 imported decisions: 241 of the labels name a different file from
 * the one they came from, and five of the six the committed document printed were among
 * them.
 *
 * The record already holds the answer — the `derived-from` edge the import wrote, whose
 * target carries the source's own number inside it — and three reads that serve one
 * record whole were taught to carry it. The channels that arrive UNASKED were not, and
 * they are the ones with a reader who never chose to read: the committed document, the
 * rules pushed as a file is about to be written, and the charge that stops a write. They
 * carry it now, which makes four printers of one fact.
 *
 * ## Why a constant and not a function that builds the phrase
 *
 * The collapse ({@link oneLine}) stays at each site, inside each template, and this file
 * holds the WORD alone. A helper returning `derived from <target>` would read better and
 * would take the collapse out of the layer the line rule is guarded over — measured in
 * this repository before: a value collapsed behind a helper is a value the scanner of
 * `presentation/` cannot see, and the guard goes quietly blind on the site it was written
 * for. So the sharing stops exactly where the guard's sight would end.
 *
 * `the-citation-that-arrives-opens.test.ts` walks the printers and fails on one that
 * spells the phrase by hand.
 */

/**
 * How a record's provenance is introduced, on every surface that prints one.
 *
 * It is the RELATION's own sense in the product's words — `derived-from` is what the
 * link asserts — and it is the same on a terminal, in a committed file and in a text
 * pushed at a model, because a reader who meets it in two of those must not have to work
 * out that they are one fact.
 *
 * WHAT FOLLOWS IT IS A TARGET AND NOT A PATH. `derived-from` takes an id as readily as a
 * file name, and the command line's own golden held a task derived from another task
 * before any of this shipped. No printer of it checks that it resolves and none touches a
 * disk: `mnema refs` is the read that says whether a target lands, and the document this
 * word reaches has to be a pure function of the record.
 */
export const DERIVED_FROM = 'derived from';
