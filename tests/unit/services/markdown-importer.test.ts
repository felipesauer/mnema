import { describe, expect, it } from 'vitest';

import { MarkdownImporter } from '@/services/importers/markdown-importer.js';

describe('MarkdownImporter.parse', () => {
  it('extracts a task per `##` heading and keeps the heading verbatim', () => {
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
    // Importer is intentionally state-blind: the leading uppercase
    // token stays in the title rather than being parsed as a workflow
    // state.
    expect(first?.title).toBe('DRAFT Implement OAuth');
    expect(first?.acceptanceCriteria).toEqual(['Users can authenticate', 'Token persists']);
    expect(first?.description).toBe('Add Google OAuth flow.');
    expect(second?.title).toBe('TODO Refactor session middleware');
  });

  it('handles plain headings without a leading uppercase token', () => {
    const md = '## Improve dashboard latency\n\nMore detail.\n';
    const tasks = MarkdownImporter.parse(md, 'inline');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe('Improve dashboard latency');
  });

  it('joins multiple paragraphs into the description', () => {
    const md = [
      '## Audit auth',
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
    const md = ['Some preamble that is not a task.', '', '## One', 'body'].join('\n');
    const tasks = MarkdownImporter.parse(md, 'inline');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe('One');
  });
});
