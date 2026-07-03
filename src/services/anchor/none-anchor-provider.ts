import type { AnchorProvider, AnchorReceipt, AnchorVerifyResult } from './anchor-provider.js';

/** The registered name of the default no-op provider. */
export const NONE_PROVIDER = 'none';

/**
 * The default anchor provider (ADR-37: default `none`). A no-op that keeps
 * the product local-first with ZERO network by default: `stamp` records no
 * anchor and does no I/O; `verify` reports `not-anchored` — a neutral
 * state, never an error. `doctor` renders this as "anchoring disabled",
 * not a warning.
 */
export class NoneAnchorProvider implements AnchorProvider {
  readonly name = NONE_PROVIDER;

  /**
   * No-op: performs no I/O and produces a receipt marked `failed` so a
   * caller that ignores the provider and persists it anyway never records a
   * phantom "anchored" head. In practice the scheduler is inert for `none`
   * and never calls this.
   */
  async stamp(head: string): Promise<AnchorReceipt> {
    return { provider: this.name, head, blob: '', status: 'failed' };
  }

  /** Always `not-anchored` — a neutral disabled state, never an error. */
  async verify(): Promise<AnchorVerifyResult> {
    return { state: 'not-anchored', detail: 'anchoring disabled (provider: none)' };
  }
}
