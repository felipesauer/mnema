/**
 * What a writer cites: the head of every OTHER tail of its record that its own tail has not
 * cited yet, read off the disk at the moment it writes (FORMAT.md, "Reading many tails").
 *
 * WHY THE DISK AT THE MOMENT OF WRITING. A citation says "this hash existed when I wrote", and
 * the heads on disk are exactly what existed: whatever a session read before deciding to write
 * was there before them. So citing them is never a claim the writer cannot back, and it is the
 * one reading that needs no help from whatever surface asked for the write. It may cite more
 * than the act depended on; that only orders the event after facts that did precede it.
 *
 * WHY A NOTE OF WHAT WAS CITED, AND WHERE. "Not cited yet" is a fact about the writer's own
 * tail, and reading the whole tail back before every write to learn it is the cost this must
 * not have. So the heads a tail last cited are kept beside the tail's lock, in `locks/`, which
 * the tree's `.gitignore` already keeps out of the record: it is machinery, never proof. Lost,
 * the next write cites every head again — one redundant citation per tail, which changes no
 * order, since its event already followed them. Two processes of one installation share the
 * tail and its lock, so they read and write the note in turn.
 *
 * WHAT IT COSTS. A record with one tail — one machine, which is most of them — costs one
 * directory listing and nothing else: there is no other head to read. Otherwise one `stat` per
 * other tail per write, and one line parsed per tail whose last segment moved since this
 * writer last looked.
 */

import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogEvent } from '../events/catalog.js';
import { parseStoredJson } from '../events/stored-json.js';
import type { UpcasterRegistry } from '../events/upcaster.js';
import type { ChainLayout } from './layout.js';
import { listTails, orderedSegments, readTailTip } from './store.js';

/** Where a tail keeps the heads it last cited, by tail id: beside its lock, out of the record. */
export function citedHeadsPath(layout: ChainLayout, tailId: string): string {
  return join(layout.root, 'locks', `${tailId}.cited`);
}

/** An event made ready to write, and what to remember once it is written. */
export interface Cited {
  readonly event: CatalogEvent;
  /** Records the heads the event cited. Call it only after the event reached the tail. */
  readonly remember: () => void;
}

/** The heads of the other tails of one record, as the writer of one tail cites them. */
export class HeadsToCite {
  /** The last head read of each tail, by the extent of its last segment when it was read. */
  private readonly read = new Map<string, { readonly extent: string; readonly hash: string }>();

  constructor(
    private readonly layout: ChainLayout,
    private readonly ownTail: string,
    private readonly upcasters: UpcasterRegistry,
  ) {}

  /**
   * `event` with `after` naming every other tail's head this tail has not cited yet — or
   * `event` itself when there is none, or when it already says what it cites.
   */
  cite(event: CatalogEvent): Cited {
    const unchanged: Cited = { event, remember: () => undefined };
    if (event.after !== undefined) return unchanged;
    const others = listTails(this.layout).filter((tail) => tail !== this.ownTail);
    if (others.length === 0) return unchanged;
    const cited = this.cited();
    const fresh = new Map<string, string>();
    for (const tail of others) {
      const head = this.headOf(tail);
      if (head !== undefined && cited[tail] !== head) fresh.set(tail, head);
    }
    if (fresh.size === 0) return unchanged;
    const after = [...new Set(fresh.values())].sort();
    return {
      event: { ...event, after },
      remember: () => this.remember({ ...cited, ...Object.fromEntries(fresh) }),
    };
  }

  /** The heads this tail last cited, by tail id — empty when the note is absent or unreadable. */
  private cited(): Record<string, string> {
    try {
      const parsed: unknown = parseStoredJson(
        readFileSync(citedHeadsPath(this.layout, this.ownTail), 'utf-8'),
      );
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (pair): pair is [string, string] => typeof pair[1] === 'string',
        ),
      );
    } catch {
      return {};
    }
  }

  /** Replaces the note whole, so a reader never meets half of it. */
  private remember(heads: Record<string, string>): void {
    const path = citedHeadsPath(this.layout, this.ownTail);
    const staging = `${path}.${process.pid}`;
    try {
      writeFileSync(staging, `${JSON.stringify(heads)}\n`);
      renameSync(staging, path);
    } catch {
      // A note that could not be kept costs the next write one redundant citation per tail,
      // and nothing else: it is never what decides an order.
    }
  }

  /** The entry hash of a tail's last entry, or undefined for one that holds none or cannot be read. */
  private headOf(tail: string): string | undefined {
    try {
      const last = orderedSegments(this.layout, tail).at(-1);
      if (last === undefined) return undefined;
      const extent = `${last}:${statSync(last).size}`;
      const known = this.read.get(tail);
      if (known?.extent === extent) return known.hash;
      const hash = readTailTip(this.layout, tail, this.upcasters, Number.MAX_SAFE_INTEGER).at(-1)
        ?.link.hash;
      if (hash !== undefined) this.read.set(tail, { extent, hash });
      return hash;
    } catch {
      // A tail whose end does not read is not one this writer can say it read. The verifier
      // names what is wrong with it; a write elsewhere is not the place to refuse over it.
      return undefined;
    }
  }
}
