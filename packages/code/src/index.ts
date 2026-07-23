/**
 * @mnema/code — the product surfaces.
 *
 * The MCP server (primary, for agents) and the CLI (for the human who
 * drives and verifies). Both are thin adapters over @mnema/core: they map
 * intent to a cataloged event through a gate, or read a projection — they
 * never write state directly.
 *
 * The surfaces land in following changes; this entry point currently
 * re-exports the domain's identity so the dependency edge is real.
 */

import { PACKAGE_NAME as CORE_PACKAGE } from '@mnema/core';

export const PACKAGE_NAME = '@mnema/code';
export const CORE_DEPENDENCY = CORE_PACKAGE;
