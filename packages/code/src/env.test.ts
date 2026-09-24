import { homedir } from 'node:os';
import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoveryEnv } from './env.js';

describe('discoveryEnv — what the surface reads off the process for the core', () => {
  it('reads HOME, and MNEMA_HOME as it was typed — the rules about both are the core’s', () => {
    for (const relocated of ['/srv/keys', '', 'relative/keys']) {
      const env = discoveryEnv({ HOME: '/home/someone', MNEMA_HOME: relocated });
      expect(env.home).toBe('/home/someone');
      expect(env.mnemaHome, `MNEMA_HOME=${JSON.stringify(relocated)}`).toBe(relocated);
    }
  });

  it('leaves the variable out when it is not set, rather than handing the core an undefined', () => {
    expect('mnemaHome' in discoveryEnv({ HOME: '/home/someone' })).toBe(false);
  });

  it('does not read $XDG_DATA_HOME — the key root no longer follows whatever launched the process', () => {
    const env = discoveryEnv({ HOME: '/home/someone', XDG_DATA_HOME: '/snap/app/42/.local/share' });
    expect(Object.keys(env).filter((key) => key !== 'accountHome')).toEqual(['home']);
    expect(JSON.stringify(env)).not.toContain('/snap/app/42');
  });

  it('takes the account’s home from the account, not from HOME — it is what HOME falls back to', () => {
    const env = discoveryEnv({ HOME: '' });
    expect(env.home).toBe('');
    expect(env.accountHome).toBeDefined();
    expect(isAbsolute(env.accountHome as string)).toBe(true);
    expect(env.accountHome).not.toBe('');
  });

  it('falls back to this process’s home when the map carries no HOME at all', () => {
    expect(discoveryEnv({}).home).toBe(homedir());
  });
});
