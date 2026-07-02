import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '@/config/config-schema.js';
import { fingerprintHooks, HookTrustService, hasAnyHook } from '@/services/hook-trust.js';

const EMPTY: Config['hooks'] = {
  on_task_done: [],
  on_task_transitioned: [],
  on_decision_accepted: [],
  on_sprint_closed: [],
  on_epic_closed: [],
};

function withHook(command: string, args: string[] = []): Config['hooks'] {
  return { ...EMPTY, on_task_done: [{ command, args }] };
}

describe('hook-trust helpers', () => {
  it('fingerprint is stable regardless of event-key ordering', () => {
    const a: Config['hooks'] = { ...EMPTY, on_task_done: [{ command: 'x', args: [] }] };
    const b: Config['hooks'] = {
      on_epic_closed: [],
      on_sprint_closed: [],
      on_decision_accepted: [],
      on_task_transitioned: [],
      on_task_done: [{ command: 'x', args: [] }],
    };
    expect(fingerprintHooks(a)).toBe(fingerprintHooks(b));
  });

  it('fingerprint changes when a hook command or arg changes', () => {
    expect(fingerprintHooks(withHook('a'))).not.toBe(fingerprintHooks(withHook('b')));
    expect(fingerprintHooks(withHook('a', ['x']))).not.toBe(fingerprintHooks(withHook('a', ['y'])));
  });

  it('hasAnyHook is false only for an all-empty block', () => {
    expect(hasAnyHook(EMPTY)).toBe(false);
    expect(hasAnyHook(withHook('a'))).toBe(true);
  });
});

describe('HookTrustService', () => {
  // The second constructor arg is the user-level dir (~/.config/mnema);
  // point it at an isolated temp dir so approvals never touch the real one.
  let userDir: string;

  beforeEach(() => {
    userDir = mkdtempSync(path.join(tmpdir(), 'mnema-hook-trust-'));
  });

  afterEach(() => {
    rmSync(userDir, { recursive: true, force: true });
  });

  it('an empty hooks block is trivially trusted (nothing to run)', () => {
    const trust = new HookTrustService('PROJ', userDir);
    expect(trust.isTrusted(EMPTY)).toBe(true);
  });

  it('a configured but un-approved block is NOT trusted', () => {
    const trust = new HookTrustService('PROJ', userDir);
    expect(trust.isTrusted(withHook('touch', ['/tmp/PWNED']))).toBe(false);
  });

  it('approving the exact block makes it trusted', () => {
    const trust = new HookTrustService('PROJ', userDir);
    const hooks = withHook('notify.sh', ['--to', 'done']);
    trust.approve(hooks);
    expect(trust.isTrusted(hooks)).toBe(true);
  });

  it('writes the approval file owner-only (0600)', () => {
    const trust = new HookTrustService('PROJ', userDir);
    trust.approve(withHook('notify.sh'));
    const mode = statSync(path.join(userDir, 'approvals', 'PROJ.hooks')).mode;
    // Compare the low permission bits only.
    expect(mode & 0o777).toBe(0o600);
  });

  it('editing the block after approval revokes trust (the attack move)', () => {
    const trust = new HookTrustService('PROJ', userDir);
    const approved = withHook('notify.sh');
    trust.approve(approved);
    expect(trust.isTrusted(approved)).toBe(true);

    // An agent rewrites the in-repo hooks block to something malicious.
    const tampered = withHook('touch', ['/tmp/PWNED']);
    expect(trust.isTrusted(tampered)).toBe(false);
  });

  it('approval is scoped per project key', () => {
    const hooks = withHook('notify.sh');
    new HookTrustService('PROJ', userDir).approve(hooks);
    // A different project never inherits PROJ's approval.
    expect(new HookTrustService('OTHER', userDir).isTrusted(hooks)).toBe(false);
  });
});
