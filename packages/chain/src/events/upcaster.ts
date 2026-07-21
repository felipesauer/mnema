/**
 * Upcasters: the mechanism that keeps an event written under an old contract
 * readable forever.
 *
 * A published payload is never edited in place. When a kind's shape must
 * change, a new version arm is added to the catalog and an upcaster is
 * registered that lifts the previous version to it. Reading walks the
 * registered upcasters from the event's own version up to the latest, so code
 * from any future year reproduces an event from any past year without the
 * chain ever being rewritten. "Proving" a fact includes still being able to
 * read it.
 *
 * The registry is keyed by `(kind, fromVersion)` and each entry raises the
 * version by exactly one step, so the path from any version to the latest is
 * unambiguous and total — a gap in the ladder is a bug that surfaces the first
 * time an old event is read, not a silent misread.
 *
 * The "latest version of each kind" lookup is injected (defaulting to the
 * catalog's) so the walk is defined by data, not hardcoded — and so it can be
 * exercised against a taller ladder than the current catalog happens to have.
 */

import { type CatalogEvent, LATEST_VERSION } from './catalog.js';

/** A parsed-but-not-yet-current event: known kind, some prior version. */
export interface VersionedEvent {
  readonly kind: string;
  readonly v: number;
  readonly [field: string]: unknown;
}

/** Lifts an event of `(kind, from)` to `(kind, from + 1)`. */
export type Upcaster = (event: VersionedEvent) => VersionedEvent;

/** Maps a kind to the highest version the current code understands. */
export type LatestVersions = { readonly [kind: string]: number | undefined };

interface UpcasterKey {
  readonly kind: string;
  readonly from: number;
}

/**
 * A registry of upcasters. Empty is valid: with only v1 in the catalog there
 * is nothing to lift, and a v1 event reaches the latest in zero steps. Entries
 * accumulate as versions are added.
 */
export class UpcasterRegistry {
  private readonly steps = new Map<string, Upcaster>();

  /**
   * @param latest - kind → highest known version. Defaults to the catalog's
   *   `LATEST_VERSION`; overridable so the walk can be tested against a ladder
   *   taller than the current catalog.
   */
  constructor(private readonly latest: LatestVersions = LATEST_VERSION) {}

  private static keyOf(kind: string, from: number): string {
    return `${kind}@${from}`;
  }

  /**
   * Registers the single-step lift for `(kind, from) → (kind, from + 1)`.
   * Refuses to overwrite an existing step: two upcasters for the same rung
   * would make the ladder ambiguous, and silently picking one could change
   * how history reads.
   */
  register({ kind, from }: UpcasterKey, upcaster: Upcaster): this {
    const key = UpcasterRegistry.keyOf(kind, from);
    if (this.steps.has(key)) {
      throw new UpcasterError(`an upcaster is already registered for ${key}`);
    }
    this.steps.set(key, upcaster);
    return this;
  }

  /**
   * Lifts a parsed event to the latest version of its kind by applying each
   * registered step in turn. A v1 event of a kind whose latest is 1 returns
   * unchanged. Throws if a rung is missing before the latest is reached, or if
   * an upcaster fails to raise the version by exactly one — both mean the
   * ladder is broken and the event cannot be faithfully reproduced.
   */
  upcast(event: VersionedEvent): CatalogEvent {
    const kind = event.kind;
    const latest = this.latest[kind];
    if (latest === undefined) {
      throw new UpcasterError(`unknown event kind "${kind}"`);
    }
    if (event.v > latest) {
      throw new UpcasterError(
        `event kind "${kind}" is at version ${event.v}, ahead of the known latest ${latest} — ` +
          'reading it needs a newer catalog',
      );
    }

    let current = event;
    while (current.v < latest) {
      const step = this.steps.get(UpcasterRegistry.keyOf(kind, current.v));
      if (step === undefined) {
        throw new UpcasterError(
          `no upcaster for ${kind}@${current.v}; cannot reach version ${latest}`,
        );
      }
      const next = step(current);
      if (next.v !== current.v + 1) {
        throw new UpcasterError(
          `upcaster for ${kind}@${current.v} produced version ${next.v}, expected ${current.v + 1}`,
        );
      }
      current = next;
    }

    return current as unknown as CatalogEvent;
  }
}

/** Thrown when the upcaster ladder is broken or an event is unreadable. */
export class UpcasterError extends Error {
  override readonly name = 'UpcasterError';
}
