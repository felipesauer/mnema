import type { AnchorRepository } from '../../storage/sqlite/repositories/anchor-repository.js';
import type { AnchorProvider } from './anchor-provider.js';
import { NONE_PROVIDER } from './none-anchor-provider.js';

/**
 * Drives temporal anchoring OFF the write hot path (ADR-37 layer 3). When a
 * new head is signed, {@link onSignedHead} records the head as `pending` and
 * calls the provider's `stamp()` asynchronously — the caller does NOT await
 * it. FAIL-OPEN: if `stamp` throws or hangs, the write already succeeded and
 * the head stays `pending` for a later {@link retryPending}. Anchoring never
 * blocks or fails a write.
 *
 * Inert for the `none` provider: `onSignedHead` returns immediately and
 * records nothing, so a local-first project pays nothing.
 */
export class AnchorScheduler {
  /**
   * In-flight stamp promises, tracked ONLY so a test (or a graceful
   * shutdown) can await settlement. Production callers fire and forget.
   */
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    private readonly anchors: AnchorRepository,
    private readonly provider: AnchorProvider,
  ) {}

  /** True when anchoring is active (any provider other than `none`). */
  private get enabled(): boolean {
    return this.provider.name !== NONE_PROVIDER;
  }

  /**
   * Records `head` as pending and kicks off `stamp()` WITHOUT awaiting it.
   * Returns synchronously so the write path is never held on the network.
   * A `none` provider is a no-op.
   *
   * @param head - The freshly-signed chain-head hash (hex)
   */
  onSignedHead(head: string): void {
    if (!this.enabled) return;
    // Record pending FIRST (synchronous, local) so a crash before stamp
    // settles still leaves a retry marker. Then stamp off the hot path.
    this.anchors.upsert({
      headHash: head,
      provider: this.provider.name,
      status: 'pending',
      receipt: null,
    });
    this.spawnStamp(head);
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
        this.anchors.upsert({
          headHash: head,
          provider: this.provider.name,
          status: receipt.status,
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
