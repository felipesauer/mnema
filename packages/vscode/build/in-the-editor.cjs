// Runs inside the editor `install-the-vsix.mjs` starts, once per scenario (MNEMA_CHECK). It throws
// when what the extension did is not what the scenario says, which fails the run.
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const vscode = require('vscode');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const id = 'mnema.mnema';

async function until(what, test, ms = 60_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await test();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(500);
  }
}

const asked = () =>
  readFileSync(process.env.MNEMA_CHECK_LOG, 'utf8')
    .split('\n')
    .filter((line) => line !== '');

exports.run = async () => {
  const scenario = process.env.MNEMA_CHECK;
  const installed = vscode.extensions.getExtension(id);
  if (!installed) throw new Error(`${id} is not installed in this editor`);

  if (scenario === 'no-record') {
    // A folder with no `.mnema`: the extension's own activation event is not met, and nothing
    // else starts it. Give the editor time to prove otherwise; the extension must still be asleep,
    // and the command line must never have been run.
    await sleep(15_000);
    if (installed.isActive) throw new Error(`${id} is active in a folder with no .mnema`);
    const lines = asked();
    if (lines.length > 0) {
      throw new Error(`mnema was run in a folder with no .mnema: ${JSON.stringify(lines)}`);
    }
    return;
  }

  if (scenario === 'no-record-container') {
    // The side bar container is there in every folder, and opening it is what a person does to see
    // what mnema has to say. Whether that starts the extension is measured and written to the log
    // of the run; either way, the command line must never be run here, and the extension, when it
    // did start, shows no status bar item and no badge.
    await sleep(5_000);
    await vscode.commands.executeCommand('workbench.view.extension.mnema');
    await sleep(15_000);
    console.log(`no-record-container: opening the container left the extension ${installed.isActive ? 'active' : 'asleep'}`);
    const lines = asked();
    if (lines.length > 0) {
      throw new Error(`mnema was run in a folder with no .mnema: ${JSON.stringify(lines)}`);
    }
    if (installed.isActive) {
      const now = installed.exports.shown();
      if (now.visible !== false) throw new Error('the status bar item is shown in a folder with no .mnema');
      if (now.badge !== undefined) throw new Error('the side bar icon has a badge in a folder with no .mnema');
    }
    return;
  }

  const extension = await until(`${id} to activate in a workspace with a .mnema folder`, () => {
    const found = vscode.extensions.getExtension(id);
    return found?.isActive ? found : undefined;
  });
  const commands = await vscode.commands.getCommands(true);
  // The commands the installed manifest declares are the ones that must be registered: the list is
  // read from the file the editor installed, not written down a second time here.
  const registered = extension.packageJSON.contributes.commands.map((c) => c.command);
  if (registered.length === 0) throw new Error(`${id} declares no command`);
  for (const command of registered) {
    if (!commands.includes(command)) throw new Error(`${command} is not registered`);
  }
  const walkthroughs = extension.packageJSON.contributes.walkthroughs ?? [];
  if (walkthroughs.length !== 1 || walkthroughs[0].steps.length !== 3) {
    throw new Error('the installed manifest does not carry the three-step walkthrough');
  }

  const shown = await until('the status bar item to be settled', () => {
    const now = extension.exports.shown();
    return now.text === 'mnema: reading' ? undefined : now;
  });

  if (scenario === 'no-cli') {
    if (shown.text !== '$(warning) mnema: command not found') {
      throw new Error(`with no mnema command the bar says ${JSON.stringify(shown.text)}`);
    }
    if (!/mnema\.command/.test(shown.tooltip)) {
      throw new Error('the bar does not say what to set');
    }
  } else if (scenario === 'record') {
    const container = extension.packageJSON.contributes.viewsContainers?.activitybar?.[0];
    if (container?.id !== 'mnema') throw new Error('the installed manifest has no mnema container');
    if (!existsSync(join(extension.extensionPath, container.icon))) {
      throw new Error(`the container icon ${container.icon} is not in the installed extension`);
    }
    const badge = await until('the badge to count the proposed decision', () => {
      const now = extension.exports.shown();
      return now.badge?.value === 1 ? now.badge : undefined;
    });
    if (badge.tooltip !== '1 decision awaits a judgment') {
      throw new Error(`the badge says ${JSON.stringify(badge.tooltip)}`);
    }
    if (!/^\$\((book|info)\) mnema: [a-z-]+/.test(shown.text)) {
      throw new Error(`with a record the bar says ${JSON.stringify(shown.text)}`);
    }
    if (!shown.tooltip.includes('local integrity verified')) {
      throw new Error(
        `the tooltip does not carry what mnema verify printed: ${JSON.stringify(shown.tooltip)}`,
      );
    }
    const lines = asked();
    for (const wanted of ['--version', 'verify --json', 'verify']) {
      if (!lines.includes(wanted)) {
        throw new Error(`mnema was never asked "${wanted}": ${JSON.stringify(lines)}`);
      }
    }
  } else {
    throw new Error(`unknown scenario ${scenario}`);
  }
};
