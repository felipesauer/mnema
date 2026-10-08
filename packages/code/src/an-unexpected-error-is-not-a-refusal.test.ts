/**
 * AN UNEXPECTED ERROR IS NOT A REFUSAL — the last-resort catch of the program told them
 * apart by nothing: a verb that said no on purpose and a verb that tripped over its own
 * code both came out as one red sentence and exit 1, so a bug looked exactly like the
 * product doing what it was asked.
 *
 * Each case builds the real program, adds one verb whose action throws what the case
 * names, parses a line with `parseWith`, and reads what was written and the code the
 * invocation asked to exit with.
 */

import { CodedError } from '@mnema/chain';
import { describe, expect, it } from 'vitest';
import { INTERNAL_ERROR_EXIT, InternalError } from './internal-error.js';
import { renderPlain } from './presentation/plain.js';
import { buildProgram, parseWith } from './program.js';

class ADeliberateNo extends CodedError {
  readonly code = 'A_DELIBERATE_NO';
}

/** What one line wrote on each stream and the exit code it asked for (none: it did not fail). */
async function whatItThrows(thrown: () => unknown): Promise<{
  out: string[];
  err: string[];
  exit: number | undefined;
}> {
  const out: string[] = [];
  const err: string[] = [];
  let exit: number | undefined;
  const built = buildProgram(
    {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      fail: (code) => {
        exit = code ?? 1;
      },
    },
    [],
    renderPlain,
  );
  built.program.command('boom').action(() => {
    throw thrown();
  });
  await parseWith(built, ['boom']);
  return { out, err, exit };
}

describe('the last-resort catch', () => {
  it('says a deliberate plain refusal the way it always did, with exit 1', async () => {
    const said = await whatItThrows(
      () => new Error('--timeout takes a whole number of seconds, at least 1 (got "0")'),
    );
    expect(said.err).toEqual(['--timeout takes a whole number of seconds, at least 1 (got "0")']);
    expect(said.exit).toBe(1);
  });

  it('says a coded refusal the same way, with exit 1', async () => {
    const said = await whatItThrows(() => new ADeliberateNo('the tail is busy'));
    expect(said.err).toEqual(['the tail is busy']);
    expect(said.exit).toBe(1);
  });

  it('says a failed network call as a refusal, because the cause is the machine and not the code', async () => {
    const said = await whatItThrows(
      () =>
        new TypeError('fetch failed', {
          cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
        }),
    );
    expect(said.err).toEqual(['fetch failed']);
    expect(said.exit).toBe(1);
  });

  it('says a TypeError out of the product as an internal error, with its own exit', async () => {
    const said = await whatItThrows(
      () => new TypeError("Cannot read properties of undefined (reading 'seq')"),
    );
    // The first line is the error; a second one, the offer of a report, follows the first fault of
    // its kind on this machine (`a-report-is-built-from-an-allowlist.test.ts` holds that line).
    expect(said.err.slice(0, 1)).toEqual([
      "mnema hit an internal error: TypeError: Cannot read properties of undefined (reading 'seq'): this is a fault in mnema, not a refusal of the command",
    ]);
    expect(said.exit).toBe(INTERNAL_ERROR_EXIT);
    expect(INTERNAL_ERROR_EXIT).toBe(70);
  });

  it('says a RangeError, a ReferenceError and a thrown non-error as internal too', async () => {
    for (const thrown of [new RangeError('x'), new ReferenceError('x'), 'a string', undefined]) {
      const said = await whatItThrows(() => thrown);
      expect(said.exit, String(thrown)).toBe(INTERNAL_ERROR_EXIT);
      expect(said.err[0], String(thrown)).toContain('mnema hit an internal error');
    }
  });

  it('says an error the product itself declared internal as internal, whatever its message', async () => {
    const said = await whatItThrows(() => new InternalError('the tail has two heads'));
    expect(said.err).toEqual([
      'mnema hit an internal error: the tail has two heads: this is a fault in mnema, not a refusal of the command',
    ]);
    expect(said.exit).toBe(INTERNAL_ERROR_EXIT);
  });

  it('writes nothing on stdout in either case', async () => {
    expect((await whatItThrows(() => new TypeError('x'))).out).toEqual([]);
    expect((await whatItThrows(() => new Error('x'))).out).toEqual([]);
  });
});
