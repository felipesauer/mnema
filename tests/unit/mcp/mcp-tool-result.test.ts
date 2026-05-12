import { describe, expect, it } from 'vitest';

import { ErrorCode } from '@/errors/error-codes.js';
import { err, ok, requireActiveRun, requireFreshSchema } from '@/mcp/mcp-tool-result.js';

describe('mcp-tool-result', () => {
  it('ok wraps value with ok:true and JSON body', () => {
    const result = ok({ skill: { slug: 's' } });
    expect(result.content[0]?.type).toBe('text');
    if (result.content[0]?.type !== 'text') return;
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(parsed.ok).toBe(true);
    expect(parsed.skill).toEqual({ slug: 's' });
  });

  it('err sets isError and includes the structured payload', () => {
    const result = err({ kind: ErrorCode.SkillNotFound, slug: 'missing' });
    expect(result.isError).toBe(true);
  });

  it('requireActiveRun returns null when run is active', () => {
    expect(requireActiveRun('019e0000-0000-7000-8000-000000000000')).toBeNull();
  });

  it('requireActiveRun returns NO_ACTIVE_RUN when no run', () => {
    const result = requireActiveRun(null);
    expect(result?.isError).toBe(true);
  });

  it('requireFreshSchema returns null when nothing pending', () => {
    expect(requireFreshSchema([])).toBeNull();
  });

  it('requireFreshSchema returns SCHEMA_OUT_OF_DATE when pending', () => {
    const result = requireFreshSchema(['008_skills_and_memories.sql']);
    expect(result?.isError).toBe(true);
    if (!result?.isError || result.content[0]?.type !== 'text') return;
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(parsed.error).toBe('SCHEMA_OUT_OF_DATE');
    expect(parsed.pending).toEqual(['008_skills_and_memories.sql']);
  });
});
