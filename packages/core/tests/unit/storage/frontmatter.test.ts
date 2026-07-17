import { describe, expect, it } from 'vitest';

import { parseFrontmatter, stringifyFrontmatter } from '@/storage/markdown/frontmatter.js';

describe('parseFrontmatter', () => {
  it('parses YAML frontmatter into data and content', () => {
    const parsed = parseFrontmatter('---\ntitle: Home\ntags:\n  - a\n  - b\n---\nBody text.\n');
    expect(parsed.data).toEqual({ title: 'Home', tags: ['a', 'b'] });
    expect(parsed.content.trim()).toBe('Body text.');
  });

  it('returns empty data when there is no frontmatter', () => {
    const parsed = parseFrontmatter('Just a body, no frontmatter.\n');
    expect(parsed.data).toEqual({});
    expect(parsed.content.trim()).toBe('Just a body, no frontmatter.');
  });

  it('throws on malformed YAML instead of returning garbage', () => {
    expect(() => parseFrontmatter('---\n: : :\n  bad\n---\nbody')).toThrow();
  });

  it('refuses the JavaScript engine instead of evaluating code', () => {
    // A hostile file declares the `js` language after the delimiter, which
    // bare gray-matter would eval(). The hardened wrapper must throw.
    const malicious = '---js\nmodule.exports = { pwned: true }\n---\nbody';
    expect(() => parseFrontmatter(malicious)).toThrow(/JavaScript front-matter engine is disabled/);
  });

  it('does not evaluate a JS IIFE smuggled through the js language tag', () => {
    const malicious = "---js\n(function(){ throw new Error('executed') })()\n---\nbody";
    expect(() => parseFrontmatter(malicious)).toThrow(/JavaScript front-matter engine is disabled/);
  });

  it('rejects dangerous YAML tags (proves the js-yaml safe engine)', () => {
    // js-yaml 3.x would resolve `!!js/function`; 5.x (used here) is safe by
    // default and throws. This pins the CVE-2026-53550 fix in place.
    const malicious = '---\nfn: !!js/function "function(){ return 1 }"\n---\nbody';
    expect(() => parseFrontmatter(malicious)).toThrow();
  });
});

describe('stringifyFrontmatter', () => {
  it('round-trips through parseFrontmatter', () => {
    const out = stringifyFrontmatter('Body text.\n', { title: 'Home', tags: ['a'] });
    const parsed = parseFrontmatter(out);
    expect(parsed.data).toEqual({ title: 'Home', tags: ['a'] });
    expect(parsed.content.trim()).toBe('Body text.');
  });
});
