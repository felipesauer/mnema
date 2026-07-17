import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CommandDefinitionService } from '@/services/command-definition-service.js';

describe('CommandDefinitionService', () => {
  let root: string;
  let commandsDir: string;
  let service: CommandDefinitionService;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'mnema-commands-'));
    commandsDir = path.join(root, '.mnema', 'commands');
    mkdirSync(commandsDir, { recursive: true });
    service = new CommandDefinitionService(commandsDir);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeCommand(name: string, contents: string): void {
    writeFileSync(path.join(commandsDir, `${name}.md`), contents, 'utf-8');
  }

  it('discovers a well-formed command and its ordered steps', () => {
    writeCommand(
      'standup',
      [
        '---',
        'description: Bootstrap, inbox, and today',
        'steps:',
        '  - context bootstrap',
        '  - inbox',
        '  - history --since=today',
        '---',
        '# Standup',
        '',
        'Run at the start of the day.',
      ].join('\n'),
    );

    const { commands, skipped } = service.list();
    expect(skipped).toEqual([]);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      name: 'standup',
      description: 'Bootstrap, inbox, and today',
      steps: ['context bootstrap', 'inbox', 'history --since=today'],
    });
    expect(commands[0]?.body).toContain('Run at the start of the day.');
  });

  it('returns commands sorted by name', () => {
    writeCommand('zebra', '---\ndescription: z\nsteps:\n  - inbox\n---\n');
    writeCommand('alpha', '---\ndescription: a\nsteps:\n  - inbox\n---\n');
    expect(service.list().commands.map((c) => c.name)).toEqual(['alpha', 'zebra']);
  });

  it('skips a malformed command (missing steps) without dropping the rest', () => {
    writeCommand('good', '---\ndescription: fine\nsteps:\n  - inbox\n---\n');
    writeCommand('bad', '---\ndescription: no steps here\n---\n'); // steps missing

    const { commands, skipped } = service.list();
    expect(commands.map((c) => c.name)).toEqual(['good']);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.file).toBe('bad.md');
    expect(skipped[0]?.reason).toContain('steps');
  });

  it('skips a command whose steps are empty', () => {
    writeCommand('empty', '---\ndescription: d\nsteps: []\n---\n');
    const { commands, skipped } = service.list();
    expect(commands).toEqual([]);
    expect(skipped[0]?.file).toBe('empty.md');
  });

  it('ignores INDEX.md and non-markdown files', () => {
    writeCommand('real', '---\ndescription: d\nsteps:\n  - inbox\n---\n');
    writeFileSync(path.join(commandsDir, 'INDEX.md'), '# Commands index\n', 'utf-8');
    writeFileSync(path.join(commandsDir, 'notes.txt'), 'ignore me', 'utf-8');

    expect(service.list().commands.map((c) => c.name)).toEqual(['real']);
  });

  it('show returns a command by name, or null when unknown', () => {
    writeCommand('standup', '---\ndescription: d\nsteps:\n  - inbox\n---\n');
    expect(service.show('standup')?.name).toBe('standup');
    expect(service.show('nope')).toBeNull();
  });

  it('returns empty when the commands directory does not exist', () => {
    const bare = new CommandDefinitionService(path.join(root, 'does-not-exist'));
    expect(bare.list()).toEqual({ commands: [], skipped: [] });
  });
});
