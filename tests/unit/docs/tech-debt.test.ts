import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Sentinel test for `docs/TECH_DEBT.md`.
 *
 * The document is the canonical inventory of decisions deferred during
 * implementation. Removing or restructuring it silently is exactly the
 * failure mode it exists to prevent — this test ensures every section
 * stays present so that scanning by both humans and agents is reliable.
 */
const TECH_DEBT_PATH = path.resolve('docs/TECH_DEBT.md');

describe('docs/TECH_DEBT.md', () => {
  it('exists at the documented path', () => {
    expect(existsSync(TECH_DEBT_PATH)).toBe(true);
  });

  it('contains every canonical section', () => {
    const content = readFileSync(TECH_DEBT_PATH, 'utf-8');

    const requiredHeadings = [
      '## How to use this file',
      '## 1. MCP tools not yet implemented',
      '## 2. Services not yet implemented',
      '## 3. UX gaps',
      '## 4. Concurrency and resilience',
      '## 5. Identifier and metadata gaps',
      '## 6. Testing and verification gaps',
      '## 7. Performance',
      '## 8. Memory automation',
      '## 9. Documentation and polish',
      '## 10. Schema and migrations',
    ];

    for (const heading of requiredHeadings) {
      expect(content).toContain(heading);
    }
  });
});
