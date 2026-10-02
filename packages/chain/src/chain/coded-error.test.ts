import { describe, expect, it } from 'vitest';
import { CodedError } from './coded-error.js';
import { DanglingInstallationIdError } from './keystore.js';
import { TailBusyError } from './tail-lock.js';

describe('an error that is a refusal', () => {
  it('is an Error that carries the code it is refused by', () => {
    const busy = new TailBusyError('/x.lock', 1, 2000);
    expect(busy).toBeInstanceOf(Error);
    expect(busy).toBeInstanceOf(CodedError);
    expect(busy.code).toBe('TAIL_BUSY');
    expect(new DanglingInstallationIdError('/a', '/b').code).toBe('DANGLING_INSTALLATION_ID');
  });

  it('is told apart from an error that merely has a code of its own', () => {
    const system = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    expect(system).not.toBeInstanceOf(CodedError);
  });
});
