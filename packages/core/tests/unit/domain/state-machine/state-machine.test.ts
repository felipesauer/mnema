import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { StateMachine, type Workflow } from '@/domain/state-machine/state-machine.js';
import { loadWorkflowFile } from '@/storage/workflow-file.js';

const defaultWorkflowPath = path.resolve('packages/core/workflows', 'default.json');

describe('StateMachine (default workflow)', () => {
  let workflow: Workflow;
  let machine: StateMachine;

  beforeAll(() => {
    workflow = loadWorkflowFile(defaultWorkflowPath);
    machine = new StateMachine(workflow);
  });

  it('canTransition returns true for known transitions', () => {
    expect(machine.canTransition('DRAFT', 'submit')).toBe(true);
    expect(machine.canTransition('IN_PROGRESS', 'submit_review')).toBe(true);
  });

  it('canTransition returns false for invalid transitions', () => {
    expect(machine.canTransition('DRAFT', 'approve')).toBe(false);
    expect(machine.canTransition('UNKNOWN', 'submit')).toBe(false);
  });

  it('isTerminal recognises terminal states', () => {
    expect(machine.isTerminal('DONE')).toBe(true);
    expect(machine.isTerminal('CANCELED')).toBe(true);
    expect(machine.isTerminal('IN_PROGRESS')).toBe(false);
  });

  it('listActionsFrom enumerates outgoing transitions', () => {
    const actions = machine
      .listActionsFrom('DRAFT')
      .map((a) => a.action)
      .sort();
    expect(actions).toEqual(['cancel', 'submit']);
  });

  it('validateTransition rejects an unknown transition', () => {
    const result = machine.validateTransition('DRAFT', 'approve', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('INVALID_TRANSITION');
    }
  });

  it('validateTransition rejects a payload missing required fields', () => {
    const result = machine.validateTransition('DRAFT', 'submit', { title: 'short' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('GATE_FAILED');
    }
  });

  it('validateTransition accepts a fully valid payload', () => {
    const result = machine.validateTransition('DRAFT', 'submit', {
      title: 'Implement OAuth flow',
      description: 'Add support for OAuth login via Google.',
      acceptance_criteria: ['Users can login with Google'],
      estimate: 5,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.to).toBe('READY');
    }
  });

  it('validateTransition accepts a transition that requires a URL', () => {
    const ok = machine.validateTransition('IN_PROGRESS', 'submit_review', {
      pr_url: 'https://github.com/example/repo/pull/42',
    });
    expect(ok.ok).toBe(true);

    const bad = machine.validateTransition('IN_PROGRESS', 'submit_review', {
      pr_url: 'not-a-url',
    });
    expect(bad.ok).toBe(false);
  });

  describe('resolveTransition override payload', () => {
    it('drops undeclared keys from data when the gate fails (override path)', () => {
      // DRAFT→submit requires title/description/acceptance_criteria/estimate.
      // Supply only title (declared) plus __attack__ (undeclared): the gate
      // fails, and the returned data — which a permitted override would
      // persist to the audit log — must contain title but NOT __attack__.
      const resolved = machine.resolveTransition('DRAFT', 'submit', {
        title: 'A task',
        __attack__: 'evil',
        nested: { x: 1 },
      });
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;

      expect(resolved.value.gate.ok).toBe(false); // missing required fields
      const data = resolved.value.data as Record<string, unknown>;
      expect(data.title).toBe('A task');
      expect('__attack__' in data).toBe(false);
      expect('nested' in data).toBe(false);
    });

    it('strips undeclared keys on a clean gate too (Zod strip)', () => {
      // DRAFT→cancel requires only `reason`. A clean gate + an extra key.
      const resolved = machine.resolveTransition('DRAFT', 'cancel', {
        reason: 'no longer needed',
        __attack__: 'evil',
      });
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
      expect(resolved.value.gate.ok).toBe(true);
      const data = resolved.value.data as Record<string, unknown>;
      expect(data.reason).toBe('no longer needed');
      expect('__attack__' in data).toBe(false);
    });

    it('passes a non-object payload through so the gate reports the type error', () => {
      const resolved = machine.resolveTransition('DRAFT', 'submit', 'not-an-object');
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
      expect(resolved.value.gate.ok).toBe(false);
      expect(resolved.value.data).toBe('not-an-object');
    });
  });
});
