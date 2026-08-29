/**
 * What a credential looks like, and how it leaves the text before the text is
 * recorded.
 *
 * The record is append-only: a value written here cannot be taken back, and in a
 * public tree it is committed to the repository and clones to every machine that
 * ever pulls it. So a credential that reaches the chain is not a bug to fix
 * later — it is a permanent disclosure, and rotating the credential is the only
 * remedy left. That is why the text is cleaned at the door rather than reported
 * afterwards.
 *
 * KNOWN PREFIXES ONLY. Every pattern below anchors on a format its issuer
 * defined (`AKIA…`, `ghp_…`, a PEM header, a password in a URL). Generic
 * "high-entropy string" detection is deliberately absent, and not as a matter of
 * taste: this product stamps a v7 id and a key fingerprint on EVERY event, so an
 * entropy rule would replace the record's own identity — measured over a real
 * archive of 4,277 events, a prefix rule flagged 0 values and an entropy rule
 * flagged 13,094, of which 8,208 were fingerprints and 3,649 were ids. A defense
 * that eats the identifiers is worse than none, because the record stops being
 * readable while still not being safe.
 *
 * LENGTHS ARE MINIMUMS, NEVER EXACT. A pattern that pinned a token's length
 * would stop matching the day its issuer added one character — silently, with no
 * failing test anywhere. An early version of the Google pattern fixed 35
 * characters and missed a real 36-character key exactly that way.
 *
 * NO CAPTURE GROUPS. Every pattern matches the secret and NOTHING else, so the
 * replacement is always the whole match. This is structural, not stylistic: the
 * first version of this detector isolated a URL password in group 1 and passed
 * `String.replace` a callback, where the second argument is the match OFFSET when
 * the pattern has no group — so the replacement silently no-oped while the report
 * still said "replaced". It told the caller the value was gone and wrote it
 * anyway, which is worse than no defense at all, because a false all-clear ends
 * the investigation. With no groups that shape of bug cannot be written: the
 * password pattern uses a lookbehind for its context (see `url-password`), so the
 * match IS the secret. And the tests assert the VALUE IS ABSENT from the output,
 * never that a counter moved — the assertion that catches this, where checking
 * the report is the assertion that does not.
 *
 * THE PLACEHOLDER IS TYPED AND CARRIES NO DIGEST. `<SECRET:aws-access-key>` says
 * what class of thing was removed, because rotating an AWS key and changing a
 * database password are different operations and whoever reads the record six
 * months later has to know which one to do. It carries no hash of the removed
 * value: a digest of a LOW-entropy secret (a password) falls to a dictionary in
 * seconds, so it would leak the very value it replaced while looking safe.
 *
 * AND IT MUST NOT EAT THE NAMES PEOPLE CHOOSE. The same argument that killed an
 * entropy rule applies one level down, to a PREFIX that is also a word. `sk-` is a
 * convention several issuers reuse and it is also two letters a person reaches for
 * in a product whose own verb is `skill`. Measured over the 194 directory and
 * branch names this repository's own work produced, read as the skill id someone would
 * type, 173 of 194 were replaced: `mnema skill "sk-check-the-tenant-scope-first"`
 * recorded the name as `<SECRET:openai-key>`, and the record is append-only, so the
 * name the person chose was not recoverable. The same shape fired INSIDE a sentence,
 * so a memory that merely MENTIONED such an id was recorded mutilated too. What
 * answers for that is {@link readsAsAChosenName}, and it is measured on both sides
 * rather than tuned until it felt right.
 *
 * AND IT ONLY CATCHES WHAT IT RECOGNIZES. A proprietary token, a password
 * written out in prose, a secret split across two records, a base64 blob: all of
 * them pass. This is damage reduction, not a guarantee, and the honest place to
 * say so is where a caller reads the contract — which is why the write surfaces
 * declare the limit in their own descriptions instead of letting silence read as
 * safety.
 */

/**
 * The classes of credential the scrubber recognizes, in the order it applies them.
 *
 * This list is the ONE address of that order: {@link scrubSecrets} walks it, and
 * the shapes next door are a lookup keyed by it rather than a second sequence. The
 * order carries meaning — see `SHAPES` for the prefix families it resolves — so two
 * copies of it would be two readings of one rule.
 */
