import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  formatWorkflowIssues,
  WorkflowInvalidError,
  WorkflowLoader,
  WorkflowNotFoundError,
} from '@/domain/state-machine/workflow-loader.js';
import { loadWorkflowFile } from '@/storage/workflow-file.js';

const presets = ['default', 'lean', 'kanban', 'jira-classic'];

describe('loadWorkflowFile (presets)', () => {
  for (const name of presets) {
    it(`loads workflows/${name}.json without errors`, () => {
      const wf = loadWorkflowFile(path.resolve('workflows', `${name}.json`));

      expect(wf.name).toBe(name);
      expect(wf.states.length).toBeGreaterThanOrEqual(2);
      expect(wf.states).toContain(wf.initial);
      for (const t of wf.terminal) {
        expect(wf.states).toContain(t);
      }
    });
  }

  it('throws WorkflowNotFoundError when the file does not exist', () => {
    // The fs read (and its not-found error) lives in the storage seam, not
    // the pure domain loader.
    expect(() => loadWorkflowFile(path.resolve('workflows', 'does-not-exist.json'))).toThrow(
      WorkflowNotFoundError,
    );
  });
});

describe('WorkflowLoader.load (pure — validates already-read contents)', () => {
  const loader = new WorkflowLoader();
  // The loader no longer touches disk; feed it JSON text + a label path.
  const load = (doc: unknown, label = 'test.json') => loader.load(JSON.stringify(doc), label);

  it('throws WorkflowInvalidError when initial is not in states', () => {
    let caught: unknown;
    try {
      load({
        schema_version: '1.0',
        name: 'bad',
        states: ['A', 'B'],
        initial: 'C',
        transitions: {},
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(WorkflowInvalidError);
    if (caught instanceof WorkflowInvalidError) {
      expect(caught.issues.length).toBeGreaterThan(0);
      const formatted = formatWorkflowIssues('test.json', caught.issues);
      expect(formatted).toContain('initial state must be in states[]');
    }
  });

  it('throws WorkflowInvalidError when a terminal is not in states', () => {
    expect(() =>
      load({
        schema_version: '1.0',
        name: 'bad',
        states: ['A', 'B'],
        initial: 'A',
        terminal: ['Z'],
        transitions: {},
      }),
    ).toThrow(WorkflowInvalidError);
  });

  it('throws WorkflowInvalidError when a transition `to` is not in states', () => {
    let caught: unknown;
    try {
      load({
        schema_version: '1.0',
        name: 'phantom',
        states: ['DRAFT', 'DONE'],
        initial: 'DRAFT',
        terminal: ['DONE'],
        transitions: {
          DRAFT: {
            finish: { to: 'PHANTOM', description: 'leads nowhere', use_when: 'rejected at load' },
          },
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(WorkflowInvalidError);
    if (caught instanceof WorkflowInvalidError) {
      expect(formatWorkflowIssues('test.json', caught.issues)).toContain('PHANTOM');
    }
  });

  it('throws WorkflowInvalidError when a string field has min > max', () => {
    let caught: unknown;
    try {
      load({
        schema_version: '1.0',
        name: 'bad-bounds',
        states: ['DRAFT', 'DONE'],
        initial: 'DRAFT',
        terminal: ['DONE'],
        transitions: {
          DRAFT: {
            finish: {
              to: 'DONE',
              description: 'finishes the task',
              use_when: 'when done',
              requires: { note: { type: 'string', min: 10, max: 5 } },
            },
          },
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(WorkflowInvalidError);
    if (caught instanceof WorkflowInvalidError) {
      const formatted = formatWorkflowIssues('test.json', caught.issues);
      expect(formatted).toContain('min');
      expect(formatted).toContain('max');
    }
  });

  it('throws WorkflowInvalidError with a JSON parse hint when the contents are malformed', () => {
    let caught: unknown;
    try {
      loader.load('{"schema_version": "1.0", "name": "x",}', 'broken.json');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(WorkflowInvalidError);
    if (caught instanceof WorkflowInvalidError) {
      expect(formatWorkflowIssues('broken.json', caught.issues)).toContain('JSON parse error');
    }
  });
});
