// @reads-the-tree
/**
 * THE LIST OF WHAT THE DOOR RECOGNIZES IS GENERATED, AND A FORMAT WITHOUT A LINE ON THE PAGE IS RED.
 *
 * `docs/cli-reference.md` (What goes into the record) lists the classes of credential the door
 * replaces before anything is recorded, and the e-mail address it replaces beside them. The
 * classes are `SECRET_CLASSES` of `@mnema/core` and the placeholder of an address is
 * `EMAIL_PLACEHOLDER`: this file makes the table from them, one row each in the order the door
 * applies them, and compares it with the page. The words of each row live here as a record typed
 * over `SecretClass`, so a class added to the door does not compile, and a class removed leaves a
 * row the page no longer has, until the row is written.
 *
 * To change the table, change the words below and run this file with `-u`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EMAIL_PLACEHOLDER,
  SECRET_CLASSES,
  type SecretClass,
  scrubEmails,
  secretPlaceholder,
} from '@mnema/core';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const PAGE = 'docs/cli-reference.md';

const BEGIN =
  '<!-- The table below is generated from packages/core/src/content/secrets.ts: edit the words in the-secret-classes-page-is-generated.test.ts. -->';
const END = '<!-- End of the generated table. -->';

/** What each class matches, in the words the page uses. */
const WHAT_IT_MATCHES: { readonly [K in SecretClass]: string } = {
  'aws-access-key':
    'An AWS access key id: `AKIA`, `ASIA`, `ABIA` or `ACCA`, then 16 or more capitals and digits.',
  'github-token':
    'A GitHub token: `ghp_`, `gho_`, `ghu_`, `ghs_` or `ghr_`, then 36 or more letters and digits.',
  'anthropic-key': 'An Anthropic key: `sk-ant-`, then 20 or more letters, digits, `_` or `-`.',
  'openai-key':
    'An OpenAI-style key: `sk-` or `sk-proj-`, then 20 or more letters, digits, `_` or `-`; a value whose every piece is a lowercase word is read as a name and left alone.',
  'stripe-key':
    'A Stripe key: `sk_live_`, `sk_test_`, `rk_live_` or `rk_test_`, then 20 or more letters and digits.',
  'slack-token':
    'A Slack token: `xoxb-`, `xoxa-`, `xoxp-`, `xoxr-` or `xoxs-`, then 10 or more letters, digits or `-`.',
  'google-api-key': 'A Google API key: `AIza`, then 30 or more letters, digits, `_` or `-`.',
  'npm-token': 'An npm token: `npm_`, then 36 or more letters and digits.',
  jwt: 'A JSON Web Token: three dot-separated base64url parts, the first beginning `eyJ`.',
  'private-key-block':
    'A private key in PEM form (`-----BEGIN ... PRIVATE KEY-----`) or mnema’s own protected key file, the whole block when it is closed, only its header when it is not.',
  'url-password':
    'The password of `scheme://user:password@host`; the scheme, the user and the host stay.',
};

/** The table the page carries between its markers. */
export function secretClassesTable(): string {
  const rows = SECRET_CLASSES.map(
    (secret) => `| \`${secretPlaceholder(secret)}\` | ${WHAT_IT_MATCHES[secret]} |`,
  );
  return [
    '| Replaced by | What it matches |',
    '| --- | --- |',
    ...rows,
    `| \`${EMAIL_PLACEHOLDER}\` | An e-mail address, except \`noreply@\`, \`no-reply@\` and GitHub\u2019s \`noreply.github.com\` form, which name no one. |`,
  ].join('\n');
}

/** `committed` with the part between the markers rewritten. */
export function generatedPage(committed: string): string {
  const from = committed.indexOf(BEGIN);
  const to = committed.indexOf(END, from + 1);
  if (from === -1 || to < from) throw new Error(`${PAGE} has no generated secret-class table`);
  return `${committed.slice(0, from)}${BEGIN}\n\n${secretClassesTable()}\n\n${committed.slice(to)}`;
}

describe('the list of recognized formats on the page', () => {
  it('is what the door recognizes', async () => {
    const committed = readFileSync(join(ROOT, PAGE), 'utf-8');
    await expect(generatedPage(committed)).toMatchFileSnapshot(join(ROOT, PAGE));
  });

  it('accuses a page that dropped a class, and keeps the prose around it', () => {
    const committed = readFileSync(join(ROOT, PAGE), 'utf-8');
    const dropped = committed
      .split('\n')
      .filter((line) => !line.startsWith('| `<SECRET:npm-token>`'))
      .join('\n');
    expect(dropped).not.toBe(committed);
    expect(generatedPage(dropped)).toBe(committed);
    const prose = committed.replace(
      '### What goes into the record',
      '### What goes into the record!',
    );
    expect(prose).not.toBe(committed);
    expect(generatedPage(prose)).toBe(prose);
  });

  it('has a row for every class the door applies, and for the address', () => {
    const table = secretClassesTable();
    for (const secret of SECRET_CLASSES)
      expect(table).toContain(`\`${secretPlaceholder(secret)}\``);
    expect(table).toContain(`\`${EMAIL_PLACEHOLDER}\``);
    // The e-mail row is not a claim made up here: the door does replace an address.
    expect(scrubEmails('write to ana@example.com').text).toContain(EMAIL_PLACEHOLDER);
  });
});
