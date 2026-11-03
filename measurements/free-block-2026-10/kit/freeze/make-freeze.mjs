// Writes freeze/freeze.json: everything the pre-registration of the free block fixes that can be read off this kit, as of
// now. It takes the catalog snapshot only if asked (--snapshot): a snapshot is a moment, and the one in this folder was
// taken when the kit was frozen. It holds no key, reads none, and makes no model request (the catalog and the endpoint
// lists are public; the generation lookups were made by capcheck/verify-served.mjs).
//
//   node freeze/make-freeze.mjs [--kit-commit <sha>]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKER, MAX_REQUESTS, MAX_TOOL_CALLS } from '../capcheck/criterion.mjs';
import { FILES } from '../seed/make-parity-repo.mjs';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(KIT, p));
const json = (p) => JSON.parse(read(p).toString('utf8'));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const kit = json('kit.json');
const args = process.argv.slice(2);
const kitCommit = args.includes('--kit-commit') ? args[args.indexOf('--kit-commit') + 1] : null;

const snapshotFile = readdirSync(join(KIT, 'freeze')).filter((f) => /^models-\d{8}\.json$/.test(f)).sort().at(-1);
const catalog = read(`freeze/${snapshotFile}`);
const projection = (file) => {
  const d = JSON.parse(read(`freeze/${file}`).toString('utf8')).data;
  const stable = JSON.stringify(sortKeys({ id: d.id, created: d.created, endpoints: d.endpoints.map(({ name, tag, context_length, pricing, quantization, supported_parameters, supports_tool_choice }) => ({ name, tag, context_length, pricing, quantization, supported_parameters, supports_tool_choice })) }));
  return { projection_sha256: sha(Buffer.from(`${stable}\n`)), created: d.created, created_iso: new Date(d.created * 1000).toISOString(), endpoints: d.endpoints.map((e) => ({ name: e.name, tag: e.tag, context_length: e.context_length, supports_tool_choice: e.supports_tool_choice })) };
};
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
const endpointFiles = readdirSync(join(KIT, 'freeze')).filter((f) => f.startsWith('endpoints-'));
const modelFile = (id) => endpointFiles.find((f) => f.startsWith(`endpoints-${id.replace(/[/:]/g, '_')}-`));
const models = {};
for (const [role, m] of [['primary', kit.model], ['reserve', kit.reserve]]) {
  const f = modelFile(m.id);
  models[role] = { id: m.id, provider_tag: m.provider_tag, endpoint_name: m.endpoint_name, context_length: m.context_length, endpoints_file: `freeze/${f}`, endpoints_raw_sha256: sha(read(`freeze/${f}`)), ...projection(f) };
}

