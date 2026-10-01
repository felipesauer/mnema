import { describe, expect, it } from 'vitest';
import { hookReply } from './hook-reply.js';

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

describe('what a host parses out of a hook reply', () => {
  it('holds no control byte after it is parsed: the serializer’s escape is the byte again to a parser', () => {
    const reply = hookReply('PreToolUse', {
      context: `rule ${ESC}[2J one`,
      ask: `ask ${BEL} two`,
    });
    const parsed = JSON.parse(JSON.stringify(reply)) as {
      hookSpecificOutput: { additionalContext: string; permissionDecisionReason: string };
    };
    expect(parsed.hookSpecificOutput.additionalContext).toBe('rule \\u001b[2J one');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe('ask \\u0007 two');
  });

  it('says nothing, as ever, when there is nothing to say', () => {
    expect(hookReply('PreToolUse', {})).toEqual({});
  });
});
