import { describe, expect, it } from 'vitest';

import { extractWikilinks } from '@/domain/wikilink.js';

describe('extractWikilinks', () => {
  it('returns empty for a body with no wikilinks', () => {
    expect(extractWikilinks('plain text, no links here')).toEqual([]);
  });

  it('extracts a single bare wikilink', () => {
    const links = extractWikilinks('see [[safe-migration]] for details');
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      slug: 'safe-migration',
      anchor: null,
      alias: null,
      raw: '[[safe-migration]]',
    });
  });

  it('extracts a wikilink with an anchor', () => {
    const links = extractWikilinks('see [[architecture#caching]]');
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      slug: 'architecture',
      anchor: 'caching',
      alias: null,
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
    expect(links[0]).toEqual({
      slug: 'other-skill',
      anchor: null,
      alias: null,
      raw: '[[other-skill#]]',
    });
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

  it('resolves the slug and captures the alias for [[slug|Label]] (Obsidian alias)', () => {
    const links = extractWikilinks('see [[real-slug|Display Text]] here');
    expect(links).toHaveLength(1);
    // The slug is the target; before the fix it was 'real-slug|Display Text'.
    expect(links[0]?.slug).toBe('real-slug');
    expect(links[0]?.slug).not.toContain('|');
    expect(links[0]?.alias).toBe('Display Text');
    expect(links[0]?.raw).toBe('[[real-slug|Display Text]]');
  });

  it('captures slug, anchor, and alias together ([[slug#anchor|alias]])', () => {
    const links = extractWikilinks('[[architecture#caching|the cache section]]');
    expect(links[0]).toEqual({
      slug: 'architecture',
      anchor: 'caching',
      alias: 'the cache section',
      raw: '[[architecture#caching|the cache section]]',
    });
  });

  it('treats an empty alias ([[slug|]]) as null', () => {
    const links = extractWikilinks('[[a|]]');
    expect(links[0]?.slug).toBe('a');
    expect(links[0]?.alias).toBeNull();
  });

  it('skips a link with an empty slug before the pipe ([[|b]])', () => {
    expect(extractWikilinks('[[|b]]')).toEqual([]);
  });

  it('takes the first pipe as the separator, alias keeps the rest ([[a|b|c]])', () => {
    const links = extractWikilinks('[[a|b|c]]');
    expect(links[0]?.slug).toBe('a');
    expect(links[0]?.alias).toBe('b|c');
  });
});
