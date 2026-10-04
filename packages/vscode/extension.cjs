// The extension host loads a CommonJS entry; the extension itself is ESM and is loaded from here.
let loaded;
exports.activate = async (context) => {
  loaded = await import('./dist/extension.js');
  return loaded.activate(context, require('vscode'));
};
exports.deactivate = () => loaded?.deactivate?.();
