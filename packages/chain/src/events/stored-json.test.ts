import { describe, expect, it } from 'vitest';

import { firstDuplicateKey, parseStoredJson, StoredJsonError } from './stored-json.js';

describe('firstDuplicateKey', () => {
  it.each([
    ['at the top level', '{"a":1,"a":2}', 'a'],
    ['one level down', '{"o":{"k":1,"k":2}}', 'k'],
    ['in an object inside an array', '{"l":[{"x":1},{"y":1,"y":2}]}', 'y'],
    ['four levels down, after unrelated siblings', '{"a":{"b":{"c":{"d":1,"e":2,"d":3}}}}', 'd'],
    [
      'when the first copy is the false one placed before the true one',
      '{"t":"SQLite","r":"x","t":"Postgres"}',
      't',
    ],
    ['when the two spellings decode to one key', '{"a":1,"\\u0061":2}', 'a'],
    ['when a key holds an escaped quote', '{"q\\"":1,"q\\"":2}', 'q"'],
    ['when the duplicate is the last key of the object', '{"a":1,"b":2,"a":3}', 'a'],
    ['after a value that is itself an object', '{"a":{"z":1},"b":2,"a":{"z":2}}', 'a'],
  ])('finds a duplicate %s', (_what, text, key) => {
    expect(firstDuplicateKey(text)).toBe(key);
  });

  it.each([
    ['the same key in two sibling objects', '{"l":[{"a":1},{"a":2}]}'],
    ['the same key at two depths', '{"a":{"a":{"a":1}}}'],
    ['a key-looking text inside a string value', '{"a":"\\"a\\":1,\\"a\\":2","b":1}'],
    ['a value equal to a key', '{"a":"a","b":"a"}'],
    ['a string that ends in an escaped backslash', '{"a":"x\\\\","b":"y\\\\"}'],
    ['an empty object and an empty array', '{"a":{},"b":[],"c":[[],{}]}'],
    ['a top-level array of objects with one key each', '[{"a":1},{"a":1}]'],
    ['whitespace between every token', ' { "a" : 1 , "b" : [ 1 , 2 ] } '],
    ['two keys that differ only in composition', '{"é":1,"é":2}'],
  ])('finds nothing in %s', (_what, text) => {
    expect(firstDuplicateKey(text)).toBeUndefined();
  });

  it('agrees with JSON.parse about everything it does not refuse', () => {
    const text = '{"a":[1,2,{"b":"c\\n"}],"d":null,"e":true,"f":-1.5e3}';
    expect(firstDuplicateKey(text)).toBeUndefined();
    expect(parseStoredJson(text)).toEqual(JSON.parse(text));
  });
});

describe('parseStoredJson', () => {
  it('refuses a duplicate key and names it', () => {
    expect(() => parseStoredJson('{"title":"a","title":"b"}')).toThrow(StoredJsonError);
    expect(() => parseStoredJson('{"title":"a","title":"b"}')).toThrow(
      'a duplicate object key on the line: "title"',
    );
  });

  it('keeps the wording a line that is not JSON has always had', () => {
    expect(() => parseStoredJson('{"a":')).toThrow(/^not valid JSON: /);
  });

  it('repeats back a key only as an escaped, shortened string, because a key is untrusted text', () => {
    const key = `\u001b[2J${'k'.repeat(200)}`;
    const text = `{${JSON.stringify(key)}:1,${JSON.stringify(key)}:2}`;
    let message = '';
    try {
      parseStoredJson(text);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('a duplicate object key on the line:');
    expect(message).not.toContain('\u001b');
    expect(message.length).toBeLessThan(160);
  });
});
