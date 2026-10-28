/**
 * What the record page's script takes from `@mnema/core`, and nothing else.
 *
 * `@mnema/core` is a package for Node: its index loads the stores, the cache and the discovery of a
 * machine, and a page has none of them. The projections the page derives its lists with
 * (`site/model.ts`) are pure functions over events, in modules that import only `@mnema/chain`. The
 * bundle (`the-site-verifier.mjs`) links the name `@mnema/core` to THIS file, which re-exports from
 * the built modules exactly the names `model.ts` and `@mnema/context`'s `decisions.js` use. A name
 * either of them starts to use that is not listed here is not found, and the build stops: it does not
 * come out as a page that fails in a reader's browser.
 *
 * These are paths into `dist` and not a new `exports` of the package: the package's public surface
 * is not widened for a script it does not ship.
 */

export { shortenAnchors } from '../../core/dist/identity/anchor.js';
export { newestFirst } from '../../core/dist/projections/newest-first.js';
export { adrCollisions, projectDecisions } from '../../core/dist/projections/decision.js';
export {
  projectKnowledge,
  projectLinks,
  projectObservations,
} from '../../core/dist/projections/knowledge.js';
export { orderedEvents } from '../../core/dist/projections/order.js';
export { DECISION_STATES } from '../../core/dist/workflow/decision-states.js';
