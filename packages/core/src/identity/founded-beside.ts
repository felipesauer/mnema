/**
 * An identity founded where others already were: read off the record, and nowhere else.
 *
 * A write that finds no anchor for its key in a tree founds one (`ensureFounded`), and that is
 * right twice over: the first person in a new project, and a person new to a team's project.
 * It is also what happens, in silence, when one person arrives under a second key: another
 * machine that wrote before it was enrolled, a key lost and minted again, a key root a launcher
 * moved. The record cannot tell those apart, and does not need to: all of them are one fact, an
 * `identity.founded` appended after another identity's. What this module answers is that fact,
 * derived from the events the format has always carried, so every surface that says it (at the
 * moment of the write, or when someone asks later) says the same thing about the same record.
 *
 * It never decides anything about the founding. It reads.
 */

import { resolve } from 'node:path';
import type { CatalogEvent, UpcasterRegistry } from '@mnema/chain';
import { orderedEvents } from '../projections/order.js';

/** An identity whose founding the record shows after other identities had been founded there. */
export interface FoundedBeside {
  /** The identity that was founded. */
  readonly anchor: string;
  /** The key that founded it. */
  readonly foundingFp: string;
  /** When, as the founding carries it. */
  readonly at: string;
  /** The identities already founded in the tree when it was, in the order the record has them. */
  readonly besides: readonly string[];
}

/**
 * Every identity founded beside others, in record order.
 *
 * The first founding of a tree is beside nothing and is not returned; each later one is, with
 * every identity founded before it. An anchor founded twice counts once, at its first founding.
 *
 * THIS SAID NO WRITE PATH PRODUCES ONE, "since `ensureFounded` founds only where no anchor is
 * recorded", and that holds for one process at a time. Two sessions of one installation making
 * their first write together each find no anchor recorded, and each founds: measured with two
 * processes started together, with the anchor recorded before the founding and after it, and
 * produced by the product's own writers in `founded-beside.test.ts`, *counts an anchor founded
 * twice once*. The second founding is by the key the anchor derives from: the same identity
 * arriving twice, not a second one, which is why it counts once here.
 *
 * THAT RACE IS CLOSED FOR WHAT IS WRITTEN FROM NOW ON: `ensureFounded` decides to found under the
 * tail's lock, so the second session finds the first one's founding there and adopts it. A record
 * written before keeps its copy, and this reading still counts it once, which is why the case
 * now plants the copy instead of racing for it.
 */
export function identitiesFoundedBeside(events: Iterable<CatalogEvent>): FoundedBeside[] {
  const founded: string[] = [];
  const beside: FoundedBeside[] = [];
  for (const event of events) {
    if (event.kind !== 'identity.founded') continue;
    const anchor = event.subject;
    if (founded.includes(anchor)) continue;
    if (founded.length > 0) {
      beside.push({
        anchor,
        foundingFp: event.payload.foundingFp,
        at: event.at,
        besides: [...founded],
      });
    }
    founded.push(anchor);
  }
  return beside;
}

/**
 * Whether the key `fingerprint` founded its identity in the tree at `root` beside others: the
 * question a surface asks right after a write settled that key's anchor there. Undefined when it
 * founded nothing there, or founded first.
 *
 * This said "(it adopted an identity already on the record)" of the undefined answer, and a key
 * can do both: one that left the identity it founded here adopts the other one, and this still
 * returns its founding. It answers what the key founded, never whom it speaks for: the surface
 * that owes a sentence for it asks the anchor too (`foundingsSince`, `@mnema/code`).
 */
export function foundedBesideBy(
  root: string,
  fingerprint: string,
  upcasters: UpcasterRegistry,
): FoundedBeside | undefined {
  return identitiesFoundedBeside(orderedEvents({ root }, upcasters)).find(
    (one) => one.foundingFp === fingerprint,
  );
}

/** The anchors THIS process settled, by tree and key: what a record cannot say about itself. */
const settledHere = new Set<string>();

function settledKey(root: string, fingerprint: string): string {
  return `${resolve(root)}\0${fingerprint}`;
}

/** Remembers that this process settled the anchor of `fingerprint` in the tree at `root`. */
export function noteSettledHere(root: string, fingerprint: string): void {
  settledHere.add(settledKey(root, fingerprint));
}

/**
 * Whether THIS process settled the anchor of `fingerprint` in the tree at `root`: founded the
 * identity it names, or adopted the founding the record already held (a fresh clone, a restored
 * key).
 *
 * Two processes of one installation making their first write together both see the key's anchor
 * appear and the founding on the record, and only one of them settled it: the other found it
 * recorded, under the tail's lock or before (`ensureFounded`). The record holds one founding and
 * cannot say which process wrote it, so a surface that owes the sentence "this key founded" to the
 * process that did asks here. It holds for the life of the process and says nothing of any other.
 */
export function settledByThisProcess(root: string, fingerprint: string): boolean {
  return settledHere.has(settledKey(root, fingerprint));
}
