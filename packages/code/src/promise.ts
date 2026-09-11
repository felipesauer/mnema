/**
 * WHAT THIS PRODUCT PROMISES — one sentence, and every door says the same one.
 *
 * The sentence lives here because it was measured to live in NINE places at once: the
 * npm manifest of the published package, the `--help` of the binary, the golden that
 * pins that help, a second manifest, and the opening of four READMEs. Nothing held them
 * together. Eight could be rewritten and one left behind, and the one left behind is the
 * one the world reads — which is how a claim the product's own README spent forty lines
 * refuting stayed on the npm page and in `mnema --help` for the whole life of the alpha.
 *
 * THE SENTENCE IS NOT THIS FILE'S TO CHOOSE. It was decided outside the code, on a study
 * of what the record actually does, and each half of it is bought by a measurement:
 * `verify` reads events and public keys with no private key and no network, and a second
 * reader written from `FORMAT.md` in dependency-free Python reaches the same verdict
 * without importing any of this. What it deliberately does NOT promise is identity, time,
 * or that nothing was removed — a record forged whole, with `.mnema` deleted and refounded
 * under another key, verifies clean and word for word like an honest one, and so does a
 * tail deleted together with its key. `packages/code/README.md` carries that argument in
 * full under "What it proves — and what it does not", and this sentence is the short form
 * of it rather than a stronger claim placed on top of it.
 *
 * THE CAVEAT IS HALF THE PROMISE, NOT A FOOTNOTE, which is why it is a constant here and
 * not prose somebody remembers to repeat. A door that carries only {@link PRODUCT_PROMISE}
 * carries no claim the caveat would have to walk back; a door with room for both carries
 * both. The rule is that no door may claim MORE than these two strings claim — shortening
 * is allowed, adding is not.
 *
 * WHAT ASSERTS IT: `tests/the-sentence-reaches-every-door.test.ts` reads every door off
 * the disk and compares, so eight-of-nine reddens; it also bans the clauses the study
 * falsified, reconciled against a declared list of the places that mention them for a
 * reason. `cli.help.golden.txt` pins the bytes commander prints.
 */

/**
 * The promise, first line: what the product is, for whom, and where it lives.
 *
 * Verbatim on every door. A door with room for one line carries this one.
 */
export const PRODUCT_PROMISE =
  'A signed, append-only record of the decisions behind AI-agent work — the decision, the reasoning, and who wrote it down, in the repository where the work happens.';

/**
 * The promise, second line: the limit, stated in the promise rather than under it.
 *
 * Verbatim from `packages/code/README.md`, where it was already written and already
 * true while the manifests said otherwise. A door with room for two lines carries both.
 */
export const PRODUCT_PROMISE_CAVEAT =
  'Tamper-evident, not tamper-proof: what is still in the record has not changed since it was signed, and a stranger can check that without your keys and without installing this.';
