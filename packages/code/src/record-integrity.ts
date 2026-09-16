/**
 * What a READ says about the record it just served when that record does not chain —
 * one wording, and one place that holds it, for every door the product answers through.
 *
 * ## Why a read says anything at all
 *
 * It used to say nothing. Over a tree `mnema verify` exits 1 on — `seq gap: expected
 * 6, found 4`, which is what two sessions writing one tail at once used to leave —
 * `mnema search --kind decision` exited 0 with no word, and so did `mnema status`.
 * Every fact was there and every fact was served; the only thing missing was that the
 * record could no longer prove nothing had been inserted between them. A product
 * whose whole purpose is proof cannot hand somebody a broken proof in silence.
 *
 * ## Why it is a NOTICE and not a refusal
 *
 * Nothing is lost when a tail stops chaining, and that is not a consolation, it is the
 * shape of the damage: the entries are all on disk, all readable, all things somebody
 * wrote. Refusing the read would take a sound answer away over a broken proof, and the
 * exit stays zero for the same reason — the read DID answer, and ruling on the record
 * is a verb of its own. What changes is that nobody is left thinking the answer came
 * off an intact record.
 *
 * ## Why the words live HERE and not in either surface
 *
 * THIS MODULE USED TO BE `wiring/integrity.ts`, AND ITS OWN DOC SAID WHY IT BELONGED
 * THERE: *"IT LIVES IN THE WIRING, beside `verify.ts`, and not in `presentation/`,
 * because that is where the shape it copies lives."* That premise held for exactly as
 * long as the command line was the only reader told anything. It is false now: the MCP
 * serves the same record to an agent, the agent is this product's principal reader, and
 * a module under `wiring/` is one the MCP may not import — the dependency runs
 * surface-to-shared, never surface-to-surface. What falsified the premise is that the
 * notice got a SECOND door, which is the same thing that moved `record-framing.ts`,
 * `record-effect.ts` and `recorded-content.ts` out of both surfaces before it.
 *
 * What went with the move is only the WORDS. The `Line` form the command line prints
 * is still composed in `wiring/integrity.ts`, because the shape it copies — `verify`'s
 * issue line, out of `fact` and `onOneLine` — is still the wiring's. What that file no
 * longer holds is a sentence, so the two doors cannot come to say different things
 * about the same bytes.
 *
 * ## Where it goes, and in whose voice
 *
 * On the command line, to `err`, in the same shape `verify` gives an issue — `issue
 * [T1] <scope> <tail>#<seq>: <detail>` — because it IS that issue, reached by a
 * different road: the sentence comes from the chain's own rule (`linkBreakAt`), which
 * the verifier and the reader now both ask. A second wording here would be a second
 * opinion about the same bytes. The stream matters: `--json` consumers take stdout, and
 * a notice on stdout would corrupt the one output that surface promises is
 * machine-readable.
 *
 * Through the MCP, as its own text block BESIDE the payload ({@link linkBreakBlock}),
 * never inside it — the same division `withRunState` already draws for what a read says
 * about the connection. Beside and not behind a second call: a channel that states half
 * a fact and points at a tool for the rest has stated nothing (`record-framing.ts`
 * records the measurement), and `verify` is not reachable from the MCP at all, so
 * "call `verify`" would be a pointer at a door the agent does not have.
 */

import type { Scope } from '@mnema/core';
import { oneLine } from './one-line.js';

/**
 * A tail that does not chain, and which of the trees it is in.
 *
 * It is declared HERE, beside the words, rather than beside the reading that produces
 * it (`tree-sources.ts`, which re-exports it): the MCP asks that reading for the value
 * and this module for the sentence, and a type that lived with only one of them would
 * make the other import a surface's module to name its own argument.
 */
export interface ScopedLinkBreak {
  readonly scope: Scope;
  readonly tail: string;
  readonly seq: number;
  readonly detail: string;
}

/**
 * What a reader who has never met a chain has to be told once, however many tails
 * broke — that the facts are all still there, and that there is a verb whose job is to
 * say how far the damage goes.
 *
 * It is a constant rather than a line built in {@link linkBreakSentences} so that the
 * MCP's own closing sentence can be checked against it: the agent has no `verify`, so
 * its block ends differently, and "differently" is only assertable against the thing it
 * differs from.
 */
const STILL_ON_THE_TAIL =
  'the records above are all still on the tail — what broke is the proof that nothing ' +
  'was inserted between them.';

/** How a person at a terminal is sent to the verb that rules on the whole record. */
const ASK_VERIFY = '`mnema verify` says how far it reaches.';

/**
 * How an agent is told the same thing, and it names no verb.
 *
 * `verify` is not one of this server's tools, so pointing at it would point at a door
 * this reader cannot open. What it can do is say so to the person it is working with,
 * which is the one move available and therefore the one named.
 */
const TELL_SOMEBODY =
  'The person you are working with can run `mnema verify` to see how far it reaches.';

