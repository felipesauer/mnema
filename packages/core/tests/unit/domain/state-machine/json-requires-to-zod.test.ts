import { describe, expect, it } from 'vitest';

import { jsonRequiresToZod } from '@/domain/state-machine/json-requires-to-zod.js';

describe('jsonRequiresToZod', () => {
  it('translates string with min and max', () => {
    const schema = jsonRequiresToZod({
      title: { type: 'string', min: 3, max: 10 },
    });

    expect(schema.safeParse({ title: 'hello' }).success).toBe(true);
    expect(schema.safeParse({ title: 'ab' }).success).toBe(false);
    expect(schema.safeParse({ title: 'this is way too long' }).success).toBe(false);
  });

  it('translates number with enum', () => {
    const schema = jsonRequiresToZod({
      estimate: { type: 'number', integer: true, enum: [1, 2, 3, 5, 8, 13] },
    });

    expect(schema.safeParse({ estimate: 5 }).success).toBe(true);
    expect(schema.safeParse({ estimate: 4 }).success).toBe(false);
    expect(schema.safeParse({ estimate: 1.5 }).success).toBe(false);
  });

  it('translates array of string with min', () => {
    const schema = jsonRequiresToZod({
      acceptance_criteria: {
        type: 'array',
        items: { type: 'string', min: 1 },
        min: 1,
      },
    });

    expect(schema.safeParse({ acceptance_criteria: ['one'] }).success).toBe(true);
    expect(schema.safeParse({ acceptance_criteria: [] }).success).toBe(false);
    expect(schema.safeParse({ acceptance_criteria: [''] }).success).toBe(false);
  });

  it('translates string with format url', () => {
    const schema = jsonRequiresToZod({
      pr_url: { type: 'string', format: 'url' },
    });

    expect(schema.safeParse({ pr_url: 'https://example.com/pr/1' }).success).toBe(true);
    expect(schema.safeParse({ pr_url: 'not a url' }).success).toBe(false);
  });

  it('translates string with format task_key', () => {
    const schema = jsonRequiresToZod({
      ref: { type: 'string', format: 'task_key' },
    });

    expect(schema.safeParse({ ref: 'WEBAPP-42' }).success).toBe(true);
    expect(schema.safeParse({ ref: 'webapp-42' }).success).toBe(false);
  });

  it('respects optional field marker', () => {
    const schema = jsonRequiresToZod({
      note: { type: 'string', optional: true },
    });

    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ note: 'ok' }).success).toBe(true);
  });

  it('applies defaults', () => {
    const schema = jsonRequiresToZod({
      priority: { type: 'number', default: 3 },
    });

    const parsed = schema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ priority: 3 });
    }
  });

  it('enforces array uniqueness', () => {
    const schema = jsonRequiresToZod({
      tags: {
        type: 'array',
        items: { type: 'string' },
        unique: true,
      },
    });

    expect(schema.safeParse({ tags: ['a', 'b'] }).success).toBe(true);
    expect(schema.safeParse({ tags: ['a', 'a'] }).success).toBe(false);
  });
});
