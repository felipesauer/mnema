/**
 * The chain: the top-level entry point that ties layout, keys, writer, and
 * verifier together.
 *
 * `openChainForWriting` gives a machine a writer for its own tail (minting a
 * key pair on first use). `verify` reads and checks the whole chain. These are
 * the two operations the surfaces need: emit an event, or ask "is this
 * intact?".
 */

import { catalogUpcasters } from '../events/registry.js';
import type { UpcasterRegistry } from '../events/upcaster.js';
import { loadOrCreateKeyPair } from './keystore.js';
import type { ChainLayout } from './layout.js';
import { type VerifyResult, verifyChain } from './verify.js';
import { ChainWriter, type WriterOptions } from './writer.js';

/** Opens a chain rooted at `root` for this machine to write to. */
export function openChainForWriting(
  root: string,
  options: WriterOptions & { upcasters?: UpcasterRegistry } = {},
): ChainWriter {
  const layout: ChainLayout = { root };
  const keyPair = loadOrCreateKeyPair(layout);
  const upcasters = options.upcasters ?? catalogUpcasters();
  return new ChainWriter(layout, keyPair, upcasters, options);
}

/** Verifies the whole chain rooted at `root`. */
export function verify(
  root: string,
  upcasters: UpcasterRegistry = catalogUpcasters(),
): VerifyResult {
  return verifyChain({ root }, upcasters);
}
