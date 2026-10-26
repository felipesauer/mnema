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
  // The commands the installed manifest declares are the ones that must be registered: the list is
  // read from the file the editor installed, not written down a second time here.
  const registered = extension.packageJSON.contributes.commands.map((c) => c.command);
  if (registered.length === 0) throw new Error(`${id} declares no command`);
  for (const command of registered) {
    if (!commands.includes(command)) throw new Error(`${command} is not registered`);
  }
};
