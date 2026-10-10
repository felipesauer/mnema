// Runs inside the editor `install-the-vsix.mjs` starts: the installed extension must be active
// without anyone asking it to be, because the workspace holds a `.mnema` folder, and its commands
// must be there. It throws when it is not, which fails the run.
const vscode = require('vscode');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.run = async () => {
  const id = 'felipesauer.mnema';
  const deadline = Date.now() + 60_000;
  let extension = vscode.extensions.getExtension(id);
  while (!extension?.isActive && Date.now() < deadline) {
    await sleep(500);
    extension = vscode.extensions.getExtension(id);
  }
  if (!extension) throw new Error(`${id} is not installed in this editor`);
  if (!extension.isActive) throw new Error(`${id} did not activate in a workspace with a .mnema folder`);
  const commands = await vscode.commands.getCommands(true);
  const registered = [
    'mnema.accept',
    'mnema.reject',
    'mnema.refresh',
    'mnema.showRules',
    'mnema.stacks.add',
    'mnema.stacks.addFromIndex',
    'mnema.stacks.show',
    'mnema.stacks.diff',
    'mnema.stacks.check',
    'mnema.stacks.remove',
    'mnema.stacks.export',
  ];
  for (const command of registered) {
    if (!commands.includes(command)) throw new Error(`${command} is not registered`);
  }
};
