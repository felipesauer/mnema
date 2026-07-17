import { describe, expect, it, vi } from 'vitest';

import { AuditService } from '@/services/integrity/audit-service.js';
import type { AuditEvent, AuditWriter } from '@/storage/audit/audit-writer.js';

function fakeWriter(): { writer: AuditWriter; written: AuditEvent[] } {
  const written: AuditEvent[] = [];
  const writer = { write: (e: AuditEvent) => written.push(e) } as unknown as AuditWriter;
  return { writer, written };
}

describe('AuditService write observer', () => {
  it('invokes the observer after a successful write', () => {
    const { writer, written } = fakeWriter();
    const audit = new AuditService(writer);
    const seen: AuditEvent[] = [];
    audit.setWriteObserver((e) => seen.push(e));

    audit.write({ kind: 'sprint_closed', actor: 'daniel', data: { key: 'S-1' } });

    expect(written).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(seen[0].kind).toBe('sprint_closed');
  });

  it('does not re-enter the observer for writes it makes itself', () => {
    const { writer, written } = fakeWriter();
    const audit = new AuditService(writer);
    let observerCalls = 0;
    audit.setWriteObserver(() => {
      observerCalls += 1;
      // Simulate the dispatcher recording a hook_ran event.
      audit.write({ kind: 'hook_ran', actor: 'daniel', data: {} });
    });

    audit.write({ kind: 'sprint_closed', actor: 'daniel', data: { key: 'S-1' } });

    // Two writes (the trigger + the hook_ran), but the observer fired once.
    expect(written.map((e) => e.kind)).toEqual(['sprint_closed', 'hook_ran']);
    expect(observerCalls).toBe(1);
  });

  it('a throwing observer never propagates to the caller', () => {
    const { writer, written } = fakeWriter();
    const audit = new AuditService(writer);
    audit.setWriteObserver(() => {
      throw new Error('hook blew up');
    });

    expect(() => audit.write({ kind: 'epic_closed', actor: 'daniel', data: {} })).not.toThrow();
    expect(written).toHaveLength(1);
  });

  it('a throwing observer clears the re-entrancy guard for later writes', () => {
    const { writer } = fakeWriter();
    const audit = new AuditService(writer);
    const calls = vi.fn(() => {
      throw new Error('x');
    });
    audit.setWriteObserver(calls);

    audit.write({ kind: 'sprint_closed', actor: 'daniel', data: {} });
    audit.write({ kind: 'sprint_closed', actor: 'daniel', data: {} });

    expect(calls).toHaveBeenCalledTimes(2);
  });
});
