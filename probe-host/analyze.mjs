// Reads one run's output dir and prints the facts the probe is about; exits 1 if one fails.
import { existsSync, readFileSync } from 'node:fs';

const out = process.argv[2];
let bad = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${detail}`);
  if (!ok) bad = 1;
};
const reqs = JSON.parse(readFileSync(`${out}/api-requests.json`, 'utf8'));
const messages = reqs.filter((r) => String(r.url).includes('/v1/messages'));
console.log('requests to the fake API:', reqs.map((r) => r.url).join(' '));
const withTools = messages.findIndex((r) => (r.body.tools ?? []).some((t) => t.name === 'Write'));
check('a request offered Write', withTools >= 0);
const next = messages
  .slice(withTools + 1)
  .find((r) => JSON.stringify(r.body.messages ?? []).includes('tool_result'));
check('the NEXT request carries the tool_result', !!next);
const nextText = JSON.stringify(next?.body ?? {});
check('hook additionalContext reached the next request', nextText.includes('HOOK_CONTEXT_MARKER_7Q2'));
check('hook marker file written', existsSync(`${out}/hook-fired.txt`));
check('the Write really happened', existsSync(`${out}/project/written.txt`));
const sys = JSON.stringify(messages[0]?.body.system ?? '');
const m = sys.match(/cc_version=[^;\\"]+/);
console.log('attribution block version:', m ? m[0] : '(none found)');
if (process.env.PINNED) check('attribution block carries the pinned version', !!m && m[0].startsWith(`cc_version=${process.env.PINNED}.`), `(pinned ${process.env.PINNED})`);
const connFile = `${out}/api-requests.json.connections`;
console.log(`connections the fake API accepted:\n${existsSync(connFile) ? readFileSync(connFile, 'utf8') : ''}`);
if (existsSync(`${out}/connect.strace`)) {
  const lines = readFileSync(`${out}/connect.strace`, 'utf8')
    .split('\n')
    .filter((l) => /AF_INET6?/.test(l) && /(connect|sendto|sendmsg)\(/.test(l));
  const dests = [
    ...new Set(
      lines.map((l) => {
        const g = l.match(/inet_addr\("([^"]+)"\)|inet_pton\(AF_INET6, "([^"]+)"/);
        return g ? (g[1] ?? g[2]) : l.trim().slice(0, 160);
      }),
    ),
  ];
  console.log('distinct AF_INET/INET6 destinations (connect/sendto/sendmsg):', JSON.stringify(dests));
  check('every destination is loopback', dests.every((d) => /^(127\.|::1)/.test(d)));
  check('the strace saw at least one connect', lines.length > 0);
}
process.exit(bad);
