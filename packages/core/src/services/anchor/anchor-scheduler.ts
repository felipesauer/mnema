import type { SignedHeadListener } from '../../storage/audit/audit-types.js';
import type { AnchorRepository } from '../../storage/sqlite/repositories/anchor-repository.js';
import type { AnchorProvider } from './anchor-provider.js';
import { NONE_PROVIDER } from './none-anchor-provider.js';

/** The anchor cadence: anchor after `events` new events OR `seconds`. */
export interface AnchorInterval {
  readonly events?: number;
  readonly seconds?: number;
}

/**
 * Drives temporal anchoring OFF the write hot path. When a
 * new head is signed, {@link onSignedHead} records the head as `pending` and
 * calls the provider's `stamp()` asynchronously — the caller does NOT await
 * it. FAIL-OPEN: if `stamp` throws or hangs, the write already succeeded and
 * the head stays `pending` for a later {@link retryPending}. Anchoring never
 * blocks or fails a write.
 *
 * Anchoring fires at the configured `audit.anchor.interval` — NOT on every
 * signed head. A head is anchored when enough new events OR enough elapsed
 * time have accrued since the last anchor. When the interval is empty the
 * cadence follows the checkpoint (every signed head), the documented default.
 *
 * Inert for the `none` provider: `onSignedHead` returns immediately and
 * records nothing, so a local-first project pays nothing.
 */
export class AnchorScheduler implements SignedHeadListener {
  /**
   * In-flight stamp promises, tracked ONLY so a test (or a graceful
   * shutdown) can await settlement. Production callers fire and forget.
   */
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    private readonly anchors: AnchorRepository,
    private readonly provider: AnchorProvider,
    private readonly interval: AnchorInterval = {},
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** True when anchoring is active (any provider other than `none`). */
  private get enabled(): boolean {
    return this.provider.name !== NONE_PROVIDER;
  }

  /**
   * Records `head` as pending and kicks off `stamp()` WITHOUT awaiting it,
   * BUT only when the configured anchor interval has elapsed since the last
   * anchor — so anchoring honours `audit.anchor.interval`, not the checkpoint
   * cadence. Returns synchronously so the write path is never held on the
   * network. A `none` provider is a no-op.
   *
   * @param head - The freshly-signed chain-head hash (hex)
   * @param eventCount - `event_count` from the audit-state mirror
   */
  onSignedHead(head: string, eventCount: number): void {
    if (!this.enabled) return;
    if (!this.shouldAnchor(eventCount)) return;
    // Record pending FIRST (synchronous, local) so a crash before stamp
    // settles still leaves a retry marker. Then stamp off the hot path.
    this.anchors.upsert({
      headHash: head,
      provider: this.provider.name,
      status: 'pending',
      receipt: null,
      eventCountAt: eventCount,
    });
    this.spawnStamp(head);
  }

  /**
   * True when a new anchor is due: none yet, OR enough new events / elapsed
   * time since the last anchor for this provider. An empty interval means
   * "every signed head" (the documented default cadence). Uses the most
   * recent anchor for this provider as the baseline.
   */
  private shouldAnchor(eventCount: number): boolean {
    const { events, seconds } = this.interval;
    if (events === undefined && seconds === undefined) return true;
    const last = this.anchors.latestForProvider(this.provider.name);
    if (last === null) return true;
    if (last.eventCountAt !== null && eventCount <= last.eventCountAt) return false;
    if (events !== undefined) {
      // No by-events baseline (a legacy/failed row, or a time-only prior
      // anchor): the events interval can't be measured against it, so treat
      // the anchor as due rather than let an events-only interval wedge and
      // never anchor again.
      if (last.eventCountAt === null) return true;
      if (eventCount - last.eventCountAt >= events) return true;
    }
    if (seconds !== undefined) {
      const elapsedMs = this.now().getTime() - new Date(last.createdAt).getTime();
      if (elapsedMs >= seconds * 1000) return true;
    }
    return false;
  }

  /**
   * Retries every still-pending anchor (e.g. on boot, or on a timer). Each
   * stamp is fire-and-forget and fail-open, exactly like {@link onSignedHead}.
   * A `none` provider is a no-op.
   */
  retryPending(): void {
    if (!this.enabled) return;
    for (const rec of this.anchors.listPending()) {
      if (rec.provider === this.provider.name) this.spawnStamp(rec.headHash);
    }
  }

  /**
   * Awaits all in-flight stamps. For tests and graceful shutdown ONLY — the
   * write path must never call this (it would reintroduce the block).
   */
  async settle(): Promise<void> {
    await Promise.allSettled([...this.inflight]);
  }

  /**
   * Runs one stamp off the hot path, persisting the outcome. Fail-open: any
   * error leaves the anchor `pending` (never throws to the caller).
   */
  private spawnStamp(head: string): void {
    const task = (async () => {
      try {
        const receipt = await this.provider.stamp(head);
        // A provider that signals failure by RETURNING `failed` (rather than
        // throwing) must stay retryable: persist it as `pending`, matching
        // the throw path. Otherwise `listPending` (pending-only) would never
        // pick it up and the anchor would be stuck forever.
        this.anchors.upsert({
          headHash: head,
          provider: this.provider.name,
          status: receipt.status === 'failed' ? 'pending' : receipt.status,
          receipt: receipt.blob === '' ? null : receipt.blob,
        });
      } catch {
        // Fail-open: the write already stood. Leave the anchor pending for
        // a later retry; never surface the error to the write path.
      }
    })();
    this.inflight.add(task);
    void task.finally(() => this.inflight.delete(task));
  }
}
