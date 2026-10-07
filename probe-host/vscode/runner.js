// Runs inside the extension host (--extensionTestsPath). Opens the chat in agent mode on the
// stand-in model, submits one prompt, and waits for the facts.
const vscode = require('vscode');
const fs = require('node:fs');

const out = process.env.PROBE_OUT;
const ws = process.env.PROBE_WS;
const log = (m) => fs.appendFileSync(`${out}/runner.log`, `${new Date().toISOString()} ${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.run = async () => {
  try {
    log('runner start');
    if (!vscode.extensions.getExtension('GitHub.copilot-chat')) {
      log('copilot-chat not registered at start: running the anonymous local setup');
      const setup = vscode.commands
        .executeCommand('workbench.action.chat.triggerSetupAnonymousWithoutDialog')
        .then((r) => log(`anonymous setup resolved: ${JSON.stringify(r)}`), (e) => log(`anonymous setup threw: ${e}`));
      await Promise.race([setup, sleep(90000)]);
    }
    for (let i = 0; i < 120 && !vscode.extensions.getExtension('GitHub.copilot-chat'); i++) await sleep(500);
    log(`extensions loaded: ${vscode.extensions.all.length}: ${vscode.extensions.all.map((e) => e.id).join(' ')}`);
    const all = vscode.extensions.all.map((e) => `${e.id}@${e.packageJSON.version}${e.packageJSON.isBuiltin ? '' : ''}`);
    log(`extensions: ${all.filter((i) => /copilot|chat/i.test(i)).join(', ') || 'NO copilot/chat extension'}`);
    const cp = vscode.extensions.getExtension('GitHub.copilot-chat');
    log(`copilot-chat present=${!!cp} version=${cp?.packageJSON.version} active=${cp?.isActive}`);
    if (cp && !cp.isActive) {
      try {
        await cp.activate();
        log('copilot-chat activated');
      } catch (e) {
        log(`copilot-chat activate error: ${e}`);
      }
    }
    for (const key of ['chat.useHooks', 'chat.hooks.enabled', 'chat.tools.global.autoApprove']) {
      const i = vscode.workspace.getConfiguration().inspect(key);
      log(`setting ${key}: ${i ? `default=${JSON.stringify(i.defaultValue)} global=${JSON.stringify(i.globalValue)}` : 'unknown'}`);
    }
    let models = [];
    for (let i = 0; i < 40 && models.length === 0; i++) {
      models = await vscode.lm.selectChatModels({ vendor: 'probe' });
      if (models.length === 0) await sleep(500);
    }
    log(`probe models: ${models.map((m) => m.id).join(', ') || 'NONE'}`);
    log(`lm.tools: ${vscode.lm.tools.length}; writers: ${vscode.lm.tools.filter((t) => /create_?file/i.test(t.name)).map((t) => t.name).join(',') || 'none'}`);
    try {
      const r = await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: 'Say hi.',
        mode: 'agent',
        isPartialQuery: false,
        modelSelector: { vendor: 'probe', id: 'probe-0' },
        blockOnResponse: true,
      });
      log(`chat.open returned: ${JSON.stringify(r)?.slice(0, 300)}`);
    } catch (e) {
      log(`chat.open threw: ${e?.stack ?? e}`);
    }
    for (let i = 0; i < 30 && !fs.existsSync(`${ws}/written.txt`); i++) await sleep(500);
    await sleep(3000);
    log(`written.txt exists: ${fs.existsSync(`${ws}/written.txt`)}`);
    log(`hook marker exists: ${fs.existsSync(`${out}/hook-fired.txt`)}`);
    log(`captures: ${fs.readdirSync(out).filter((f) => f.startsWith('capture-')).join(', ') || 'NONE'}`);
  } catch (e) {
    log(`runner error: ${e?.stack ?? e}`);
  }
};
