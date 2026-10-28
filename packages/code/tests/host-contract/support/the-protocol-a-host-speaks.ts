/**
 * THE REVISION OF THE MODEL CONTEXT PROTOCOL A HOST SPEAKS TO THE SERVER IT STARTS, and the one
 * that is the trigger for migrating the SDK.
 *
 * The 2026-07-28 revision removes the `initialize` handshake: a client sends its requests directly
 * and carries the version and its capabilities in each one. The server of the product answers such
 * a client today (`a-client-that-never-initializes.test.ts` holds how), but the SDK it is built on
 * (1.x) knows no revision past 2025-11-25, and the `which` of every fact comes from the handshake.
 * A host that begins to speak the new revision is the day the migration stops being a plan: a
 * pinned host that does turns its job red through {@link theRevisionWithoutInitialize}.
 */

import { appendFileSync } from 'node:fs';
import type { WhatTheServerWasHanded } from './a-sandbox.js';

/** The first revision of the protocol that has no `initialize`. */
export const THE_REVISION_WITHOUT_INITIALIZE = '2026-07-28';

/** True where the host speaks the revision with no handshake, or sent no `initialize` at all. */
export function theRevisionWithoutInitialize(handed: WhatTheServerWasHanded): boolean {
  if (handed.withoutInitialize) return true;
  return handed.protocol !== undefined && handed.protocol >= THE_REVISION_WITHOUT_INITIALIZE;
}

/**
 * Writes the revision the host negotiated into the run's summary (where the job has one), under
 * the "Host measured" lines, and returns what the job fails with if it is the revision with no
 * handshake: that is the trigger to migrate the SDK and to decide how a fact is attributed
 * without a client name. Nothing is returned for a host that still begins with `initialize`.
 */
export function theProtocolOf(host: string, handed: WhatTheServerWasHanded): string | undefined {
  const spoken = handed.withoutInitialize ? '(no initialize at all)' : (handed.protocol ?? '?');
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary !== undefined && summary !== '') {
    appendFileSync(summary, `- ${host} speaks MCP ${spoken}\n`);
  }
  if (!theRevisionWithoutInitialize(handed)) return undefined;
  return (
    `${host} negotiates MCP ${spoken}. From ${THE_REVISION_WITHOUT_INITIALIZE} the handshake is ` +
    'gone: this is the trigger to migrate the SDK and to decide how a fact is attributed ' +
    'without a client name.'
  );
}
