import { describe, expect, it } from 'vitest';

import { ErrorCode } from '../../../src/errors/error-codes.js';
import { mapSqliteError } from '../../../src/storage/sqlite/sqlite-error-map.js';

describe('mapSqliteError', () => {
  it('maps a <table>.key UNIQUE collision to a retryable KeyCollision', () => {
    const error = new Error('UNIQUE constraint failed: tasks.key');
    const mapped = mapSqliteError(error);
    expect(mapped).toEqual({ kind: ErrorCode.KeyCollision, table: 'tasks' });
  });

  it('captures the offending table for epics/sprints/decisions too', () => {
    for (const table of ['epics', 'sprints', 'decisions']) {
      const mapped = mapSqliteError(new Error(`UNIQUE constraint failed: ${table}.key`));
      expect(mapped).toEqual({ kind: ErrorCode.KeyCollision, table });
    }
  });

  it('does not treat a non-key UNIQUE violation as a KeyCollision', () => {
    // memories.slug is unique but is not a sequential-key mint — it must not be
    // rewritten as a retryable KeyCollision (retrying reproduces the duplicate).
    const mapped = mapSqliteError(new Error('UNIQUE constraint failed: memories.slug'));
    expect(mapped).toBeNull();
  });
});
