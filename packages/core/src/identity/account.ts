/**
 * The account an identity names on a code host — what the `account.linked` fact carries, and
 * the one rule both of its sides keep.
 *
 * ONE SERVICE. `github` is the host this product links and reads, because it is the one that
 * publishes an account's SSH keys at an address anybody can ask (`github.com/<name>.keys`). The
 * format takes any service name; this product writes and reads this one.
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
