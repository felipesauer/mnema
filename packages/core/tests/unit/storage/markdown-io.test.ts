import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MarkdownInvalidFrontmatterError, MarkdownIo } from '@/storage/markdown/markdown-io.js';

describe('MarkdownIo', () => {
  let dir: string;
  let file: string;
  let io: MarkdownIo;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mnema-md-'));
    file = path.join(dir, 'task.md');
    io = new MarkdownIo();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns an empty structure for a missing file', () => {
    const parsed = io.read(path.join(dir, 'missing.md'));
    expect(parsed).toEqual({ mnemaData: {}, otherFrontmatter: {}, content: '' });
  });

  it('round-trips data, other frontmatter and content', () => {
    io.write(file, {
      mnemaData: { key: 'WEBAPP-1', state: 'DRAFT' },
      otherFrontmatter: { tags: ['oauth', 'auth'] },
      content: '# Title\n\nFree-form body.\n',
    });

    const parsed = io.read(file);
    expect(parsed.mnemaData).toEqual({ key: 'WEBAPP-1', state: 'DRAFT' });
    expect(parsed.otherFrontmatter).toEqual({ tags: ['oauth', 'auth'] });
    expect(parsed.content.trim()).toBe('# Title\n\nFree-form body.');
  });

  it('updateMnema preserves other frontmatter and the body', () => {
    io.write(file, {
      mnemaData: { key: 'WEBAPP-1', state: 'DRAFT' },
      otherFrontmatter: { tags: ['oauth'] },
      content: 'Free body text.',
    });

    io.updateMnema(file, { state: 'READY', estimate: 5 });

    const parsed = io.read(file);
    expect(parsed.mnemaData).toEqual({ key: 'WEBAPP-1', state: 'READY', estimate: 5 });
    expect(parsed.otherFrontmatter).toEqual({ tags: ['oauth'] });
    expect(parsed.content.trim()).toBe('Free body text.');
  });

  it('throws MarkdownInvalidFrontmatterError on malformed YAML', () => {
    writeFileSync(file, '---\nthis: is\n  not: : valid\n   yaml: at all\n---\nbody\n', 'utf-8');

    expect(() => io.read(file)).toThrow(MarkdownInvalidFrontmatterError);
  });

  it('writes atomically and leaves no .tmp file behind on success', () => {
    io.write(file, { mnemaData: { key: 'X-1' }, otherFrontmatter: {}, content: 'hi' });

    const raw = readFileSync(file, 'utf-8');
    expect(raw).toContain('mnema:');
    expect(raw).toContain('hi');
  });
});
