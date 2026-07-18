// Child process for audit-writer-concurrent-processes.test.ts. Writes N
// chained audit events through a REAL AuditWriter+SqliteAdapter, sharing the
// same auditDir/state.db as every sibling process spawned by the test. Run
// as a separate OS process (not a worker thread) so the cross-process file
// lock (`proper-lockfile`) is actually exercised — an in-process simulation
// proves nothing about the failure mode this regression test targets.
import { pathToFileURL } from 'node:url';

const [, , distRoot, auditDir, statePath, actor, count] = process.argv;

const { AuditService } = await import(
  pathToFileURL(`${distRoot}/services/integrity/audit-service.js`).href
);
const { AuditWriter } = await import(pathToFileURL(`${distRoot}/storage/audit/audit-writer.js`).href);
const { AuditStateRepository } = await import(
  pathToFileURL(`${distRoot}/storage/sqlite/repositories/audit-state-repository.js`).href
);
const { SqliteAdapter } = await import(
  pathToFileURL(`${distRoot}/storage/sqlite/sqlite-adapter.js`).href
);

const adapter = new SqliteAdapter(statePath);
const state = new AuditStateRepository(adapter);
const writer = new AuditWriter(auditDir, state, () => Buffer.alloc(32, 7));
const audit = new AuditService(writer);

for (let i = 0; i < Number(count); i++) {
  audit.write({ kind: 'task_created', actor, data: { key: `${actor}-${i}` } });
}
adapter.close();
