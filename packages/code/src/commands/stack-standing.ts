import { catalogUpcasters } from '@mnema/chain';
import { orderedEvents } from '@mnema/core';

/** The stacks a tree's record stands on, each with the version of its last adoption. */
export function standingIn(root: string): Map<string, string> {
  const standing = new Map<string, string>();
  for (const event of orderedEvents({ root }, catalogUpcasters())) {
    if (event.kind === 'stack.adopted') standing.set(event.subject, event.payload.version);
    else if (event.kind === 'stack.removed') standing.delete(event.subject);
  }
  return standing;
}