export const SECRET_CLASSES = [
  'aws-access-key',
  'github-token',
  // `anthropic-key` before `openai-key`: `sk-ant-` is the longer of two prefixes
  // that share `sk-`, so the specific one has to be tried first. Moving it after
  // `openai-key` still refuses the value and reports the WRONG issuer.
  'anthropic-key',
  'openai-key',
  'stripe-key',
  'slack-token',
  'google-api-key',
  'npm-token',
  'jwt',
  'private-key-block',
  'url-password',
] as const;

/** One class of credential the scrubber recognizes. */
export type SecretClass = (typeof SECRET_CLASSES)[number];

/** What replaces a recognized credential: the class, and nothing about the value. */
export function secretPlaceholder(secret: SecretClass): string {
  return `<SECRET:${secret}>`;
}

/**
 * How far past a PEM header the block's body is followed when looking for the
 * closing marker.
 *
 * The bound is what keeps the search linear. An unbounded lazy `[\s\S]*?` before
 * a literal terminator has to scan to the end of the field once per header when
 * no terminator exists, so a field packed with headers would cost the square of
 * its length.
 *
 * The SIZE of the bound is measured, not guessed. A field of 64 KiB packed with
 * 2,427 unclosed headers is the worst input reachable under the size limit, and the
 * span is what its cost is linear in — this pattern alone over that input, the two
 * spans measured side by side in one process:
 *
 *   span 16384 : 105.3 ms
 *   span  8192 :  55.3 ms
 *
 * Against 0.35 ms for a whole scrub of a clean 64 KiB field and 0.0011 ms for a
 * typical one, so the bound is the only thing standing between a hostile field and
 * a hundred milliseconds of regex.
 *
 * 8 KiB is still generous by a wide margin against what it has to hold: an RSA-4096
 * private key in PEM is about 3.2 KB of body and an Ed25519 one about 400 bytes, so
 * the span covers the largest key anyone uses twice over. Halving it halves the
 * worst case for nothing given up — both of those keys are still replaced whole,
 * asserted in the tests rather than assumed here.
 */
const PEM_BODY_SPAN = 8_192;

/**
 * The shape of each class, as a LOOKUP. The order lives in
 * {@link SECRET_CLASSES} and nowhere else; the keys below are written in that same
 * order for legibility only, and nothing reads this object's own key order.
 *
 * The type is a mapped record over {@link SecretClass}, so a class added to the
 * list does not compile until it has a shape here. That is the point: a class with
 * no shape would never fire, and an audit would report a clean record while the
 * value went to the chain.
 *
 * SHARED PREFIXES EXIST, AND ORDER IS WHAT RESOLVES THEM. This comment used to
 * claim that "no two patterns here overlap (`sk-` and `sk_` are different
 * prefixes)". That premise was false, and a real key falsified it: `sk-` is a
 * convention several issuers reuse, so a key of Anthropic's shape (`sk-ant-…`) was
 * matched by the OpenAI shape and reported to a person as `openai-key` — the
 * refusal right, the name wrong. The rule now: within a family that shares a
 * prefix, the class whose prefix is MORE SPECIFIC comes first in
 * {@link SECRET_CLASSES}, and the general one is the fallback label. `sk-` is the
 * only such family in this table today.
 *
 * The rule is held by `secrets.test.ts`, which walks `SECRET_CLASSES` and asserts
 * each class's sample is reported as EXACTLY that class. A class added behind a
 * prefix an earlier shape already swallows fails there rather than shipping the
 * wrong name — which is what this table had no way to catch before.
 *
 * Every shape is global, and matches the SECRET ONLY — no capture groups, ever
 * (see the module comment), so a replacement is the whole match. Each runs over the
 * text the previous ones already cleaned, so a placeholder is never re-matched.
 */
