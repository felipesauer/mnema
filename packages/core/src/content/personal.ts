/**
 * Personal data that leaves the text before the text is recorded: an email address.
 *
 * The record is append-only and, in the public tree, committed and cloned. A person's address is
 * not a credential, so it is not rotated — but it cannot be taken back either, and nothing in a
 * decision needs it: the `mnid` already says who wrote. So the address is replaced by a marker and
 * the write says so, the way a credential is.
 *
 * THE RULE. A match is `local@domain.tld`: a local part of letters, digits and `._%+-`, a domain of
 * dotted labels, a top-level label of two or more letters. Three kinds of match are NOT replaced,
 * because they name no person:
 *
 *   - the userinfo of a URL (`https://user@host`, `postgres://svc:pw@host`): the context is before
 *     the match, and a lookbehind reads it. The password half is the credential detector's.
 *   - an scp-style git remote (`git@github.com:owner/repo`): the `@host` is followed by `:` and a
 *     path.
 *   - a noreply address (`<id>+name@users.noreply.github.com`, `noreply@…`, `no-reply@…`): a
 *     commit cited from git carries one, it is already public by construction, and replacing it
 *     would mutilate a citation for no privacy gained.
 *
 * Anything that merely has an `@` is not one either: `react@18.2.0` has no alphabetic top-level
 * label, `@scope/pkg` and `@felipesauer` have no local part. A false positive costs a marker, a
 * false negative costs a permanent disclosure, so the rule leans toward replacing except for the
 * three above.
 *
 * NO CAPTURE GROUPS, for the reason `secrets.ts` states: the match IS what is replaced.
 */

import type { SecretClass } from './secrets.js';

/** The class an address is reported under, in the list a write returns beside the credentials. */
export type PersonalClass = 'email';

/** What replaces an address: the class, and nothing about the value. */
export const EMAIL_PLACEHOLDER = '<email>';

// The first lookbehind makes the start a token boundary; the second keeps it out of the userinfo
// of a URL. The lookahead ends the address where its top-level label ends and spares an scp remote.
const EMAIL =
  /(?<![\w.%+-])(?<!:\/\/[^\s/@]*)[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?![\w-]|\.\w|:[\w~/])/g;

/** An address that is already public by construction, or names a role rather than a person. */
const NAMES_NO_ONE = /^(?:no-?reply@|[^@]*@(?:[A-Za-z0-9-]+\.)*noreply\.github\.com$)/i;

/** Text with every email address replaced, and one `'email'` per address. */
export interface ScrubbedPersonal {
  readonly text: string;
  readonly replaced: readonly PersonalClass[];
}

/** Replaces every email address in `text` by {@link EMAIL_PLACEHOLDER}. */
export function scrubEmails(text: string): ScrubbedPersonal {
  const replaced: PersonalClass[] = [];
  const out = text.replace(EMAIL, (match) => {
    if (NAMES_NO_ONE.test(match)) return match;
    replaced.push('email');
    return EMAIL_PLACEHOLDER;
  });
  return replaced.length === 0 ? { text, replaced } : { text: out, replaced };
}

/** Everything a write can report as replaced: a credential's class, or `'email'`. */
export type ReplacedClass = SecretClass | PersonalClass;
