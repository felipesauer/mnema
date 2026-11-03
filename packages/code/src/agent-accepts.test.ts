import type { ScopedCache } from '@mnema/context';
import { describe, expect, it } from 'vitest';
import {
  AGENT_ACCEPTS_IS_OFF,
  acceptedByAnAgent,
  acceptStateHere,
  agentMayAccept,
  stateOfANewDecision,
} from './agent-accepts.js';
import { tellsWhatToDo } from './record-framing.js';

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

  it('may not, when it is off, and the refusal says who, how a person accepts, and how to turn it on', () => {
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

describe('what a decision just recorded says of its state', () => {
  it('tells an agent through the tool when to accept and when to wait, and a person who accepts', () => {
    expect(stateOfANewDecision('on', 'agent-tool')).toBe(
      '  Born proposed, so not yet in force. If the person dictated it, or chose it among options ' +
        'you offered (a recommended one included), accept it now with `decision_transition` ' +
        '(action `accept`), the note quoting their answer; if you concluded it alone, it waits ' +
        'for the person (`mnema decision review`).',
    );
    expect(
      stateOfANewDecision('on', 'agent-command', { id: 'abc', agent: 'claude-code' }),
    ).toContain('accept it now with `mnema decision move accept abc --which claude-code`');
    expect(stateOfANewDecision('off', 'person')).toBe(
      '  Born proposed, so not yet in force. A person accepts it with `mnema decision review`.',
    );
  });

  it('says only a person accepts where the switch is off, whoever the agent is', () => {
    for (const who of ['agent-tool', 'agent-command'] as const) {
      const said = stateOfANewDecision('off', who);
      expect(said).toBe(
        '  Born proposed, so not yet in force. Here only a person accepts it ' +
          '(`mnema decision review`): `agent-accepts` is switched off.',
      );
      expect(said).not.toContain('accept it now');
    }
  });

  it('is one line, and tells nothing the framing tripwire knows', () => {
    for (const mayAccept of ['on', 'off', 'unreadable'] as const) {
      for (const who of ['agent-tool', 'agent-command', 'person'] as const) {
        const said = stateOfANewDecision(mayAccept, who);
        expect(said).not.toContain('\n');
        expect(tellsWhatToDo(said), `${mayAccept} ${who}`).toBeUndefined();
      }
    }
  });

  it('asks the gate: agents accept here unless the switch is off', () => {
    expect(acceptStateHere(sources('never'))).toBe('on');
    expect(acceptStateHere(sources('on'))).toBe('on');
    expect(acceptStateHere(sources('off'))).toBe('off');
  });

  it('says the switch could not be read, and not that it is off, where the record cannot be read', () => {
    const unreadable = [
      {
        scope: 'public',
        cache: {
          channelSwitch: () => {
            throw new Error('the projection cannot be read');
          },
        },
      },
    ] as unknown as ScopedCache[];
    expect(acceptStateHere(unreadable)).toBe('unreadable');
    for (const who of ['agent-tool', 'agent-command'] as const) {
      const said = stateOfANewDecision('unreadable', who);
      expect(said).toBe(
        '  Born proposed, so not yet in force. The switch `agent-accepts` could not be read, so only a ' +
          'person accepts it here (`mnema decision review`).',
      );
      expect(said).not.toContain('switched off');
      expect(said).not.toContain('accept it now');
    }
  });
});
