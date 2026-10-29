/** Light on purpose: the Sigstore library is loaded only when a bundle is read, and this is read by the pages that print it. */

/** What follows "logged" in a line that says when: the time and whose clock it is, or that there is none. */
export function whenLogged(reading: {
  readonly loggedAt?: string | undefined;
  readonly loggedAtBy?: 'rekor' | 'timestamp-authority' | undefined;
}): string {
  if (reading.loggedAt === undefined) return 'in Rekor (time not carried)';
  return reading.loggedAtBy === 'timestamp-authority'
    ? `in Rekor, timestamped by the timestamp authority at ${reading.loggedAt}`
    : `by Rekor at ${reading.loggedAt}`;
}
