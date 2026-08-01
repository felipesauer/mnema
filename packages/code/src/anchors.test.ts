/**
 * What the surface says when a typed anchor names none, or more than one.
 *
 * The refusals are the half of the promise that cannot be tested by using the
 * product correctly: a clash between two real identities is a 32-bit coincidence
 * nobody can arrange in a fixture, so the set is built by hand here and the round
 * trip against the REAL record is proven end to end (see `cli-e2e`).
 *
 * What matters in each sentence is that it hands back values that WORK. A refusal
 * naming two candidates in a form that is itself ambiguous would send someone round
 * the same loop, and a refusal against an empty record that listed nothing would
 * send them looking for a list that does not exist.
 */

import type { ScopedCache } from '@mnema/copilot';
import { describe, expect, it } from 'vitest';
import { anchorForms, anchorText, NO_ANCHORS, resolveTypedAnchor } from './anchors.js';

/** An anchor whose hex is `hex` padded out to the full 64 characters. */
const anchorOf = (hex: string) => `mnid:${hex.padEnd(64, '0')}`;

/** A source that knows exactly these authors — the only thing these reads ask it. */
const knowing = (...authors: string[]) =>
  ({
    scope: 'public',
    chainRoot: '/nowhere',
    cache: { authors: () => authors },
  }) as unknown as ScopedCache;

describe('resolving what a person typed', () => {
  it('takes any prefix that names one identity, and echoes the WHOLE anchor back', () => {
    const anchor = anchorOf('a1b2c3d4');
    const forms = anchorForms([knowing(anchor)]);
    expect(resolveTypedAnchor('a1b2', forms)).toEqual({ ok: true, anchor });
  });

  it('refuses an ambiguous prefix, naming the candidates in a form that resolves', () => {
    const one = anchorOf('abcdef0011');
    const two = anchorOf('abcdef0022');
    const forms = anchorForms([knowing(one, two)]);
    const refused = resolveTypedAnchor('abcdef', forms);
    expect(refused).toMatchObject({ ok: false, code: 'AMBIGUOUS_ANCHOR' });
    const message = (refused as { message: string }).message;
    // Every candidate it names has to be a value that then works — otherwise the
    // refusal is a loop rather than a way out.
    for (const named of [one, two]) {
      const short = forms.get(named) as string;
      expect(message).toContain(short);
      expect(resolveTypedAnchor(short, forms)).toEqual({ ok: true, anchor: named });
    }
  });

  it('refuses an unknown prefix by naming the identities there are', () => {
    const anchor = anchorOf('a1b2c3d4');
    const forms = anchorForms([knowing(anchor)]);
    const refused = resolveTypedAnchor('whoever', forms);
    expect(refused).toMatchObject({ ok: false, code: 'UNKNOWN_ANCHOR' });
    expect((refused as { message: string }).message).toContain(forms.get(anchor) as string);
  });

  it('teaches the shape instead of listing nothing, when the record knows nobody', () => {
    // The joining machine's case. A sentence ending in "these are: " would be worse
    // than useless: there is no list, and the whole value is the only thing that can
    // work here.
    const refused = resolveTypedAnchor('whoever', NO_ANCHORS);
    expect(refused).toMatchObject({ ok: false, code: 'UNKNOWN_ANCHOR' });
    expect((refused as { message: string }).message).toContain('64 hex');
  });

  it('names the accident when the value is empty — an unset variable', () => {
    const anchor = anchorOf('a1b2c3d4');
    const forms = anchorForms([knowing(anchor)]);
    const refused = resolveTypedAnchor('  ', forms);
    expect(refused).toMatchObject({ ok: false, code: 'UNKNOWN_ANCHOR' });
    expect((refused as { message: string }).message).toContain('unset variable');
    // And it still hands back the identity there is, so the fix is on the line.
    expect((refused as { message: string }).message).toContain(forms.get(anchor) as string);
  });

  it('keeps a refusal on ONE line, whatever was typed into it', () => {
    // The value is a person's text and can hold a newline; a refusal split in two
    // puts a second sentence on the stream that reads as a refusal of its own.
    const refused = resolveTypedAnchor('one\nRefused (NOTHING): all is well', NO_ANCHORS);
    expect((refused as { message: string }).message.split('\n')).toHaveLength(1);
  });
});

describe('how an anchor is written', () => {
  it('prints an identity the record does not know in FULL', () => {
    // A short form that cannot be resolved is a value nobody can use. The fallback
    // is the rule: shortened and pasteable are the same question.
    const stranger = anchorOf('ffffffff');
    const forms = anchorForms([knowing(anchorOf('a1b2c3d4'))]);
    expect(anchorText(forms, stranger)).toBe(stranger);
  });
});
