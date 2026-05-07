import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InitCommand } from '@/cli/commands/init-command.js';

const DIST_ENTRY = path.resolve('dist/index.js');

/**
 * Real-signal smoke for `mnema mcp serve`: spawn the compiled CLI,
 * send SIGTERM, and assert the graceful shutdown handler runs through
 * to completion with exit code 0.
 *
 * Skipped when `dist/index.js` is missing — the harness expects
 * `pnpm build` to have run before the integration suite (which is
 * already a precondition for the bench target as well).
 */
describe('mnema mcp serve — SIGTERM', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-sigterm-'));
    new InitCommand().run({
      cwd: projectRoot,
      name: 'Sigterm',
      key: 'SIG',
      workflow: 'default',
      force: false,
      minimal: false,
    });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it.skipIf(!existsSync(DIST_ENTRY))(
    'exits cleanly with code 0 after SIGTERM and leaves the buffer empty',
    async () => {
      const child = spawn(process.execPath, [DIST_ENTRY, 'mcp', 'serve'], {
        cwd: projectRoot,
        // Force a verbose log level: the suite runs with NODE_ENV=test,
        // which the logger reads as `silent` and would never print the
        // "MCP server connected" marker we wait for.
        env: { ...process.env, MNEMA_ACTOR: 'smoke', MNEMA_LOG_LEVEL: 'info' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Wait for the server to log that it's connected before signalling.
      // The MCP server logs to stderr on stdio mode (stdout is reserved
      // for JSON-RPC); the marker we look for is "MCP server connected".
      await waitForStderr(child, 'MCP server connected', 5_000);

      child.kill('SIGTERM');

      const code = await new Promise<number | null>((resolve) => {
        child.once('close', (exitCode) => resolve(exitCode));
      });

      expect(code).toBe(0);

      // Buffer should be empty after the graceful shutdown's flushAll.
      const bufferPath = path.join(projectRoot, '.app', 'buffer.jsonl');
      if (existsSync(bufferPath)) {
        expect(readFileSync(bufferPath, 'utf-8').trim()).toBe('');
      }
    },
    15_000,
  );
});

function waitForStderr(
  child: ReturnType<typeof spawn>,
  needle: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (child.stderr === null) {
      reject(new Error('child has no stderr stream'));
      return;
    }
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for stderr marker "${needle}"`));
    }, timeoutMs);
    let buffer = '';
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf-8');
      if (buffer.includes(needle)) {
        clearTimeout(timer);
        child.stderr?.off('data', onData);
        resolve();
      }
    };
    child.stderr.on('data', onData);
  });
}
