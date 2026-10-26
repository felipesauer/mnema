import { describe, expect, it } from 'vitest';
import { createRun } from './cli.js';

describe('the runner starts the mnema command directly, with an argument array', () => {
  it('passes shell metacharacters through as one argument each', async () => {
    const run = createRun(process.execPath, process.cwd());
    const nasty = '$(touch /nonexistent/x); `id` && echo "a b"';
    const out = await run([
      '-e',
      'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
      nasty,
    ]);
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual([nasty]);
  });

  it('keeps stdout, stderr and the exit code of a command that fails', async () => {
    const run = createRun(process.execPath, process.cwd());
    const out = await run([
      '-e',
      'process.stdout.write("out");process.stderr.write("err");process.exit(3)',
    ]);
    expect(out).toEqual({ code: 3, stdout: 'out', stderr: 'err' });
  });

  it('says a command stopped for not answering in time apart from one that could not be started', async () => {
    const run = createRun(process.execPath, process.cwd(), 200);
    const slow = await run(['-e', 'setTimeout(() => {}, 10000)']);
    expect(slow.code).toBeNull();
    expect(slow.timedOut).toBe(true);
    const absent = await createRun('/nonexistent/mnema-binary', process.cwd(), 200)(['x']);
    expect(absent.timedOut).toBeUndefined();
  });

  it('answers a missing executable with no exit code and the reason, and never throws', async () => {
    const run = createRun('/nonexistent/mnema-binary', process.cwd());
    const out = await run(['verify']);
    expect(out.code).toBeNull();
    expect(out.stderr).toContain('ENOENT');
  });
});
