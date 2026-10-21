/**
 * A SETTLED CHOICE REACHES THE MODEL, in the real host: after the host's question tool ran and the
 * person's answer came back, the plugin's `PostToolUse` hook hands the agent one sentence beside
 * the answer, and the next request to the model carries it. With the channel switched off, the hook
 * runs and nothing is added.
 *
 * WHAT IS HELD HERE AND WHAT IS NOT. The product's half (which payloads are answered, the sentence,
 * the silence) is `a-settled-choice-is-said.test.ts`. What it cannot say is that the host fires the
 * hook for its question tool, under the matcher the plugin declares, and puts the reply in front of
 * the model. A host run with `-p` has nobody to ask, so a `PreToolUse` hook of the case answers the
 * question the way the host documents (`updatedInput.answers`), and a second hook of the case keeps
 * the payload the host hands `PostToolUse`, which is read for its shape.
 *
 * NOT HELD: that the model records anything.
 */

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { SETTLED_SENTENCE } from '../../src/commands/settled.js';
import {
  aHostForEachCase,
  EVIDENCE_DIRECTORY,
  type TheSession,
  type TheSpec,
  theResultOfTheCall,
} from './support/the-host.js';
import type { TheCall } from './support/the-stand-in-api.js';

const ANSWERS = fileURLToPath(
  new URL('./support/a-hook-that-answers-the-question.mjs', import.meta.url),
);
const KEEPS = fileURLToPath(
  new URL('./support/a-hook-that-keeps-what-it-was-handed.mjs', import.meta.url),
);

const QUESTION = 'Which store do we use?';

/** The call a model makes to ask the person: the host's own question tool, with two options. */
function askTheQuestion(): TheCall {
  return {
    tool: 'AskUserQuestion',
    input: {
      questions: [
        {
          question: QUESTION,
          header: 'Store',
          options: [
            { label: 'SQLite', description: 'One file beside the project' },
            { label: 'Postgres', description: 'A server of its own' },
          ],
          multiSelect: false,
        },
      ],
    },
  };
}

/**
 * The answer the host sent back to the model, as the next request carries it: the host puts a
 * `PostToolUse` hook's text inside the tool's result, under a reminder that names the hook.
 */
function theAnswerAsSent(session: TheSession): string {
  return theResultOfTheCall(session)?.text ?? '';
}

describe('a settled choice reaches the model', () => {
  const start = aHostForEachCase();
  let kept: string;
  afterEach(() => rmSync(kept, { recursive: true, force: true }));

  /** A session whose model asks the question once, answered by the case's own hook. */
  async function asked(extra: Pick<TheSpec, 'project'> = {}) {
    kept = mkdtempSync(join(tmpdir(), 'mnema-kept-'));
    const file = join(kept, 'post-tool-use.json');
    const session = await start({
      ...extra,
      call: () => askTheQuestion(),
      callOnce: true,
      allow: ['AskUserQuestion'],
      // Measured on 2.1.281: a `-p` session offers the model no question tool unless a permission
      // prompt tool is named; with `stdio` it offers `AskUserQuestion`, and the case's own hook
      // answers it before any prompt is needed.
      args: ['--permission-prompt-tool', 'stdio'],
      hooks: {
        PreToolUse: [
          {
            matcher: 'AskUserQuestion',
            hooks: [{ type: 'command', command: `node "${ANSWERS}"` }],
          },
        ],
        PostToolUse: [
          {
            matcher: 'AskUserQuestion',
            hooks: [{ type: 'command', command: `node "${KEEPS}" "${file}"` }],
          },
        ],
      },
    });
    return { session, file };
  }

  it('hands the sentence to the next request, and the host hands the hook the question and the answer', async () => {
    const { session, file } = await asked();
    const payload = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
    const into = process.env[EVIDENCE_DIRECTORY];
    if (into !== undefined && into !== '') {
      mkdirSync(into, { recursive: true });
      copyFileSync(file, join(into, 'claude-code.post-tool-use.ask-user-question.json'));
    }
    expect(payload['hook_event_name']).toBe('PostToolUse');
    expect(payload['tool_name']).toBe('AskUserQuestion');
    expect(JSON.stringify(payload['tool_response'])).toContain('SQLite');
    const sent = theAnswerAsSent(session);
    expect(sent).toContain('"Which store do we use?"="SQLite"');
    expect(sent).toContain(
      `PostToolUse:AskUserQuestion hook additional context: ${SETTLED_SENTENCE}`,
    );
  }, 120_000);

  it('with the channel switched off, the hook runs and nothing reaches the model', async () => {
    const { session, file } = await asked({
      project: (it) => {
        it.mnema('switch', 'off', 'choice-settled', '--reason', 'not in this project');
      },
    });
    // The question was asked and answered: the hook of the case saw it.
    expect(JSON.parse(readFileSync(file, 'utf-8')).tool_name).toBe('AskUserQuestion');
    const sent = theAnswerAsSent(session);
    expect(sent).toContain('"Which store do we use?"="SQLite"');
    expect(sent).not.toContain(SETTLED_SENTENCE);
  }, 120_000);
});
