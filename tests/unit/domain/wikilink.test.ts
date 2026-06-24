import { describe, expect, it } from 'vitest';

import { extractWikilinks } from '@/domain/wikilink.js';

describe('extractWikilinks', () => {
  it('returns empty for a body with no wikilinks', () => {
    expect(extractWikilinks('plain text, no links here')).toEqual([]);
  });

  it('extracts a single bare wikilink', () => {
    const links = extractWikilinks('see [[safe-migration]] for details');
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({ slug: 'safe-migration', anchor: null, raw: '[[safe-migration]]' });
  });

  it('extracts a wikilink with an anchor', () => {
    const links = extractWikilinks('see [[architecture#caching]]');
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      slug: 'architecture',
      anchor: 'caching',
      raw: '[[architecture#caching]]',
    });
  });

  it('extracts multiple wikilinks in document order', () => {
    const links = extractWikilinks('[[a]] then [[b#x]] then [[c]]');
    expect(links.map((l) => l.slug)).toEqual(['a', 'b', 'c']);
    expect(links[1]?.anchor).toBe('x');
  });

  it('trims whitespace inside the brackets', () => {
    const links = extractWikilinks('[[  spaced-slug  ]]');
    expect(links[0]?.slug).toBe('spaced-slug');
  });

  it('skips an empty slug', () => {
    expect(extractWikilinks('[[]] and [[   ]]')).toEqual([]);
  });

  it('preserves duplicate references', () => {
    const links = extractWikilinks('[[same]] and again [[same]]');
    expect(links).toHaveLength(2);
  });

  it('keys with hyphens and uppercase (e.g. MNEMA-ADR-13) parse as the slug', () => {
    const links = extractWikilinks('superseded by [[MNEMA-ADR-14]]');
    expect(links[0]?.slug).toBe('MNEMA-ADR-14');
  });

  it('captures the slug when the anchor is empty (trailing #)', () => {
    const links = extractWikilinks('see [[other-skill#]] here');
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({ slug: 'other-skill', anchor: null, raw: '[[other-skill#]]' });
  });

  it('still parses later links on a line that has a trailing-# link', () => {
    const links = extractWikilinks('[[a#]] and [[b]]');
    expect(links.map((l) => l.slug)).toEqual(['a', 'b']);
  });

  it('extracts the clean inner slug from extra leading brackets', () => {
    const links = extractWikilinks('see [[[other-skill]]] for context');
    expect(links).toHaveLength(1);
    expect(links[0]?.slug).toBe('other-skill');
    expect(links[0]?.slug).not.toContain('[');
    expect(links[0]?.raw).toBe('[[other-skill]]');
  });

  it('handles quadruple brackets without corrupting the slug', () => {
    const links = extractWikilinks('[[[[slug]]]]');
    expect(links[0]?.slug).toBe('slug');
    expect(links[0]?.slug).not.toContain('[');
  });
});
