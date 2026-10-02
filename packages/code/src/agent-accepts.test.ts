import type { ScopedCache } from '@mnema/copilot';
import { describe, expect, it } from 'vitest';
import { AGENT_ACCEPTS_IS_OFF, acceptedByAnAgent, agentMayAccept } from './agent-accepts.js';

/** One tree whose switch row for the channel says `on`, or no row at all (never switched). */
function sources(switched: 'never' | 'off' | 'on'): ScopedCache[] {
  const row =
    switched === 'never'
      ? null
      : {
          channel: 'agent-accepts',
          on: switched === 'on',
          who: 'mnid:0123456789abcdef',
          switchedAt: '2026-10-01T10:00:00.000Z',
        };
  return [{ scope: 'public', cache: { channelSwitch: () => row } }] as unknown as ScopedCache[];
}

describe('whether an agent may accept', () => {
  it('may, when nobody ever switched it, and when it was switched back on', () => {
    for (const switched of ['never', 'on'] as const) {
      expect(agentMayAccept(sources(switched), { action: 'accept', agent: 'claude-code' })).toBe(
        undefined,
      );
    }
  });

  it('may not, when it is off — and the refusal says who, how a person accepts, and how to turn it on', () => {
    const turnedAway = agentMayAccept(sources('off'), { action: 'accept', agent: 'claude-code' });
    expect(turnedAway?.code).toBe(AGENT_ACCEPTS_IS_OFF);
    expect(turnedAway?.message).toContain('mnid:0123456789abcdef');
    expect(turnedAway?.message).toContain('mnema decision move accept');
    expect(turnedAway?.message).toContain('mnema switch on agent-accepts');
    expect(turnedAway?.message).toContain('The decision was not moved.');
  });

  it('asks only about an agent’s accept: a person, and every other action, pass while it is off', () => {
    expect(agentMayAccept(sources('off'), { action: 'accept', agent: undefined })).toBe(undefined);
    for (const action of ['reject', 'supersede']) {
      expect(agentMayAccept(sources('off'), { action, agent: 'claude-code' })).toBe(undefined);
    }
  });
});

describe('what an acceptance by an agent says about itself', () => {
  it('names the agent and what is true now', () => {
    const said = acceptedByAnAgent('claude-code');
    expect(said).toContain('recorded as made by an agent (claude-code)');
    expect(said).toContain('mnema switch off agent-accepts');
  });

  it('is one line however the agent’s name is written', () => {
    expect(acceptedByAnAgent('a\nb')).not.toContain('\n');
  });
});
