// A command hook for `PreToolUse` on `AskUserQuestion` that answers the question for the person, as
// a host run with `-p` has nobody to ask: it allows the call and hands it back with `answers`, the
// first option of each question chosen, the way the host documents for a headless session.
//
// usage: node a-hook-that-answers-the-question.mjs
import { readFileSync } from 'node:fs';

const payload = JSON.parse(readFileSync(0, 'utf-8'));
const input = payload.tool_input ?? {};
const answers = Object.fromEntries(
  (input.questions ?? []).map((one) => [one.question, one.options?.[0]?.label ?? '']),
);
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: { ...input, answers },
    },
  }),
);