/** One issue line per broken tail, in the shape `verify` gives an issue. */
function issueLines(breaks: readonly ScopedLinkBreak[]): readonly string[] {
  // Every value here came out of the record, so every value goes through the collapse:
  // a tail name or a detail carrying a newline would turn one issue into two lines, and
  // the second would read as an issue about a tail nobody named.
  return breaks.map(
    (broken) =>
      `issue [T1] ${oneLine(broken.scope)} ${oneLine(broken.tail)}#${oneLine(String(broken.seq))}: ${oneLine(broken.detail)}`,
  );
}

/**
 * The sentences a read owes about the tails it served that do not chain — none at all
 * for a sound record, which is every record this product wrote on its own.
 *
 * The last sentence is not decoration. The ones before it say what is wrong with each
 * tail; a reader who has never met a chain needs to be told that the answer beside them
 * is still the facts, and that there is a verb whose job is to say how far the damage
 * goes. Told once, however many tails broke.
 */
export function linkBreakSentences(breaks: readonly ScopedLinkBreak[]): readonly string[] {
  if (breaks.length === 0) return [];
  return [...issueLines(breaks), `${STILL_ON_THE_TAIL} ${ASK_VERIFY}`];
}

/**
 * The same fact as the text block an MCP read carries beside its payload — empty when
 * nothing broke, so a caller can splice it in without a branch of its own.
 *
 * ONE BLOCK AND NOT ONE PER TAIL, because a tool result is a list of blocks and a
 * reader meeting four of them has met four things to weigh rather than one fact with
 * four parts. It opens by saying what it is about, which the command line does not have
 * to: there the notice sits above the verb the person typed, and here it arrives in a
 * transcript beside the answers of every other call.
 */
export function linkBreakBlock(breaks: readonly ScopedLinkBreak[]): readonly string[] {
  if (breaks.length === 0) return [];
  return [
    [
      'The record this answer came off does not chain, so its proof is broken:',
      ...issueLines(breaks),
      `${STILL_ON_THE_TAIL} ${TELL_SOMEBODY}`,
    ].join('\n'),
  ];
}

/**
 * The places that open the record and owe NO notice, each with the reason — because
 * "this one owes nothing" is a claim that has to be answerable.
 *
 * It is a table and not an absence for the reason `record-framing.ts`'s
 * `UNFRAMED_CHANNELS` is one: the guard
 * (`tests/the-broken-link-reaches-every-reader.test.ts`) walks the source for the two
 * ways this package opens a record — `withScopedCaches` and a bare
 * `ProjectionCache.open` — and a file that neither asks {@link linkBreakSentences}'s
 * source (`linkBreaksOf`) nor appears here is red. So a read added next year is
 * classified or it does not pass, and the classification is written down rather than
 * re-derived from the silence.
 *
 * THE KEY IS THE PATH UNDER `packages/code/src/`, because that is what the guard has to
 * read, and a name would have to be matched back to a file by a second rule.
 */
export const SERVES_NO_RECORD_CONTENT: { readonly [path: string]: string } = {
  'anchors.ts':
    'it resolves a typed prefix into the anchor the CALLER was handed, and answers ' +
    'nobody: the verbs that use it are themselves on the list that owes the notice, so ' +
    'a notice here would be the same fact said twice in one invocation',
  'pinned-run.ts':
    'it checks that the run `MNEMA_RUN` names exists before a write is allowed to cite ' +
    'it — an ARGUMENT being validated, not an answer being served, and what it hands ' +
    'back is a yes or a refusal about the caller’s own environment',
  'mcp/cache-registry.ts':
    'it opens the caches a connection keeps warm and serves nobody; the reads that ask ' +
    'it for one are what carry the fact (`sessionLinkBreaks`)',
};

/**
 * The MCP tools that serve no record content, with the reason — the same claim as
 * {@link SERVES_NO_RECORD_CONTENT}, asked of the other surface.
 *
 * ONE ENTRY, AND IT IS THERE BECAUSE OF A MEASUREMENT RATHER THAN AN OPINION.
 * `rules_before_an_edit` does not answer a caller: it answers the HOST, as a
 * `PreToolUse` hook, and the host's contract for that reply was measured against the
 * real binary (`measurements/mcp-tool-channel/`) — anything that is not the hook-reply
 * JSON is discarded in silence, with no error and nothing reaching the model. A notice
 * spliced into that reply would be read by nobody while being paid for on every edit of
 * every session. The same answer asked for rather than pushed is `governing_rules`, and
 * that one carries it.
 */
export const TOOLS_SERVING_NO_RECORD_CONTENT: { readonly [tool: string]: string } = {
  rules_before_an_edit:
    'its reply is a hook reply the HOST parses, not an answer a model reads: measured ' +
    'against the real binary, anything that is not the reply JSON is discarded in ' +
    'silence, so a notice here would reach nobody and be paid for on every edit',
};
