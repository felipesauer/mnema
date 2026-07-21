// Child process for task-create-concurrent-processes.test.ts. Inserts ONE task
// the way TaskService.create does — a fresh committed id minted inside the
// insert — through a REAL TaskRepository+SqliteAdapter against the same
// state.db every sibling opens. Run as a separate OS process (not a worker
// thread) so the write races through the SQLite file the way two
// `mnema mcp serve` processes actually would. Wrapped in
// runInTransactionImmediate so the write lock is taken up front — the
// regression is that concurrent creators must serialise cleanly on one
// state.db, every insert getting a distinct id and any loser surfacing a
// mapped (never raw) SqliteError. Emits the created id (or the mapped error)
// as JSON on stdout so the parent can assert.
import { pathToFileURL } from 'node:url';

const [, , distRoot, statePath, projectId, reporterId] = process.argv;

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
    return tasks.insert({ projectId, title: 'Concurrent task', reporterId });
  });
  out = { ok: true, id: created.id };
} catch (error) {
  const mapped = mapSqliteError(error);
  // A raw SqliteError (mapped === null) is the failure this test guards against.
  out = { ok: false, mappedKind: mapped === null ? null : mapped.kind };
}
adapter.close();

process.stdout.write(JSON.stringify(out));