const SHAPES: { readonly [K in SecretClass]: RegExp } = {
  'aws-access-key': /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16,}\b/g,
  'github-token': /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  // Anthropic's own prefix, tried before the shared one. The suffix after `sk-ant-`
  // is left open (`api03`, `admin01`, and whatever comes next) because the family
  // name is what identifies the issuer, not the product code inside it.
  //
  // It reads a match for a name too, and it HAS to: `ant` is an English word, this
  // class runs FIRST, and a name it swallowed would never reach the fallback below.
  // Measured: behind `sk-ant-` the same 194 names came back 188 destroyed, and with
  // the second reading on the fallback ALONE, 173 of those 188 were still destroyed
  // — this shape had already eaten them. Half the fix lives here.
  'anthropic-key': /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  // The FALLBACK of the `sk-` family: OpenAI's legacy and project keys, and any
  // other issuer that reuses the convention without a prefix of its own. So the
  // NAME here is a best guess over a refusal — a trade asserted as a declared limit
  // in the tests rather than left to be discovered by a reader.
  //
  // The refusal used to be CERTAIN, and that is the half this shape no longer
  // claims: `sk-` is a prefix a person also chooses, so a match here is read once
  // more by {@link readsAsAChosenName} before it is destroyed. What falsified the
  // old wording was a name, not a key — `sk-check-the-tenant-scope-first` came back
  // out of the record as `<SECRET:openai-key>`.
  'openai-key': /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  'stripe-key': /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
  'slack-token': /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  // No trailing `\b`: a key one character longer than the issuer's current
  // length would otherwise stop matching, which is the failure mode the
  // minimum-length rule exists to avoid.
  'google-api-key': /\bAIza[0-9A-Za-z_-]{30,}/g,
  'npm-token': /\bnpm_[A-Za-z0-9]{36,}\b/g,
  jwt: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // The WHOLE block when it is closed, so the key material goes with the header.
  // The closing half is optional on purpose: a truncated paste with no END marker
  // would otherwise match nothing at all, and losing the header too is strictly
  // worse than losing only the body. What that costs is stated as a limit rather
  // than hidden — an unclosed block leaves its body in the text.
  'private-key-block': new RegExp(
    '-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----' +
      String.raw`(?:[\s\S]{0,${PEM_BODY_SPAN}}?-----END (?:[A-Z ]+ )?PRIVATE KEY-----)?`,
    'g',
  ),
  // The password half of `scheme://user:PASSWORD@host`, and only that half: the
  // scheme, the user and the host are the context that makes the record useful,
  // so they survive. The context is a LOOKBEHIND rather than a capture group,
  // which is what makes the match the secret itself.
  //
  // The `(?!<SECRET:)` is what keeps this shape from matching its OWN
  // placeholder. It is the only class whose shape is "whatever sits in this
  // position", so a cleaned URL still has something in the password slot — and
  // without the guard the detector would report a credential in text it had
  // already cleaned. That matters most for the audit, which reads the same
  // detector: every scrubbed record would show up in it forever, and a report that
  // always fires is a report nobody reads.
  'url-password': /(?<=\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)(?!<SECRET:)[^\s/@]{3,}(?=@)/g,
};

/**
 * Whether a person choosing a NAME could plausibly land on this class's prefix, so a
 * match under it is read a second time before it is destroyed.
 *
 * A mapped record over {@link SecretClass} for the reason `SHAPES` is one: a class
 * added to the list does not compile until it answers. The answer is not cosmetic —
 * `false` here means a name written under that prefix is destroyed, permanently, by a
 * record that cannot be edited.
 *
 * THE TWO `true` ENTRIES ARE THE `sk-` FAMILY, AND THE LINE IS MEASURED. Two other
 * shapes admit slug punctuation in their body and will swallow a name written under
 * their prefix: over the same 194 names, `slack-token` destroyed 191 of them behind
 * `xoxb-` and `google-api-key` destroyed them behind `AIza`. Both stay `false`,
 * because the trade runs the other way there. `sk` is an English abbreviation of this
 * product's own verb and `ant` is an English word; `xoxb` and `AIza` are invented
 * tokens that are nobody's word, and no name among the 194 begins with either. So
 * relaxing those two would give up coverage of a real issuer to rescue a name that
 * does not exist. Both limits are pinned BY NAME in `secrets.test.ts`, in the probe
 * table that walks this list, so changing one is a deliberate act and not a drift.
 *
 * IT IS NOT EXPORTED AT ALL, and neither is the rule it gates. Nothing outside asks
 * which prefixes are ambiguous, and a consumer able to import either could keep a
 * second opinion about what counts as a name. The module boundary is what makes that
 * impossible rather than merely discouraged — there is no declaration here for a
 * surface sweep to check, because there is nothing exported for it to find.
 */
