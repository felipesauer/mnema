import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _internal, InitCommand } from '@/cli/commands/init-command.js';
import { ErrorCode } from '@/errors/error-codes.js';

describe('InitCommand.run (silent mode)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-init-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('writes mnema.config.json with the supplied fields', () => {
    const result = new InitCommand().run({
      cwd: projectRoot,
      name: 'My App',
      key: 'MYAPP',
      workflow: 'default',
      force: false,
      minimal: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const config = JSON.parse(readFileSync(result.value.configPath, 'utf-8')) as Record<
      string,
      unknown
    >;
    expect((config.project as { key: string }).key).toBe('MYAPP');
    expect((config.project as { name: string }).name).toBe('My App');
    expect(config.workflow).toBe('default');
    expect(existsSync(path.join(projectRoot, '.mnema', 'state', 'state.db'))).toBe(true);
  });

  it('refuses to overwrite an existing config without --force', () => {
    const command = new InitCommand();
    command.run({
      cwd: projectRoot,
      name: 'X',
      key: 'X1',
      workflow: 'default',
      force: false,
      minimal: false,
    });

    const second = command.run({
      cwd: projectRoot,
      name: 'X',
      key: 'X1',
      workflow: 'default',
      force: false,
      minimal: false,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe(ErrorCode.AlreadyInitialized);
  });

  it('rejects an invalid project key', () => {
    const result = new InitCommand().run({
      cwd: projectRoot,
      name: 'X',
      key: 'lowercase',
      workflow: 'default',
      force: false,
      minimal: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.ConfigInvalid);
  });
});

describe('InitCommand wizard helpers', () => {
  it('derives a project key from a multi-word name', () => {
    expect(_internal.deriveKey('My Web App')).toBe('MYWEBA');
  });

  it('strips diacritics and punctuation', () => {
    expect(_internal.deriveKey('Açaí — Backend')).toBe('ACAIBA');
  });

  it('returns undefined when the name has no usable letters', () => {
    expect(_internal.deriveKey('?? !!')).toBeUndefined();
  });
});
