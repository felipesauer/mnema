// Reads the VS Code probe's output dir; exits 1 if a fact does not hold.
import { existsSync, readFileSync } from 'node:fs';

const out = process.argv[2];
const log = readFileSync(`${out}/runner.log`, 'utf8');
console.log(log.replace(/extensions loaded: .*\n/, ''));
let bad = 0;
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) bad = 1;
};
check('registerLanguageModelChatProvider registered with no API proposal enabled', log.includes('REGISTERED without any API proposal'));
check('Copilot Chat is present in the editor the test-electron download gives', /copilot-chat present=true/.test(log));
check('the stand-in model was offered to the chat', log.includes('probe models: probe-0'));
check('a PreToolUse hook fired', existsSync(`${out}/hook-fired.txt`));
check('the tool the hook allowed ran (file written)', log.includes('written.txt exists: true'));
const cap2 = existsSync(`${out}/capture-2.json`) ? readFileSync(`${out}/capture-2.json`, 'utf8') : '';
check('the hook additionalContext is in the NEXT model request', cap2.includes('HOOK_CONTEXT_MARKER_7Q2'));
process.exit(bad);
