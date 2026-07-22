/**
 * The chain: the top-level entry point that ties layout, keys, writer, and
 * verifier together.
 *
 * `openChainForWriting` gives a machine a writer for one chain's tail. The
 * signing key belongs to the PERSON, not the chain: it is loaded from a separate
 * key root (minting a fresh pair there on first use), and only its PUBLIC half is
 * materialized into the chain — so one identity can write to several chains with
 * one private key, never copied, while each chain still carries the public key an
 * anonymous verifier needs. `verify` reads and checks the whole chain. These are
 * the two operations the surfaces need: emit an event, or ask "is this intact?".
 */

import { catalogUpcasters } from '../events/registry.js';
import type { UpcasterRegistry } from '../events/upcaster.js';
import {
  loadOrCreateInstallationId,
  loadOrCreateKeyPair,
  materializePublicKey,
} from './keystore.js';
import type { ChainLayout } from './layout.js';
import { type VerifyResult, verifyChain } from './verify.js';
import { ChainWriter, type WriterOptions } from './writer.js';

/** Where a chain's writer reads its key from and (with the writer options) how it writes. */
export interface OpenOptions extends WriterOptions {
  /**
   * The key root: where this person's key pair lives, separate from the chain.
   * Always explicit — the private key never lives inside a chain, so there is no
   * "same as the chain root" default. One key root can back several chains.
   */
  readonly keyRoot: string;
  readonly upcasters?: UpcasterRegistry;
}

/**
 * Opens the chain at `chainRoot` for this machine to write to, signing with the
 * key at `options.keyRoot`. Loads (or, on first use, mints) the person's pair
 * from the key root, materializes its public half into the chain so the chain is
 * anonymously verifiable, and mints a per-chain installation id. The writer only
 * ever touches the chain root; the key root is read here and nowhere else.
 */
export function openChainForWriting(chainRoot: string, options: OpenOptions): ChainWriter {
  const chainLayout: ChainLayout = { root: chainRoot };
  const keyPair = loadOrCreateKeyPair({ root: options.keyRoot });
  materializePublicKey(chainLayout, keyPair);
  const installationId = loadOrCreateInstallationId(chainLayout, keyPair.fingerprint);
  const upcasters = options.upcasters ?? catalogUpcasters();
  return new ChainWriter(chainLayout, keyPair, installationId, upcasters, options);
}

/** Verifies the whole chain rooted at `root`. */
export function verify(
  root: string,
  upcasters: UpcasterRegistry = catalogUpcasters(),
): VerifyResult {
  return verifyChain({ root }, upcasters);
}
