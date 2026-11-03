// Refuses (exit 1) unless every hash the pre-registration manifest cites is the hash of the file or object it cites, as they are
// now: run it before a counted session, and a session does not start when it fails. It reads no key and makes no request.
//   node freeze/verify-prereg.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandTemplate, READER } from '../analysis/llm-reader.mjs';
import { PROMPT as EDIT_PROMPT } from '../editcheck/edit-check.mjs';
import { readWireGz } from '../lib/run-common.mjs';
import { argvTemplate, CODEX_WEB_SEARCH, codexResultDirs, EDIT_CHECK_WALL_CLOCK_MS, HOSTS, MIN_BEFORE_MIDNIGHT_MS, WALL_CLOCK_MS } from '../measured/protocol.mjs';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const read = (p) => readFileSync(join(KIT, p));
const prereg = JSON.parse(read('freeze/prereg.json').toString('utf8'));
const bad = [];
const same = (what, cited, actual) => {
  if (cited !== actual) bad.push(`${what}: cites ${cited}, is ${actual}`);
};
same('freeze/freeze.json', prereg.kit.freeze_json_sha256, sha(read('freeze/freeze.json')));
same('kit.json', prereg.kit.kit_json_sha256, sha(read('kit.json')));
const designDir = join(KIT, '..', 'archive', 'active', 'comparison-after-0.1.4');
same('design.yaml', prereg.design['design.yaml_sha256'], sha(readFileSync(join(designDir, 'design.yaml'))));
same('design.md', prereg.design['design.md_sha256'], sha(readFileSync(join(designDir, 'design.md'))));
same('catalog snapshot', prereg.catalog.snapshot.raw_sha256, sha(read(prereg.catalog.snapshot.file)));
for (const role of ['primary', 'reserve']) same(`endpoints of the ${role} model`, prereg.model[role].endpoints_raw_sha256, sha(read(prereg.model[role].endpoints_file)));
for (const [name, file] of [['neutral', 'seed/parity/prompts/parity-neutral.md'], ['scoped_0_1_4', 'seed/parity/prompts/inline.g.md']]) same(`prompt ${name}`, prereg.measured_session_repository.prompts_sha256[name], sha(read(file)));
for (const [file, cited] of Object.entries(prereg.measured_session_repository.files_sha256)) same(file, cited, sha(read(file)));
same('hook proof of Codex', prereg.codex_hook_trust.proof.sha256, sha(read(prereg.codex_hook_trust.proof.file)));
// The kit's code, as the commit the manifest names holds it (a blob of that commit, not the working tree).
const commit = prereg.kit.commit;
for (const [file, cited] of Object.entries(prereg.kit.files_sha256)) {
  let actual;
  try {
    actual = sha(execFileSync('git', ['show', `${commit}:./${file}`], { cwd: KIT, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    actual = 'not in that commit';
  }
  same(`${file} at ${commit.slice(0, 8)}`, cited, actual);
  // And the working tree holds that same file: a session runs the files on disk, not the commit's.
  same(`${file} in the working tree`, cited, existsSync(join(KIT, file)) ? sha(read(file)) : 'not in the working tree');
}
// The runner's own protocol and the manifest say the same thing: the argv of each host, the limits, the prompts it hands the hosts.
for (const h of HOSTS) same(`argv of ${h}`, JSON.stringify(prereg.session_protocol.hosts[h].argv), JSON.stringify(argvTemplate(h)));
same('wall clock of a counted session', prereg.session_protocol.limits_ms.wall_clock_of_a_counted_session, WALL_CLOCK_MS);
same('wall clock of an edit check', prereg.session_protocol.limits_ms.wall_clock_of_an_edit_check, EDIT_CHECK_WALL_CLOCK_MS);
same('minimum before 00:00 UTC', prereg.session_protocol.limits_ms.minimum_before_00_00_utc, MIN_BEFORE_MIDNIGHT_MS);
same('prompt given to the hosts', prereg.measured_session_repository.prompt_given_to_hosts_sha256, sha(Buffer.from(read('seed/parity/prompts/parity-neutral.md').toString('utf8').trimEnd())));
same('edit check prompt', prereg.edit_check.prompt_sha256, sha(Buffer.from(EDIT_PROMPT)));
// Every file a section of the manifest cites is the file of the kit commit, and the LLM reader's prompt is one of them.
for (const section of ['runner', 'analysis', 'edit_check', 'codex_cost_probe']) {
  for (const [file, cited] of Object.entries(prereg[section].files)) same(`${section}: ${file}`, cited, prereg.kit.files_sha256[file] ?? 'not among the kit files');
}
same('llm reader prompt', prereg.llm_reader.prompt_sha256, prereg.kit.files_sha256[prereg.llm_reader.prompt_file] ?? 'not among the kit files');
same('dry runs summary', prereg.dry_runs.sha256, sha(read(prereg.dry_runs.file)));
same('dry run of the cost probe', prereg.dry_runs.codex_cost_probe_dry_sha256, sha(read(prereg.dry_runs.codex_cost_probe_dry)));
// The dry runs ran under the code that is frozen: no file outside freeze/ differs between the commit they ran at and the frozen one.
const blobAtDry = (file) => {
  try {
    return sha(execFileSync('git', ['show', `${prereg.dry_runs.kit_commit}:./${file}`], { cwd: KIT, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return null;
  }
};
const differ = Object.entries(prereg.kit.files_sha256).filter(([f, h]) => blobAtDry(f) !== h).map(([f]) => f);
same('files that differ between the dry runs\' commit and the frozen one', JSON.stringify(differ), JSON.stringify(prereg.dry_runs.files_of_the_frozen_commit_that_differ_from_the_dry_run_commit));
if (differ.some((f) => !f.startsWith('freeze/'))) bad.push(`the dry runs ran under other code than the one frozen: ${differ.join(', ')}`);
// The live part: every file it left is the one the manifest cites, the labels it cites are the files' own, and the code that changed after the
// live runs is exactly the list the manifest gives.
for (const [file, cited] of Object.entries(prereg.live_checks.files_sha256)) same(file, cited, sha(read(file)));
const changedBetween = (from, to) => execFileSync('git', ['diff', '--name-only', '--relative', from, to, '--', '.', ':!results', ':!freeze'], { cwd: KIT, encoding: 'utf8' }).split('\n').filter(Boolean);
same('code files changed since the live runs (as of the kit commit of revision 3)', JSON.stringify(changedBetween(prereg.live_checks.ran_under_kit_commit, prereg.live_checks.listed_up_to_kit_commit)), JSON.stringify(prereg.live_checks.code_files_changed_since_the_runs));
for (const c of prereg.live_checks.edit_checks) same(`edit check of ${c.host}`, c.label, JSON.parse(read(`results/${c.host}-edit-check/editcheck.json`).toString('utf8')).label);
same('cost probe conclusion', JSON.stringify(prereg.live_checks.codex_cost_probe.conclusion), JSON.stringify(JSON.parse(read('results/codex-cost/cost.json').toString('utf8')).conclusion));
same('cost probe in the edit check section', JSON.stringify(prereg.codex_cost_probe.results), JSON.stringify(prereg.live_checks.codex_cost_probe.conclusion));
// The 4th step: Codex without web search, and the second reader.
same('web search setting of Codex', prereg.session_protocol.hosts.codex.web_search, CODEX_WEB_SEARCH);
same('folders of Codex\'s results', JSON.stringify(prereg.session_protocol.hosts.codex.result_folders), JSON.stringify(codexResultDirs()));
same('folders of Codex\'s results in the web search test', JSON.stringify(prereg.codex_web_search_test.result_folders), JSON.stringify(codexResultDirs()));
for (const [file, cited] of Object.entries(prereg.live_checks_step4.files_sha256)) same(file, cited, sha(read(file)));
same('code files changed since the 4th step runs', JSON.stringify(changedBetween(prereg.live_checks_step4.ran_under_kit_commit, prereg.kit.commit)), JSON.stringify(prereg.live_checks_step4.code_files_changed_since_the_runs));
const probe4 = JSON.parse(read('results/codex-cost-no-web-search/cost.json').toString('utf8'));
same('web search probe conclusion', JSON.stringify(prereg.codex_web_search_test.probe.conclusion), JSON.stringify(probe4.conclusion));
same('web search probe deltas', JSON.stringify(prereg.codex_web_search_test.probe.deltas), JSON.stringify(probe4.steps.map((s) => s.delta)));
same('web search edit check', prereg.codex_web_search_test.edit_check.label, JSON.parse(read('results/codex-edit-check-no-web-search/editcheck.json').toString('utf8')).label);
if (CODEX_WEB_SEARCH === 'disabled' && probe4.conclusion?.cost_per_request !== 1) bad.push('the protocol runs Codex without web search, but its probe did not say a request then costs 1');
// The bodies the probe sent are the first three of the dry run of the configured Codex, and none offers a web_search tool.
const dryBodies = readWireGz(join(KIT, 'results', 'codex-no-web-search-bodies')).filter((r) => r.forwarded === true && r.path === '/responses').slice(0, 3).map((r) => r.request);
same('bodies of the web search probe', JSON.stringify(prereg.codex_web_search_test.probe.body_sha256), JSON.stringify(dryBodies.map((b) => sha(Buffer.from(JSON.stringify(b))))));
same('bodies of the web search probe, as the probe recorded them', JSON.stringify(probe4.steps.map((s) => s.body_sha256)), JSON.stringify(dryBodies.map((b) => sha(Buffer.from(JSON.stringify(b))))));
same('no body of the probe offers web search', JSON.stringify(dryBodies.map((b) => (b.tools ?? []).some((t) => String(t.type).startsWith('web_search')))), JSON.stringify([false, false, false]));
const second = prereg.llm_reader.second_reader;
same('second reader model', second.model, READER.model);
same('second reader command', second.command_template, commandTemplate());
same('second reader command hash', second.command_template_sha256, sha(Buffer.from(commandTemplate())));
same('second reader prompt', second.prompt_sha256, sha(read(READER.prompt_file)));
same('second reader prompt is the reader prompt', second.prompt_sha256, prereg.llm_reader.prompt_sha256);
// What install.sh rebuilt, when it is there.
for (const [host, h] of Object.entries(prereg.hosts)) if (existsSync(join(KIT, h.binary))) same(`${host} binary`, h.binary_sha256, sha(read(h.binary)));
if (existsSync(join(KIT, 'plugin-tag'))) {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  const root = join(KIT, 'plugin-tag');
  const files = walk(root).filter((f) => !f.endsWith('/COMMIT')).sort();
  same('plugin tree', prereg.mnema.plugin_tree_sha256, sha(Buffer.from(files.map((f) => `${sha(readFileSync(f))}  ${f.slice(root.length + 1)}`).join('\n'))));
}
console.log(JSON.stringify({ manifest_sha256: sha(read('freeze/prereg.json')), checked: 'design, catalog, endpoints, prompts, parity files, hook proof, argv and limits against the runner, the sections of the runner, analysis, reader, edit check and probe, the dry runs, the live results (both live parts), the web search probe against the bodies it sent, the second reader\'s model, command and prompt, kit files at the commit, host binaries and plugin tree when installed', mismatches: bad }, null, 2));
process.exit(bad.length === 0 ? 0 : 1);
