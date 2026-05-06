import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { StateMachine, type Workflow } from '@/domain/state-machine/state-machine.js';
import { WorkflowLoader } from '@/domain/state-machine/workflow-loader.js';

const defaultWorkflowPath = path.resolve('workflows', 'default.json');

describe('StateMachine (default workflow)', () => {
  let workflow: Workflow;
  let machine: StateMachine;

  beforeAll(() => {
    workflow = new WorkflowLoader().load(defaultWorkflowPath);
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
});
