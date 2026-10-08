import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STACK_SCHEMA } from '../src/schema.js';
import { HELLO_STACK, PACKAGE_ROOT } from './support.js';

describe('stack.schema.json', () => {
  it('is the schema the package exports', () => {
    const file = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'stack.schema.json'), 'utf8'));
    expect(file).toEqual(JSON.parse(JSON.stringify(STACK_SCHEMA)));
  });

  it('names every top-level field hello-stack uses, and requires the five a stack cannot lack', () => {
    const manifest = JSON.parse(readFileSync(join(HELLO_STACK, 'stack.json'), 'utf8'));
    for (const key of Object.keys(manifest))
      expect(Object.keys(STACK_SCHEMA.properties)).toContain(key);
    expect(STACK_SCHEMA.required).toEqual(['name', 'version', 'description', 'author', 'license']);
  });
});
