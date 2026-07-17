/**
 * Automated MCP smoke test.
 *
 * Spawns `mnema mcp serve` as a subprocess connected over stdio,
 * pretends to be an MCP client via the SDK's transport, and exercises
 * the eight tools that matter for a release smoke: context_bootstrap,
 * agent_run_start, task_create, task_show, decision_record, memory_record,
 * observation_record, agent_run_end. Exits 0 on success and non-zero on
 * any failure, so CI can gate releases.
 *
 * Automates the MCP portions of the maintainer's manual smoke suite.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const cliEntry = path.join(repoRoot, 'packages', 'mnema', 'dist', 'index.js');

if (!existsSync(cliEntry)) {
  process.stderr.write(`error: ${cliEntry} not found — run \`pnpm build\` first.\n`);
  process.exit(2);
}

const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-mcp-smoke-'));
let exitCode = 0;

async function main(): Promise<void> {
  // Bootstrap project via the CLI binary so the smoke exercises the
  // real init path users hit, not an in-memory fixture.
  const init = spawn(
    process.execPath,
    [cliEntry, 'init', '--name', 'MCP smoke', '--key', 'SMK', '--workflow', 'default'],
    { cwd: projectRoot, env: { ...process.env, MNEMA_ACTOR: 'smoke' } },
  );
  await waitForExit(init, 'mnema init');

  // Now connect a real MCP client to `mnema mcp serve`. The transport
  // owns spawning + stdin/stdout wiring.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliEntry, 'mcp', 'serve', '--agent-handle', 'mcp-smoke'],
    cwd: projectRoot,
    env: { ...process.env, MNEMA_ACTOR: 'smoke' },
  });

  const client = new Client({ name: 'mcp-smoke', version: '0.1.0' });
  await client.connect(transport);

  try {
    await expect('context_bootstrap', () => client.callTool({ name: 'context_bootstrap' }));

    const runStart = await expect('agent_run_start', () =>
      client.callTool({
        name: 'agent_run_start',
        arguments: { goal: 'mcp smoke automated' },
      }),
    );
    const runId = pickRunId(runStart);

    await expect('task_create', () =>
      client.callTool({
        name: 'task_create',
        arguments: { title: 'Smoke task created via MCP' },
      }),
    );

    await expect('task_show', () =>
      client.callTool({ name: 'task_show', arguments: { task_key: 'SMK-1' } }),
    );

    await expect('decision_record', () =>
      client.callTool({
        name: 'decision_record',
        arguments: {
          title: 'Smoke ADR',
          decision: 'Adopt automated MCP smoke before tagging releases',
        },
      }),
    );

    await expect('memory_record', () =>
      client.callTool({
        name: 'memory_record',
        arguments: {
          slug: 'mcp-smoke-procedure',
          title: 'MCP smoke procedure',
          content: 'Automated via scripts/mcp-smoke.ts; substitutes fases 10/15/17/21.',
          topics: ['testing', 'smoke'],
        },
      }),
    );

    await expect('observation_record', () =>
      client.callTool({
        name: 'observation_record',
        arguments: {
          content: 'mcp-smoke run completed cleanly',
          topics: ['smoke'],
        },
      }),
    );

    await expect('agent_run_end', () =>
      client.callTool({
        name: 'agent_run_end',
        arguments: { run_id: runId, status: 'completed', result: 'ok' },
      }),
    );

    process.stdout.write('\n✓ MCP smoke passed: 8/8 tools exercised cleanly.\n');
  } catch (error) {
    exitCode = 1;
    process.stderr.write(`\n✗ MCP smoke failed: ${(error as Error).message}\n`);
  } finally {
    await client.close().catch(() => {});
  }
}

async function expect<T>(label: string, fn: () => Promise<T>): Promise<T> {
  process.stdout.write(`→ ${label} ... `);
  const start = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - start;
    process.stdout.write(`ok (${ms}ms)\n`);
    return result;
  } catch (error) {
    process.stdout.write(`FAIL\n`);
    throw error;
  }
}

interface MaybeContent {
  readonly content?: ReadonlyArray<{ readonly text?: string }>;
}

function pickRunId(response: unknown): string {
  const content = (response as MaybeContent).content;
  const text = content?.[0]?.text ?? '';
  const parsed = JSON.parse(text) as { run_id?: string; run?: { id?: string } };
  const id = parsed.run_id ?? parsed.run?.id;
  if (typeof id !== 'string') {
    throw new Error(`agent_run_start did not return a run id (got ${text.slice(0, 120)})`);
  }
  return id;
}

async function waitForExit(
  proc: ReturnType<typeof spawn>,
  label: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with ${code}`));
    });
    proc.on('error', reject);
  });
}

try {
  await main();
} finally {
  rmSync(projectRoot, { recursive: true, force: true });
  process.exit(exitCode);
}
