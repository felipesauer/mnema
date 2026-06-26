import { afterEach, describe, expect, it, vi } from 'vitest';

import { runPhase, type UpgradeStep } from '@/cli/commands/upgrade-command.js';

// Intercept the dynamic `import('@inquirer/prompts')` inside runPhase so
// the confirmation prompt can be driven without a real TTY.
const confirmMock = vi.fn<() => Promise<boolean>>();
vi.mock('@inquirer/prompts', () => ({
  confirm: () => confirmMock(),
}));

/** A step that records whether it ran, so we can assert it did/didn't. */
function probeStep(): { step: UpgradeStep; ran: () => boolean } {
  let executed = false;
  return {
    step: {
      label: 'do the thing',
      run: () => {
        executed = true;
        return 'did the thing';
      },
    },
    ran: () => executed,
  };
}

describe('runPhase confirmation flow', () => {
  afterEach(() => {
    confirmMock.mockReset();
  });

  it('runs the steps when the user confirms', async () => {
    confirmMock.mockResolvedValue(true);
    const { step, ran } = probeStep();

    const result = await runPhase('Phase', [step], false);

    expect(result).toBe('applied');
    expect(ran()).toBe(true);
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it('does not run the steps when the user declines', async () => {
    confirmMock.mockResolvedValue(false);
    const { step, ran } = probeStep();

    const result = await runPhase('Phase', [step], false);

    expect(result).toBe('aborted');
    expect(ran()).toBe(false);
  });

  it('treats a Ctrl-C (ExitPromptError) as an abort, not a crash', async () => {
    const exit = new Error('User force closed the prompt');
    exit.name = 'ExitPromptError';
    confirmMock.mockRejectedValue(exit);
    const { step, ran } = probeStep();

    const result = await runPhase('Phase', [step], false);

    expect(result).toBe('aborted');
    expect(ran()).toBe(false);
  });

  it('rethrows an unexpected prompt error', async () => {
    confirmMock.mockRejectedValue(new Error('something else broke'));
    const { step } = probeStep();

    await expect(runPhase('Phase', [step], false)).rejects.toThrow('something else broke');
  });

  it('skips the prompt entirely with --yes (skipPrompt=true)', async () => {
    const { step, ran } = probeStep();

    const result = await runPhase('Phase', [step], true);

    expect(result).toBe('applied');
    expect(ran()).toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
  });
});