// What the primary was SERVED as, in the runs: the stream's own fields, and OpenRouter's generation record per request.
const served = { by_stream_events: {}, by_generation_record: {}, requests_checked: 0 };
for (const run of ['direct', 'qwen', 'copilot', 'opencode', 'codex', 'codex-hooks-trusted', 'probe-responses', 'probe-responses-stream']) {
  const meta = json(`results/${run}/meta.json`);
  for (const [k, n] of Object.entries(meta.served)) served.by_stream_events[k] = (served.by_stream_events[k] ?? 0) + n;
  for (const g of json(`results/${run}/served-verified.json`)) {
    const k = `${g.model} | ${g.provider_name}`;
    served.by_generation_record[k] = (served.by_generation_record[k] ?? 0) + 1;
    served.requests_checked += 1;
  }
}

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const hosts = {};
for (const [h, pin] of Object.entries(kit.hosts)) {
  const bin = join(KIT, pin.bin);
  const lock = json(`installed/${h}/package-lock.json`);
  const integrity = Object.fromEntries(Object.entries(lock.packages).filter(([k]) => k.endsWith(`/${pin.package.split('/').pop()}`) || /-linux-x64$/.test(k)).map(([k, v]) => [k.replace(/^node_modules\//, ''), { version: v.version, integrity: v.integrity }]));
  let signatures = '';
  try {
    signatures = execFileSync('npm', ['audit', 'signatures'], { cwd: join(KIT, 'installed', h), encoding: 'utf8', timeout: 90_000 }).trim().split('\n').filter(Boolean).slice(-2).join(' ');
  } catch (e) {
    signatures = `npm audit signatures failed: ${String(e.message).slice(0, 120)}`;
  }
  hosts[h] = { package: pin.package, version: pin.version, binary: pin.bin, binary_sha256: sha(readFileSync(bin)), integrity, npm_audit_signatures: signatures };
}
const mnemaLock = json('mnema-pkg/package-lock.json');
let mnemaSignatures = '';
try {
  mnemaSignatures = execFileSync('npm', ['audit', 'signatures'], { cwd: join(KIT, 'mnema-pkg'), encoding: 'utf8', timeout: 90_000 }).trim().split('\n').filter(Boolean).slice(-2).join(' ');
} catch (e) {
  mnemaSignatures = `npm audit signatures failed: ${String(e.message).slice(0, 120)}`;
}
const pluginFiles = walk(join(KIT, 'plugin-tag')).filter((f) => !f.endsWith('/COMMIT')).sort();
const pluginTree = sha(Buffer.from(pluginFiles.map((f) => `${sha(readFileSync(f))}  ${f.slice(join(KIT, 'plugin-tag').length + 1)}`).join('\n')));

const designDir = join(KIT, '..', 'archive', 'active', 'comparison-after-0.1.4');
// Every file of the kit's code at the commit, by the hash of the blob the commit holds (not of the working tree): results/ and the
// data in freeze/ are what the kit produced and froze, not what it is; the scripts in freeze/ are the kit.
const gitIn = (...a) => execFileSync('git', a, { cwd: KIT, encoding: 'utf8', maxBuffer: 1 << 28 });
const kitFiles = kitCommit === null ? [] : gitIn('ls-tree', '-r', '--name-only', kitCommit, '--', '.').split('\n').filter((f) => f !== '' && !f.startsWith('results/') && !(f.startsWith('freeze/') && !f.endsWith('.mjs')));
const blobSha = (f) => createHash('sha256').update(execFileSync('git', ['show', `${kitCommit}:./${f}`], { cwd: KIT, maxBuffer: 1 << 28 })).digest('hex');
const capability = {};
for (const run of ['direct', 'qwen', 'copilot', 'opencode', 'codex', 'codex-hooks-trusted']) {
  const v = json(`results/${run}/verdict.json`);
  const meta = json(`results/${run}/meta.json`);
  capability[run] = { label: v.label ?? (v.pass ? 'passed' : 'failed'), requests_forwarded: meta.forwarded, refused_by_relay: meta.refusedLocally, calls_to_mnema: (v.verdict ?? v).toolCalls, discovery_calls_tool_search: (v.verdict ?? v).discoveryCalls ?? 0, other_host_calls: (v.verdict ?? v).otherHostCalls ?? 0, calls_of_every_kind: (v.verdict ?? v).toolCallsCountingDiscovery ?? (v.verdict ?? v).toolCalls, final_text: (v.verdict ?? v).finalText };
}

const freeze = {
  frozen_at: new Date().toISOString(),
  design: { directory: 'mnema/archive/active/comparison-after-0.1.4', 'design.yaml_sha256': sha(readFileSync(join(designDir, 'design.yaml'))), 'design.md_sha256': sha(readFileSync(join(designDir, 'design.md'))) },
  models,
  served_in_the_capability_check: served,
  catalog_snapshot: { file: `freeze/${snapshotFile}`, taken_at: json('freeze/snapshot.json').taken_at, bytes: catalog.length, raw_sha256: sha(catalog) },
  hosts,
  mnema: { package: kit.mnema.package, version: kit.mnema.version, integrity: mnemaLock.packages['node_modules/@mnema/code']?.integrity, npm_audit_signatures: mnemaSignatures, tag: kit.mnema.tag, plugin_commit: read('plugin-tag/COMMIT').toString('utf8').trim(), plugin_tree_sha256: pluginTree },
  kit: { commit: kitCommit, tree: kitCommit === null ? null : execFileSync('git', ['rev-parse', `${kitCommit}:mnema/ab-free-block`], { cwd: KIT, encoding: 'utf8' }).trim(), files_sha256: Object.fromEntries(kitFiles.map((f) => [f, blobSha(f)])), node: process.version },
  criterion: {
    marker: MARKER,
    max_model_requests: MAX_REQUESTS,
    ceiling: { calls_to_mnema: MAX_TOOL_CALLS, counts: 'calls to mnema (a refused attempt through a host bridge is a call to mnema)', does_not_count: ['the host\'s own tool_search of deferred tools (discovery_calls)', 'any other tool of the host (other_host_calls)'], also_kept: 'calls_of_every_kind (every call of every kind), beside the number the ceiling is read against', ruled_by: 'the maintainer, 29 October 2026, observation 01a1897f-99c4 on ADR-119' },
  },
  measured_session_repository: {
    generator: 'seed/make-parity-repo.mjs',
    provenance: json('seed/parity/provenance.json'),
    files_sha256: { 'seed/parity/org-08.json': sha(read('seed/parity/org-08.json')), 'seed/parity/prompts/inline.g.md': sha(read('seed/parity/prompts/inline.g.md')), 'seed/parity/prompts/parity-neutral.md': sha(read('seed/parity/prompts/parity-neutral.md')), 'seed/parity/extract.py': sha(read('seed/parity/extract.py')) },
    seed_working_tree_sha256: sha(Buffer.from(Object.entries(FILES).sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, t]) => `${sha(Buffer.from(t))}  ${p}`).join('\n'))),
    seed_files: Object.keys(FILES).sort(),
  },
  capability_check: capability,
};
writeFileSync(join(KIT, 'freeze', 'freeze.json'), `${JSON.stringify(freeze, null, 2)}\n`);
console.log(JSON.stringify({ catalog: freeze.catalog_snapshot, projections: { primary: models.primary.projection_sha256, reserve: models.reserve.projection_sha256 }, served: served }, null, 2));
