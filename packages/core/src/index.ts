/**
 * @mnema/core — the work domain.
 *
 * Workflow gates, projections (event → state materialized in SQLite),
 * identity, and queries live here. It builds on @mnema/chain: every state
 * change is an event that passes a gate and is appended to the chain; the
 * projections replay those events on read without re-validating them.
 *
 * The domain lands in following changes; this entry point currently
 * re-exports the proof engine's identity so the dependency edge is real.
 */

import { PACKAGE_NAME as CHAIN_PACKAGE } from '@mnema/chain';

export const PACKAGE_NAME = '@mnema/core';
export const CHAIN_DEPENDENCY = CHAIN_PACKAGE;
