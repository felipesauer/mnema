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
 * ONE RULE, ASKED TWICE. The write refuses a name GitHub would not have issued, and the reading
 * asks the same thing again before it puts a recorded name into an address — the record can
 * hold whatever a writer of the format put there, and a name with a `/` or a `?` in it would
 * send the question somewhere other than that account.
 */

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
