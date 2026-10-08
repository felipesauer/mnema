import { describe, expect, it } from 'vitest';
import { checkName, namesAnMcpServer, validateManifest } from '../src/manifest.js';

const minimal = {
  name: 'a-stack',
  version: '0.1.0',
  description: 'A stack.',
  author: { name: 'Someone' },
  license: 'MIT',
};

const problemsOf = (value: unknown): string[] => {
  const result = validateManifest(value);
  return result.ok ? [] : result.problems.map((p) => p.message);
};

describe('validateManifest', () => {
  it('takes the five fields a stack cannot lack', () => {
    const result = validateManifest(minimal);
    expect(result.ok).toBe(true);
  });

  it.each([
    ['a list', []],
    ['null', null],
    ['a text', 'stack'],
  ])('refuses %s', (_what, value) => {
    expect(problemsOf(value)).toEqual(['stack.json must be a JSON object']);
  });

  it('refuses each missing or empty required field, by name', () => {
    for (const key of ['name', 'version', 'description', 'license']) {
      expect(problemsOf({ ...minimal, [key]: '  ' }).join('\n')).toContain(`"${key}"`);
    }
    expect(problemsOf({ ...minimal, author: undefined }).join('\n')).toContain('"author"');
    expect(problemsOf({ ...minimal, author: { name: 'x', email: 'y' } }).join('\n')).toContain(
      '"author"',
    );
  });

  it('refuses a field the contract does not have, at the top, in brings and in a hook', () => {
    expect(problemsOf({ ...minimal, colour: 1 })).toEqual([
      '"colour" is not a field of the contract',
    ]);
    expect(problemsOf({ ...minimal, brings: { tools: [] } })).toEqual([
      '"brings.tools" is not a field of the contract',
    ]);
    const hook = { name: 'h', event: 'e', file: 'hooks/h.sh', description: 'd' };
    expect(problemsOf({ ...minimal, hooks: [{ ...hook, run: 'now' }] })).toEqual([
      'hooks[0].run is not a field',
    ]);
  });

  it('refuses two hooks with one name, and a hook that is not an object', () => {
    const hook = { name: 'h', event: 'e', file: 'hooks/h.sh', description: 'd' };
    expect(problemsOf({ ...minimal, hooks: [hook, hook] })).toEqual(['two hooks are named "h"']);
    expect(problemsOf({ ...minimal, hooks: ['h'] })).toEqual(['hooks[0] must be an object']);
    expect(problemsOf({ ...minimal, hooks: 'h' })).toEqual(['"hooks" must be a list']);
  });

  it('sees mcpServers however deep it is', () => {
    expect(namesAnMcpServer({ a: [{ b: { mcpServers: {} } }] })).toBe(true);
    expect(namesAnMcpServer({ a: [{ b: { servers: {} } }] })).toBe(false);
    expect(namesAnMcpServer('mcpServers')).toBe(false);
  });
});

describe('checkName', () => {
  it('takes what the specification takes', () => {
    for (const name of ['a', 'a-b', 'a1-b2', 'x'.repeat(64)])
      expect(checkName(name), name).toBeUndefined();
  });

  it.each([
    ['', 'empty'],
    ['A', 'lowercase'],
    ['a b', 'lowercase'],
    ['é', 'lowercase'],
    ['x'.repeat(65), '65 characters'],
    ['-a', 'begins or ends'],
    ['a-', 'begins or ends'],
    ['a--b', 'two hyphens'],
  ])('refuses %j', (name, why) => {
    expect(checkName(name)).toContain(why);
  });
});
