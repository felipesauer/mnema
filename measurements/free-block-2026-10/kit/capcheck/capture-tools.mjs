// Captures, once, from the real server of the pinned mnema, the 27 tool definitions (capcheck/tools.json) that the
// direct check offers a model. It talks to no model and writes into a throwaway repository.
//   node capcheck/capture-tools.mjs <scratchDir>
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMcp } from '../lib/mcp-client.mjs';
import { makeCapcheckRepo, MNEMA_CLI, sandboxEnv } from '../seed/make-repo.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const scratch = process.argv[2];
rmSync(join(scratch, 'capture'), { recursive: true, force: true });
mkdirSync(join(scratch, 'capture'), { recursive: true });
const repo = makeCapcheckRepo(join(scratch, 'capture', 'project'), join(scratch, 'capture', 'home'));
const mcp = startMcp(process.execPath, [MNEMA_CLI, 'mcp'], { cwd: repo.project, env: sandboxEnv(repo.home) });
await mcp.initialize();
const tools = (await mcp.listTools()).tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
writeFileSync(join(here, 'tools.json'), `${JSON.stringify(tools, null, 2)}\n`);
const read = await mcp.callTool('read_record', { id: repo.decisionId });
writeFileSync(join(scratch, 'capture', 'read_record.json'), JSON.stringify(read, null, 2));
console.log(tools.length, 'tools written; read_record result:');
console.log(read.content[0].text.replaceAll(repo.project, '<project>'));
mcp.close();
