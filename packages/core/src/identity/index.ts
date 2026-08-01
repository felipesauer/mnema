/**
 * Identity: how an entity is named. The id is the only identity; everything
 * here derives a human-facing form from it without ever becoming identity.
 */

export {
  ALIAS_PREFIXES,
  type AliasKind,
  type AliasSubject,
  deriveAlias,
  disambiguate,
  SHORT_ALIAS_HEX,
} from './alias.js';
export {
  type AnchorResolution,
  isAnchorId,
  resolveAnchorPrefix,
  SHORT_ANCHOR_HEX,
  shortenAnchors,
} from './anchor.js';
export { canonicalId } from './id.js';
export { canonicalIdentity } from './who.js';