const A_NAME_COULD_WEAR_THIS_PREFIX: { readonly [K in SecretClass]: boolean } = {
  'aws-access-key': false,
  'github-token': false,
  'anthropic-key': true,
  'openai-key': true,
  'stripe-key': false,
  'slack-token': false,
  'google-api-key': false,
  'npm-token': false,
  jwt: false,
  'private-key-block': false,
  'url-password': false,
};

/** One piece of a name, cut at the punctuation a slug is written with. */
const NAME_WORD = /^[a-z]+$/;

/**
 * The same piece, carrying the number people version and count things with: `v2`,
 * `17`, `2026`, `p1`. Four letters at most before the digits, which is what keeps a
 * long mixed token — the shape every real key body has — from reading as one word.
 */
const NAME_NUMBERED_WORD = /^[a-z]{0,4}[0-9]{1,4}$/;

/** The punctuation a slug is written with, and the only thing a name is cut at. */
const NAME_SEPARATOR = /[-_]/;

/**
 * Whether `value` reads as a name a person chose rather than a credential.
 *
 * THE CRITERION. A credential has to be unguessable, so its body is drawn from a
 * dense alphabet at length; a name has to be sayable, so it is WORDS. A value is a
 * name when every piece of it, cut at the separators a slug uses, is a lowercase word
 * — optionally carrying a short number, which is how people version and number
 * things. Nothing here looks at the prefix: `sk` is itself a word, so the whole match
 * is asked the one question and no prefix has to be stripped off first.
 *
 * MEASURED ON BOTH SIDES, because tightening the shape risks letting a real key
 * through and leaving it risks going on destroying names — the tension is the whole
 * of the decision, so it was answered with counts. LEFT: the 194 directory and branch
 * names this repository's own work produced, under six spellings (plain, versioned,
 * ADR-numbered, underscored, camelCase, year-suffixed). RIGHT: 20,000 random draws
 * from each of 13 key formats their issuers define — OpenAI legacy at 48 and at 32
 * characters and with the `T3BlbkFJ` infix, OpenAI project, service-account and admin
 * keys, both Anthropic product codes, DeepSeek's 32 hex, OpenRouter's `sk-or-v1-`,
 * Moonshot, a generic OpenAI-compatible range, and a UUID-shaped one.
 *
 *   names destroyed   173/194 → 0/194   in five of the six spellings
 *   keys escaping     0 of 260,000, in every one of the 13 formats
 *
 * Four other criteria were run over the same two corpora and are rejected by the
 * number, not by taste. "A hyphen anywhere means a name" lets 160,000 of 300,000
 * keys through — every project key, every Anthropic key, every OpenRouter key.
 * "No hyphen-free run of twenty or more means a name" lets every UUID-shaped key
 * through, and it also let a handful of REAL base64url keys through at random,
 * because `-` and `_` are in that alphabet: a coverage that turns on a coin toss is
 * worse than a coverage that is merely narrower.
 *
 * WHAT THE CUT COSTS, as a number rather than a shrug. A name carrying a CAPITAL is
 * still destroyed — 139 of the 194 written in camelCase — and that is deliberate: an
 * uppercase letter is the mark of the dense alphabet every real key here is drawn
 * from, and rescuing camelCase would give up the OpenAI legacy format entirely. And a
 * hypothetical key drawn from a LOWERCASE-ONLY alphabet now reads as a name, 20,000
 * of 20,000 draws. No issuer among the 13 mints one; that is the whole of the
 * evidence for the cut, and it is a measurement rather than a proof.
 *
 * Held by `secrets.test.ts`: the differential there runs both corpora and asserts the
 * counts on both sides, and the probe table beside it pins which prefixes this rule
 * is reached from. Its cost is asserted there too — this runs only on a value that
 * already matched, so a clean field never reaches it.
 */
