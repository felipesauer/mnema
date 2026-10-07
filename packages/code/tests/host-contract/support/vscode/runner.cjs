// Runs inside VS Code's extension host (`--extensionTestsPath`). It gets the chat agent onto the
// stand-in model, submits one prompt, and waits until something happened or the time is up. It
// asserts nothing: what it saw is in `runner.log`, and the case reads that and the captures.
const vscode = require('vscode');
const fs = require('node:fs');

const out = process.env.MNEMA_CONTRACT_OUT;
const workspace = process.env.MNEMA_CONTRACT_WORKSPACE;
const target = `${workspace}/${process.env.MNEMA_CONTRACT_TARGET}`;
const waitMs = Number(process.env.MNEMA_CONTRACT_WAIT_MS ?? '30000');
const log = (message) =>
  fs.appendFileSync(`${out}/runner.log`, `${new Date().toISOString()} ${message}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const present = () => vscode.extensions.getExtension('GitHub.copilot-chat');

exports.run = async () => {
  try {
    log('runner start');
    if (!present()) {
      // The chat agent is part of the editor but is not switched on until it is set up; the
      // anonymous setup needs no account and no network.
      log('copilot-chat not registered at start: running the anonymous local setup');
      const setup = vscode.commands
        .executeCommand('workbench.action.chat.triggerSetupAnonymousWithoutDialog')
        .then(
          (result) => log(`anonymous setup resolved: ${JSON.stringify(result)}`),
          (error) => log(`anonymous setup threw: ${error}`),
        );
      await Promise.race([setup, sleep(90000)]);
    }
    for (let i = 0; i < 120 && !present(); i += 1) await sleep(500);
    const chat = present();
    log(`copilot-chat present=${!!chat} version=${chat?.packageJSON.version} active=${chat?.isActive}`);
    if (chat && !chat.isActive) {
      try {
        await chat.activate();
        log('copilot-chat activated');
      } catch (error) {
        log(`copilot-chat activate error: ${error}`);
      }
    }
    let models = [];
    for (let i = 0; i < 40 && models.length === 0; i += 1) {
      models = await vscode.lm.selectChatModels({ vendor: 'stand-in' });
      if (models.length === 0) await sleep(500);
    }
    log(`stand-in models: ${models.map((m) => m.id).join(', ') || 'NONE'}`);
    // Not awaited: where the agent holds the write for a person, the response never completes, and
    // the command says so by returning the confirmation it stopped on.
    let held = false;
    vscode.commands
      .executeCommand('workbench.action.chat.open', {
        query: 'Say hi.',
        mode: 'agent',
        isPartialQuery: false,
        modelSelector: { vendor: 'stand-in', id: 'stand-in-0' },
        blockOnResponse: true,
      })
      .then(
        (result) => {
          log(`chat.open returned: ${JSON.stringify(result)?.slice(0, 200)}`);
          held = result?.type === 'confirmation';
        },
        (error) => log(`chat.open threw: ${error?.stack ?? error}`),
      );
    const until = Date.now() + waitMs;
    while (
      Date.now() < until &&
      !held &&
      !fs.existsSync(target) &&
      !fs.existsSync(`${out}/capture-2.json`)
    ) {
      await sleep(250);
    }
    // What the agent does after the call, and a held write that is still held, both take a moment.
    await sleep(Number(process.env.MNEMA_CONTRACT_SETTLE_MS ?? '3000'));
    log(`held for a confirmation: ${held}`);
    log(`target exists: ${fs.existsSync(target)}`);
    log(`captures: ${fs.readdirSync(out).filter((f) => f.startsWith('capture-')).join(', ') || 'NONE'}`);
  } catch (error) {
    log(`runner error: ${error?.stack ?? error}`);
  }
};
