// Child process for task-create-concurrent-processes.test.ts. Mints ONE task
// key the way TaskService.create does — nextSequence (a COUNT(*)) then an insert
// of the derived key — through a REAL TaskRepository+SqliteAdapter against the
// same state.db every sibling opens. Run as a separate OS process (not a worker
// thread) so the check-then-act races through the SQLite file the way two
// `mnema mcp serve` processes actually would. Wrapped in runInTransactionImmediate
// so the write lock is taken before the COUNT — the regression is that without
// it two siblings mint the same key (UNIQUE violation / duplicate). Emits the
// minted key (or the mapped error) as JSON on stdout so the parent can assert.
import { pathToFileURL } from 'node:url';

const [, , distRoot, statePath, projectId, projectKey, reporterId] = process.argv;

const { SqliteAdapter } = await import(
  pathToFileURL(`${distRoot}/storage/sqlite/sqlite-adapter.js`).href
);
const { TaskRepository } = await import(
  pathToFileURL(`${distRoot}/storage/sqlite/repositories/task-repository.js`).href
);
const { mapSqliteError } = await import(
  pathToFileURL(`${distRoot}/storage/sqlite/sqlite-error-map.js`).href
);

const adapter = new SqliteAdapter(statePath);
const tasks = new TaskRepository(adapter);

let out;
try {
  const created = tasks.runInTransactionImmediate(() => {
    const sequence = tasks.nextSequence(projectId);
    const key = `${projectKey}-${sequence}`;
    return tasks.insert({ key, projectId, title: `Task ${key}`, reporterId });
  });
  out = { ok: true, key: created.key };
} catch (error) {
  const mapped = mapSqliteError(error);
  // A raw SqliteError (mapped === null) is the failure this test guards against.
  out = { ok: false, mappedKind: mapped === null ? null : mapped.kind };
}
adapter.close();

process.stdout.write(JSON.stringify(out));