function readsAsAChosenName(value: string): boolean {
  for (const segment of value.split(NAME_SEPARATOR)) {
    if (!NAME_WORD.test(segment) && !NAME_NUMBERED_WORD.test(segment)) return false;
  }
  return true;
}

/** Text with every recognized credential replaced, and what was taken out of it. */
export interface ScrubbedText {
  /** The text as it will be recorded. */
  readonly text: string;
  /**
   * One entry per value replaced, in the order the classes were applied. Empty
   * when the text was already clean — and then {@link ScrubbedText.text} is the
   * input, unchanged and not rebuilt.
   */
  readonly replaced: readonly SecretClass[];
}

/**
 * Replaces every recognized credential in `text` with its typed placeholder.
 *
 * Each pattern runs over the output of the previous one, so a text carrying two
 * different classes comes back with both replaced. Nothing is allocated when the
 * text is clean, which is the overwhelmingly common case — the whole pass costs
 * about two microseconds on a typical record.
 */
export function scrubSecrets(text: string): ScrubbedText {
  let out = text;
  let replaced: SecretClass[] | undefined;
  for (const secret of SECRET_CLASSES) {
    const pass = scrubWith(out, secret, SHAPES[secret]);
    if (pass.replaced.length === 0) continue;
    out = pass.text;
    replaced = replaced === undefined ? [...pass.replaced] : [...replaced, ...pass.replaced];
  }
  return replaced === undefined ? { text, replaced: [] } : { text: out, replaced };
}

/**
 * The CLASSES of credential `text` contains — never the values.
 *
 * This is what an audit of the existing record reads, and the return type is the
 * whole of the defense there: a report that listed credentials it found would
 * turn the remedy into a second disclosure (a CI log, a terminal scrollback, a
 * screenshot). Returning classes means no caller CAN print the value, which is a
 * stronger guarantee than every caller remembering not to.
 *
 * It answers by scrubbing and discarding the result rather than matching
 * separately, so what an audit reports and what a write would have removed can
 * never disagree. The wasted string is the price of that agreement, and an audit
 * is a read a person runs, not a hot path.
 */
export function detectSecrets(text: string): readonly SecretClass[] {
  return scrubSecrets(text).replaced;
}

/**
 * One class's pass over the text, under the shape that class is recognized by.
 * Returns the input untouched when nothing matched, so a clean field costs a scan
 * and no allocation.
 *
 * A match under a prefix {@link A_NAME_COULD_WEAR_THIS_PREFIX} calls ambiguous is
 * asked once more, by {@link readsAsAChosenName}, and carried through untouched when
 * it reads as a name. That question is asked HERE and nowhere else: it is one rule,
 * so a class that becomes ambiguous tomorrow inherits it by answering the table.
 *
 * The shape's `lastIndex` is reset before the scan: these are module-level
 * regexes with the global flag, and a previous partial scan would otherwise make
 * the next call start in the middle of the text. The zero-length guard cannot
 * trigger for any pattern here (each requires literal characters) and is there so
 * a future one cannot turn into an endless loop.
 */
function scrubWith(text: string, secret: SecretClass, re: RegExp): ScrubbedText {
  re.lastIndex = 0;
  let match = re.exec(text);
  if (match === null) return { text, replaced: [] };

  const ambiguous = A_NAME_COULD_WEAR_THIS_PREFIX[secret];
  const parts: string[] = [];
  const replaced: SecretClass[] = [];
  let copied = 0;
  while (match !== null) {
    if (match[0].length === 0) {
      re.lastIndex += 1;
      match = re.exec(text);
      continue;
    }
    // The second reading, and the only place it happens. Skipping the match leaves
    // `copied` where it was, so the value is carried through by the next slice —
    // byte for byte, which is what "the name the person chose" has to mean.
    if (ambiguous && readsAsAChosenName(match[0])) {
      match = re.exec(text);
      continue;
    }
    parts.push(text.slice(copied, match.index), secretPlaceholder(secret));
    replaced.push(secret);
    copied = match.index + match[0].length;
    match = re.exec(text);
  }
  if (replaced.length === 0) return { text, replaced: [] };
  parts.push(text.slice(copied));
  return { text: parts.join(''), replaced };
}
