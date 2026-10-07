/**
 * The account an identity names on a code host — what the `account.linked` fact carries, and
 * the one rule both of its sides keep.
 *
 * TWO SERVICES. `github` is the host whose account publishes its SSH keys at an address anybody
 * can ask (`github.com/<name>.keys`). `sigstore` is the identity a Sigstore certificate names: an
 * e-mail address, or the workflow of a repository in GitHub Actions — what a bundle in `witness/`
 * says signed, which speaks for this identity only where this identity named the same one. The
 * format takes any service name; this product writes and reads these two.
 *
 * AN E-MAIL ADDRESS IS KEPT AS ITS HASH. The record is append-only and cloned, so a person's
 * address written into it is there for good; a `sigstore` link to an e-mail carries
 * `sha256:<hex>` of the address instead (trimmed, lower case), and every reading compares a
 * certificate's address by computing the same thing ({@link sigstoreAccountOf}). A workflow is
 * a repository's, not a person's, and is kept as it is.
 *
 * ONE RULE, ASKED TWICE. The write refuses a name GitHub would not have issued, and the reading
 * asks the same thing again before it puts a recorded name into an address — the record can
 * hold whatever a writer of the format put there, and a name with a `/` or a `?` in it would
 * send the question somewhere other than that account.
 */

import { createHash } from 'node:crypto';

/** The service an `account.linked` fact names for a GitHub account. */
export const GITHUB_SERVICE = 'github';

/** GitHub's own rule: letters, digits and single hyphens, no hyphen at either end, 1 to 39. */
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** Why `login` is not a GitHub account name, or undefined when it is one. */
export function githubLoginRefusal(login: string): string | undefined {
  if (GITHUB_LOGIN.test(login)) return undefined;
  return (
    `${JSON.stringify(login)} is not a GitHub account name — letters, digits and single ` +
    'hyphens, not starting or ending with a hyphen, at most 39 characters'
  );
}

/** The service an `account.linked` fact names for the identity a Sigstore certificate carries. */
export const SIGSTORE_SERVICE = 'sigstore';

/** An e-mail address as a certificate names it: one `@`, no space, a dot in the domain. */
const AN_EMAIL = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;

/** A GitHub Actions workflow as Fulcio names it: the workflow file of a repository, at a ref. */
const A_WORKFLOW =
  /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/\.github\/workflows\/[^\s/@]+@\S+$/;

/** Why `identity` is not one a Sigstore certificate names, or undefined when it is. */
export function sigstoreIdentityRefusal(identity: string): string | undefined {
  if (AN_EMAIL.test(identity) || A_WORKFLOW.test(identity)) return undefined;
  return (
    `${JSON.stringify(identity)} is not an identity a Sigstore certificate names — an e-mail ` +
    'address, or a workflow as https://github.com/<owner>/<repo>/.github/workflows/<file>@<ref>'
  );
}

/**
 * WHAT THE RECORD KEEPS FOR A SIGSTORE IDENTITY, and what a reading compares against: an e-mail
 * address as `sha256:<hex>` of the address trimmed and in lower case, a workflow as it is. The
 * one function the claim writes with and every reading asks, so the two cannot drift apart.
 */
export function sigstoreAccountOf(identity: string): string {
  const said = identity.trim();
  if (!AN_EMAIL.test(said)) return said;
  return `sha256:${createHash('sha256').update(said.toLowerCase(), 'utf8').digest('hex')}`;
}
