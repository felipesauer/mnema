/**
 * `src/commands/doctor-vscode.ts` — the one edit `mnema doctor --fix vscode` makes to a person's
 * `settings.json`. The file is JSONC, so the cases are the shapes a real one has: comments, a
 * trailing comma, the key absent, the key present with a stale entry. What is asserted is the
 * TEXT that comes out — every comment still there, and the file still reading — and that a second
 * run changes nothing.
 */

import { describe, expect, it } from 'vitest';
import { planFix, readLocations, settingsCandidates } from '../src/commands/doctor-vscode.js';

const WANTED = '/home/p/.claude/plugins/marketplaces/mnema/plugin';
const OLD = '/home/p/.claude/plugins/cache/mnema/mnema/0.0.9';

/** An independent reading of JSONC: comments and trailing commas out, then JSON. */
function jsonOf(text: string): Record<string, unknown> {
  const bare = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/(\s)\/\/[^\n"]*$/gm, '$1')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(bare) as Record<string, unknown>;
}

function changed(text: string, stale: string[] = []): string {
  const plan = planFix(text, WANTED, stale);
  if (plan.kind !== 'change') throw new Error(`expected a change, got ${plan.kind}`);
  return plan.text;
}

describe('adding the setting', () => {
  it('to a file with comments and a trailing comma, keeping every comment', () => {
    const before = [
      '{',
      '    // my font',
      '    "editor.fontSize": 14, // big',
      '    /* the theme */',
      '    "workbench.colorTheme": "Dark+",',
      '}',
      '',
    ].join('\n');
    const after = changed(before);
    expect(after).toContain('// my font');
    expect(after).toContain('"editor.fontSize": 14, // big');
    expect(after).toContain('/* the theme */');
    expect(jsonOf(after)).toEqual({
      'editor.fontSize': 14,
      'workbench.colorTheme': 'Dark+',
      'chat.pluginLocations': { [WANTED]: true },
    });
    expect(after.startsWith(before.slice(0, before.indexOf('\n}')))).toBe(true);
  });

  it('to a file whose last member has no comma, adding the one it needs', () => {
    const after = changed('{\n  "a": 1 // last\n}\n');
    expect(after).toContain('"a": 1, // last');
    expect(jsonOf(after)).toEqual({ a: 1, 'chat.pluginLocations': { [WANTED]: true } });
  });

  it('to an empty file, to one with only comments, and to {}', () => {
    expect(jsonOf(changed(''))).toEqual({ 'chat.pluginLocations': { [WANTED]: true } });
    const commented = changed('// nothing yet\n');
    expect(commented.startsWith('// nothing yet\n')).toBe(true);
    expect(jsonOf(commented)).toEqual({ 'chat.pluginLocations': { [WANTED]: true } });
    expect(jsonOf(changed('{}'))).toEqual({ 'chat.pluginLocations': { [WANTED]: true } });
  });

  it('with the line endings the file already has', () => {
    const after = changed('{\r\n  "a": 1\r\n}\r\n');
    expect(after.replace(/\r\n/g, '')).not.toContain('\n');
  });
});

describe('the setting is already there', () => {
  it('adds the entry beside the person’s own, and keeps their comment', () => {
    const before = [
      '{',
      '  "chat.pluginLocations": {',
      '    // my own plugin',
      '    "/home/p/my-plugin": true,',
      '  },',
      '}',
    ].join('\n');
    const after = changed(before);
    expect(after).toContain('// my own plugin');
    expect(jsonOf(after)['chat.pluginLocations']).toEqual({
      '/home/p/my-plugin': true,
      [WANTED]: true,
    });
  });

  it('drops the stale entry the doctor names and leaves the rest', () => {
    const before = [
      '{',
      '  "chat.pluginLocations": {',
      `    "${OLD}": true, // the old one`,
      '    "/home/p/mine": true',
      '  }',
      '}',
      '',
    ].join('\n');
    const after = changed(before, [OLD]);
    expect(after).not.toContain(OLD);
    expect(jsonOf(after)['chat.pluginLocations']).toEqual({
      '/home/p/mine': true,
      [WANTED]: true,
    });
  });

  it('leaves an entry the person set to false as it is', () => {
    expect(planFix(`{ "chat.pluginLocations": { "${WANTED}": false } }`, WANTED, []).kind).toBe(
      'unchanged',
    );
  });

  it('is idempotent: the second run has nothing to change', () => {
    const once = changed('{\n  // c\n  "a": 1,\n}\n', []);
    expect(planFix(once, WANTED, [OLD]).kind).toBe('unchanged');
  });
});

describe('what it refuses', () => {
  it.each([
    ['a comment that never closes', '{ /* "a": 1 }'],
    ['a file that is an array', '[1, 2]'],
    ['text after the object', '{ "a": 1 } extra'],
    ['a string that never closes', '{ "a: 1 }'],
    ['the setting twice', `{ "chat.pluginLocations": {}, "chat.pluginLocations": {} }`],
    ['the setting as something else', '{ "chat.pluginLocations": "~/x" }'],
  ])('%s', (_name, text) => {
    expect(planFix(text, WANTED, []).kind).toBe('refused');
  });

  it('an entry to drop that shares its line with another member', () => {
    const text = `{ "chat.pluginLocations": { "${OLD}": true, "/x": true } }`;
    expect(planFix(text, WANTED, [OLD]).kind).toBe('refused');
  });
});

describe('reading the setting', () => {
  it('says absent, says each entry and whether it is on, and says why it cannot read', () => {
    expect(readLocations('{ "a": 1 }')).toEqual({ kind: 'no-setting' });
    expect(
      readLocations('{ // c\n "chat.pluginLocations": { "/a": true, "/b": false, "/c": 1, }, }'),
    ).toEqual({
      kind: 'setting',
      entries: [
        { key: '/a', on: true },
        { key: '/b', on: false },
        { key: '/c', on: undefined },
      ],
    });
    expect(readLocations('{ /* ').kind).toBe('unreadable');
  });
});

describe('where the file is, from the home it is given', () => {
  it('names the snap’s old place and its new one, the Mac’s and Windows’', () => {
    const linux = settingsCandidates('/h', 'linux', {});
    expect(linux).toContain('/h/.config/Code/User/settings.json');
    expect(linux).toContain('/h/snap/code/current/.config/Code/User/settings.json');
    expect(settingsCandidates('/h', 'darwin', {})[0]).toBe(
      '/h/Library/Application Support/Code/User/settings.json',
    );
    expect(settingsCandidates('/h', 'win32', { APPDATA: '/h/Roaming' })[0]).toBe(
      '/h/Roaming/Code/User/settings.json',
    );
  });
});
