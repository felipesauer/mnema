/**
 * What a recorded decision OFFERS beside its acknowledgement: where it could be addressed and
 * which decision it could replace. It does neither.
 *
 * WHY THE WRITE SAYS IT. Measured on 27 October over 48 sessions: the 40 decisions an agent
 * recorded carried no `governs` address, and one session left a draft and its refinement in
 * force together, in contradiction, because nothing at the moment of writing said the first
 * could be replaced. The two facts the agent needs are in the reply of the call it just
 * made, which is the one place it reads. Neither is recorded here: an edge or a transition
 * nobody asked for would be the record holding what nobody decided, so each offer says what
 * was seen, says that nothing was moved, and names the call that would do it.
 *
 * ONE DETECTION, TWO DOORS. `mnema decision record` (the command line) and `record_decision`
 * (the MCP tool) both ask {@link decisionsCited}, so the two cannot disagree about which
 * decisions a new one cites; `the-offers-are-one-function.test.ts` holds that no door reads
 * the citations a second way. They differ in one thing only, the shape of the call they name
 * ({@link supersedeOfferLines}).
 *
 * WHAT COUNTS AS CITED: a full decision id (the 8-4-4-4-12 shape every id has), or an
 * `ADR-<n>` label, in the title, the rationale or the alternatives. A label names every
 * decision that carries it in the trees in view: two trees number their own, so one label can
 * be several decisions, and each is listed with its id.
 *
 * WHICH TREES ARE IN VIEW, and the rule is a privacy one ({@link readableFrom}): a decision
 * that lands in the PUBLIC tree sees only public trees, because its reply may be quoted into a
 * record that travels, and a title read out of a private tree must not be put in reach of one.
 * A private decision sees the public trees as well. The offer never names a rationale: the
 * label, the title, the state and the id, which is what `read_record` opens the rest by.
 *
 * WHICH STATES: only where a `supersede` is a legal move (`findDecisionTransition`, the table
 * the gate itself reads), so a rejected or already superseded decision is never offered, and
 * neither is the decision just recorded.
 */

import {
  type DecisionProjection,
  findDecisionTransition,
  isDecisionState,
  type Scope,
} from '@mnema/core';
import { oneLine } from './one-line.js';

/** A decision a new one cites, and could replace: all the offer says about it. */
export interface SupersedeOffer {
  readonly id: string;
  readonly adr: string;
  readonly title: string;
  readonly state: string;
}

/** How many decisions an offer names before it counts the rest: a reply is not a list of a record. */
export const MOST_OFFERS_NAMED = 5;

/** How many paths an address offer names: the most recent ones, and how many were left out. */
export const MOST_PATHS_NAMED = 10;

/** The text of a decision as it is written, the three places a citation can be. */
export interface DecisionText {
  readonly title: string;
  readonly rationale: string;
  readonly alternatives?: string;
}

const AN_ID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const A_LABEL = /\bADR-(\d+)\b/gi;

/**
 * The trees a decision landing in `landing` may name another decision out of. Public sees public;
 * private sees both of the project's trees; global sees only global, which belongs to no project.
 */
export function readableFrom(landing: Scope): readonly Scope[] {
  if (landing === 'public') return ['public'];
  if (landing === 'private') return ['public', 'private'];
  return ['global'];
}

/** The decisions of the trees a decision landing in `landing` may read, from sources of any trees. */
export function decisionsInView<T extends { readonly scope: Scope }>(
  sources: readonly T[],
  landing: Scope,
  listDecisions: (source: T) => readonly DecisionProjection[],
): DecisionProjection[] {
  const readable = readableFrom(landing);
  return sources
    .filter((source) => readable.includes(source.scope))
    .flatMap((source) => listDecisions(source));
}

/**
 * The decisions `text` cites among `held`, in the order they are first cited, that a decision
 * with id `self` could replace. Pure: the doors choose `held` ({@link decisionsInView}).
 */
export function decisionsCited(
  text: DecisionText,
  held: readonly DecisionProjection[],
  self: string,
): SupersedeOffer[] {
  const written = [text.title, text.rationale, text.alternatives ?? ''].join('\n');
  const cites: { at: number; matches: (decision: DecisionProjection) => boolean }[] = [];
  for (const found of written.matchAll(AN_ID)) {
    const id = found[0].toLowerCase();
    cites.push({ at: found.index, matches: (decision) => decision.id.toLowerCase() === id });
  }
  for (const found of written.matchAll(A_LABEL)) {
    const label = `ADR-${found[1]}`;
    cites.push({ at: found.index, matches: (decision) => decision.adr === label });
  }
  cites.sort((a, b) => a.at - b.at);
  const offers = new Map<string, SupersedeOffer>();
  for (const cite of cites) {
    for (const decision of held) {
      if (decision.id === self || offers.has(decision.id)) continue;
      if (!cite.matches(decision)) continue;
      if (!isDecisionState(decision.state)) continue;
      if (findDecisionTransition(decision.state, 'supersede') === undefined) continue;
      offers.set(decision.id, {
        id: decision.id,
        adr: decision.adr,
        title: decision.title,
        state: decision.state,
      });
    }
  }
  return [...offers.values()];
}

/** The two doors name the same move in their own shape. */
export type OfferedBy = 'mcp' | 'cli';

/**
 * The lines the offer to replace owes: what the new decision cites, that nothing was moved, and
 * the call that would replace each. None when it cites nothing that could be replaced.
 */
export function supersedeOfferLines(
  offers: readonly SupersedeOffer[],
  recorded: { readonly id: string; readonly adr: string },
  by: OfferedBy,
): string[] {
  if (offers.length === 0) return [];
  const named = offers.slice(0, MOST_OFFERS_NAMED);
  const lines = [
    `${recorded.adr} cites ${offers.length === 1 ? 'a decision' : `${offers.length} decisions`} that a supersede could replace. Nothing was moved:`,
  ];
  for (const offer of named) {
    lines.push(
      `  ${offer.adr} "${oneLine(offer.title)}" (${offer.state}, ${offer.id}): ${
        by === 'mcp'
          ? `decision_transition with id "${offer.id}", action "supersede", by "${recorded.id}", reason "<why>"`
          : `mnema decision supersede ${offer.id} ${recorded.id} --reason "<why>"`
      }`,
    );
  }
  if (offers.length > named.length) {
    lines.push(`  and ${offers.length - named.length} more cited, not listed.`);
  }
  return lines;
}

/**
 * The lines the offer of an address owes: the paths this connection looked at, that nothing was
 * linked, and the call that would address the decision at the most recent of them. None when the
 * connection looked at no path of the project.
 */
export function addressOfferLines(
  paths: readonly string[],
  recorded: { readonly id: string; readonly adr: string },
  scope: Scope,
): string[] {
  const [latest] = paths;
  if (latest === undefined) return [];
  const named = paths.slice(0, MOST_PATHS_NAMED);
  const left = paths.length - named.length;
  const where = scope === 'public' ? '' : `, scope "${scope}"`;
  return [
    `Paths of this project this connection looked at, the latest first: ${named.map((path) => oneLine(path)).join(', ')}${left > 0 ? `, and ${left} more` : ''}. ${recorded.adr} is addressed at none of them; nothing was linked:`,
    `  link_knowledge with subject "${recorded.id}", rel "governs", target "${oneLine(latest)}"${where}`,
  ];
}
