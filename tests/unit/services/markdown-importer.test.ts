import { describe, expect, it } from 'vitest';

import { MarkdownImporter } from '@/services/importers/markdown-importer.js';

describe('MarkdownImporter.parse', () => {
  it('extracts a task per `##` heading', () => {
    const md = [
      '## DRAFT Implement OAuth',
      '',
      'Add Google OAuth flow.',
      '',
      '- Users can authenticate',
      '- Token persists',
      '',
      '## TODO Refactor session middleware',
      '',
      'Reescrever a camada.',
    ].join('\n');

    const tasks = MarkdownImporter.parse(md, 'TODO.md');
    expect(tasks).toHaveLength(2);
    const [first, second] = tasks;
    expect(first?.title).toBe('Implement OAuth');
    expect(first?.state).toBe('DRAFT');
    expect(first?.acceptanceCriteria).toEqual(['Users can authenticate', 'Token persists']);
    expect(first?.description).toBe('Add Google OAuth flow.');
    expect(second?.title).toBe('Refactor session middleware');
    expect(second?.state).toBe('TODO');
  });

  it('keeps the heading verbatim when there is no UPPERCASE state prefix', () => {
    const md = '## Improve dashboard latency\n\nMore detail.\n';
    const tasks = MarkdownImporter.parse(md, 'inline');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe('Improve dashboard latency');
    expect(tasks[0]?.state).toBeNull();
  });

  it('joins multiple paragraphs into the description', () => {
    const md = [
      '## DRAFT Audit auth',
      '',
      'First paragraph spanning',
      'two lines.',
      '',
      'Second paragraph.',
      '',
      '- Done',
    ].join('\n');
    const tasks = MarkdownImporter.parse(md, 'inline');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.description).toBe('First paragraph spanning two lines.\n\nSecond paragraph.');
    expect(tasks[0]?.acceptanceCriteria).toEqual(['Done']);
  });

  it('ignores lines before the first heading', () => {
    const md = ['Some preamble that is not a task.', '', '## DRAFT One', 'body'].join('\n');
    const tasks = MarkdownImporter.parse(md, 'inline');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe('One');
  });
});
