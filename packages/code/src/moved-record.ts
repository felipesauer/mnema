/**
 * How the echo of a MOVE names the record it moved — one line, one place, both
 * surfaces.
 *
 * A move's confirmation is the acknowledgement of a signed write, which makes it the
 * worst line in the product to be ambiguous. It used to name the record by its
 * DISPLAY alone:
 *
 *     Decision ADR-1 → accepted
 *
 * and none of the three displays is an identity. An `ADR-<n>` label is minted within
 * ONE chain, so a record built from several trees carries a public `ADR-1` beside a
 * private one and that line names two rules. A pattern's name has no uniqueness
 * constraint of any kind — two patterns may share one, and nothing refuses it. A
 * task's alias is a four-hex hash of the id, display by construction, and two ids can
 * share it. So the line above, read on its own — in a scrollback, in a transcript, in
 * a review comment — could be the acknowledgement of either of two writes, and
 * nothing in it says which.
 *
 * THE LINE CARRIES THE DISPLAY *AND* THE ID. Not one or the other: the display is
 * what a person recognizes, and the id is what they can act on — `mnema show`,
 * `search`, `read_record`, a citation someone else can follow. Both fit, so trading
 * legibility for precision would be a trade nobody had to make. It is the same pair
 * every BIRTH echo has always printed (`Created task t-4f2a (0198…)`), which is why
 * the id is written WHOLE here: the product has one short form, it is the anchor's
 * (see `anchors.ts`), and it is a PREFIX of a value whose characters are already a
 * hash. An entity id is a v7 UUID whose leading characters are a timestamp, so a
 * prefix of one is not spread and would clash on sight between ids minted close
 * together — which is the whole reason `deriveAlias` HASHES instead. Shortening an id
 * by prefix would be a second convention that the input side could not honor.
 *
 * ONE PLACE BUILDS IT, for the two surfaces and the three kinds. It was six template
 * literals — three verbs times two surfaces — which is the shape that drifts the day
 * somebody amends one copy. {@link MOVED_FORM} is TOTAL over {@link MovedKind}, so a
 * fourth entity with a workflow cannot reach a surface without saying how its move
 * reads.
 *
 * EVERY FIELD THE RECORD PUT ON THE LINE IS COLLAPSED TO ONE LINE. The rule is the
 * LINE's, not one field's (see `oneLine` in `one-line.ts`): a move echo is a
 * one-item list — one per reply — so a break in it gives the second half the whole
 * shape to imitate, and the second half of a pattern's name would read as the
 * acknowledgement of a move nobody made. The destination is the one field that needs
 * none: it is the gate's own closed vocabulary, resolved by the workflow rather than
 * written by an actor.
 */

import type { UpcasterRegistry } from '@mnema/chain';
import { orderedEvents, projectDecisions, projectSkills } from '@mnema/core';
import { oneLine } from './one-line.js';

/** The three entities a workflow moves, and whose move a surface echoes. */
export type MovedKind = 'task' | 'decision' | 'skill';

/** How one kind's move reads: the word it opens with, and how its display is written. */
interface MovedForm {
  /** The word the line opens with — the kind, as a reader names it. */
  readonly label: string;
  /**
   * Whether the display is DELIMITED by quotes.
   *
   * True for a display an ACTOR wrote, which is a value that may hold a space and
   * therefore needs an end: a pattern's name. False for the two the product mints
   * (`t-4f2a`, `ADR-7`), where quotes would only add noise to a value that cannot
   * run into what follows it. The straight quote is the one the birth echo of the
   * same entity already uses, and the pair reads as a pair.
   */
  readonly delimited: boolean;
}

/**
 * Every kind's form, TOTAL — a fourth workflow entity does not compile until its move
 * has a line.
 */
const MOVED_FORM: Readonly<Record<MovedKind, MovedForm>> = {
  task: { label: 'Task', delimited: false },
  decision: { label: 'Decision', delimited: false },
  skill: { label: 'Skill', delimited: true },
};

/**
 * The one line a move's echo is: the kind, the display, the id, and where it landed.
 *
 * Both surfaces call it and neither writes it. The CLI hands it to a stream and the
 * MCP tool returns it in a text block; that is the only difference between them, and
 * it is the difference the transports are for.
 */
export function movedLine(kind: MovedKind, display: string, id: string, to: string): string {
  const form = MOVED_FORM[kind];
  const named = form.delimited ? `"${oneLine(display)}"` : oneLine(display);
  return `${form.label} ${named} (${oneLine(id)}) → ${to}`;
}

/**
 * The kinds whose display is READ OUT OF THE RECORD rather than derived from the id.
 *
 * A task's alias is `deriveAlias(id)` — pure, no chain, and it cannot be absent. The
 * other two have a display the record holds (the frozen `ADR-<n>`, the pattern's
 * name), which is a lookup that can come back empty, and that is what
 * {@link movedDisplay} answers for. Written as an exclusion so the two sets cannot
 * come apart: a fourth kind is either derived or projected, and it has to be one of
 * them here.
 */
export type ProjectedDisplayKind = Exclude<MovedKind, 'task'>;

/** Where each projected display is read from, keyed by kind — TOTAL over the set. */
const PROJECTED_DISPLAY: Readonly<
  Record<ProjectedDisplayKind, (root: string, id: string, upcasters: UpcasterRegistry) => string>
> = {
  decision: (root, id, upcasters) =>
    projectDecisions(orderedEvents({ root }, upcasters)).get(id)?.adr ?? id,
  skill: (root, id, upcasters) =>
    projectSkills(orderedEvents({ root }, upcasters)).get(id)?.name ?? id,
};

/**
 * The display the record holds for a moved entity, or its ID when the record holds
 * none.
 *
 * FALLING BACK TO THE ID IS THE ANSWER, not a safety net: with no display, the id is
 * the best name there is, and it is the name every other read of the product already
 * prints. What it must never do is name the record `undefined`, which is what a
 * template over an absent lookup writes.
 *
 * `root` is the chain the entity was LOCATED in, which is not necessarily one of the
 * asking session's own trees: an entity in a sibling project of the workspace is
 * moved where it lives, and deriving the root from the session instead would read this
 * project's tree for a record that is in another one — answering with a stranger's
 * label, or with the raw id, for a move that succeeded.
 *
 * It is read AFTER the append, so the display reflects the move that just landed.
 *
 * When the fallback fires the line names the record twice, with the same value in the
 * display slot and in the id slot. That is deliberate over suppressing one of them:
 * the parenthesized slot is what tells a reader WHICH value is the id, and a line that
 * silently drops it when the two agree would leave `Skill "0198…" → adopted` reading
 * as a pattern whose NAME is a UUID.
 */
export function movedDisplay(
  kind: ProjectedDisplayKind,
  root: string,
  id: string,
  upcasters: UpcasterRegistry,
): string {
  return PROJECTED_DISPLAY[kind](root, id, upcasters);
}
