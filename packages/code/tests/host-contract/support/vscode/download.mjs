// Downloads a VS Code for the host contract, BEFORE any editor is started and outside the
// namespace the cases run in, and prints where it is and which version it is.
//
// usage: node download.mjs <version|stable> <cache directory>
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const [, , version = 'stable', cachePath] = process.argv;
if (cachePath === undefined) throw new Error('usage: node download.mjs <version|stable> <cache directory>');
const executable = await downloadAndUnzipVSCode({ version, cachePath });
const resolved = executable.match(/vscode-linux-x64-([0-9.]+)/)?.[1];
if (resolved === undefined) throw new Error(`no version in ${executable}`);
console.log(`executable=${executable}`);
console.log(`version=${resolved}`);
