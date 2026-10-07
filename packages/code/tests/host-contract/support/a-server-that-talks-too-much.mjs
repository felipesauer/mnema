// A bare MCP server over stdio that serves no tool and sends the `instructions` it is given.
// What the host does with instructions past its ceiling is the host's; this only gives it a text
// to cut.
//
// usage: node a-server-that-talks-too-much.mjs <name> <instructions>
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const [, , name, instructions] = process.argv;
const server = new Server({ name, version: '0.0.1' }, { capabilities: { tools: {} }, instructions });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
await server.connect(new StdioServerTransport());
