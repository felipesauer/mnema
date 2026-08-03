import { ANCHOR_PREFIX } from '@mnema/chain';
import { describe, expect, it } from 'vitest';
import { resolveExecutingAgent } from './authority.js';

/**
 * The authority invariant, and the spelling that used to walk past it.
 *
 * `who` is the identity that authorized; `which` is the agent that executed. They
 * must differ, and the check compared exact strings — which was enough for exactly
 * as long as an identity had one spelling. Since the reads began printing anchors
 * SHORT (`mnid:b6f3ce0d`, a prefix of the value, checkable and pasteable by design),
 * an identity has two, and only the long one was refused. So `--which mnid:b6f3ce0d`
 * passed as an ordinary agent name and stamped the authorizer's own identity into
 * the slot that exists to say somebody ELSE did the work — the one field whose whole
 * purpose is that separation.
 *
 * The rule is stated in terms of what the surfaces PRINT: any prefix of `who` that
 * carries the anchor scheme is that identity written short. The scheme is required
 * so the refusal is deterministic — a bare `m` is a prefix of every anchor there is,
 * and refusing it would refuse a one-letter agent name on some machines and not
 * others, depending on the local anchor's hex.
 */

/** A realistic anchor: the scheme and sixty-four hex characters. */
const WHO = `${ANCHOR_PREFIX}b6f3ce0d${'a'.repeat(56)}`;

describe('the executing agent is never the authorizing identity', () => {
  it('refuses the anchor written in full', () => {
    expect(resolveExecutingAgent(WHO, WHO)).toMatchObject({ ok: false, code: 'WHO_IS_WHICH' });
  });

  it('refuses the anchor written SHORT, at every length a read could print', () => {
    // The reads shorten to eight hex characters and lengthen only on a clash, so
    // every length from the bare scheme up to the full value is a form that can come
    // off a screen and back into a flag.
    for (let length = ANCHOR_PREFIX.length; length <= WHO.length; length += 1) {
      const short = WHO.slice(0, length);
      expect(resolveExecutingAgent(WHO, short), short).toMatchObject({
        ok: false,
        code: 'WHO_IS_WHICH',
      });
    }
  });

  it('refuses the short form with the padding a paste brings along', () => {
    // The value is canonicalized before the comparison (NFC and trim), so a form
    // pasted with a stray space is the same claim and earns the same refusal.
    expect(resolveExecutingAgent(WHO, `  ${ANCHOR_PREFIX}b6f3ce0d  `)).toMatchObject({
      ok: false,
      code: 'WHO_IS_WHICH',
    });
  });

  it('still accepts an honest agent name, including one that shares leading letters', () => {
    // The half that keeps the rule from being a ban on names. None of these claims
    // to be an anchor, so none is the authorizer written short — and `mnid` without
    // the colon is not the scheme.
    for (const name of ['claude', 'ci-runner', 'm', 'mn', 'mnid', 'b6f3ce0d', 'mnemosyne']) {
      expect(resolveExecutingAgent(WHO, name), name).toMatchObject({ ok: true, which: name });
    }
  });

  it('accepts an anchor that is NOT this authorizer, short or long', () => {
    // A prefix of some OTHER identity is a different identity, and this invariant is
    // about self-authorization only. Whether an agent should ever be named after
    // another anchor is a separate question, and not one this check answers.
    const other = `${ANCHOR_PREFIX}0123abcd${'f'.repeat(56)}`;
    expect(resolveExecutingAgent(WHO, other)).toMatchObject({ ok: true, which: other });
    expect(resolveExecutingAgent(WHO, `${ANCHOR_PREFIX}0123abcd`)).toMatchObject({ ok: true });
  });

  it('keeps refusing an exact match when `who` is not anchor-shaped', () => {
    // The prefix rule is an ADDITION. The gate is handed a `who` from its caller,
    // and a test or a future surface may hand it something that is not an anchor at
    // all; the original equality check still has to hold there.
    expect(resolveExecutingAgent('alice', 'alice')).toMatchObject({
      ok: false,
      code: 'WHO_IS_WHICH',
    });
    // And a prefix of THAT is not refused: without the scheme there is no claim to
    // be the identity, so `ali` is just a name.
    expect(resolveExecutingAgent('alice', 'ali')).toMatchObject({ ok: true, which: 'ali' });
  });

  it('reads a `which` that names nobody as no agent at all', () => {
    // Unchanged, and worth pinning next to the new rule: an empty or whitespace-only
    // value is not an agent, so it drops off the envelope rather than being compared.
    for (const nobody of ['', '   ', undefined, 42]) {
      expect(resolveExecutingAgent(WHO, nobody)).toEqual({ ok: true, replaced: [] });
    }
  });
});
