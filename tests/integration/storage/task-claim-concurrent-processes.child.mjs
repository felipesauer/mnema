// Child process for task-claim-concurrent-processes.test.ts. Attempts ONE
// claim on a shared task through a REAL TaskRepository+SqliteAdapter, against
// the same state.db every sibling process opens. Run as a separate OS process
// (not a worker thread) so the claim races through the SQLite file the way two
// `mnema mcp serve` processes actually would — an in-process simulation can't
// exercise the cross-process write serialisation that keeps the claim
// mutually exclusive. Emits its outcome as JSON on stdout so the parent can
// assert exactly one winner.
import { pathToFileURL } from 'node:url';

const [, , distRoot, statePath, taskId, actorId, leaseExpiresAt, now] = process.argv;

const { SqliteAdapter } = await import(
  pathToFileURL(`${distRoot}/storage/sqlite/sqlite-adapter.js`).href
);
const { TaskRepository } = await import(
  pathToFileURL(`${distRoot}/storage/sqlite/repositories/task-repository.js`).href
);

const adapter = new SqliteAdapter(statePath);
const tasks = new TaskRepository(adapter);

const result = tasks.claim(taskId, actorId, leaseExpiresAt, now);
adapter.close();

process.stdout.write(JSON.stringify({ actorId, claimed: result.ok }));
