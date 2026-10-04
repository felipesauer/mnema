/**
 * Every skill the plugin ships is what it says: it exists, its `name` is its directory, it says
 * when it applies, and every tool it cites is a tool the server serves.
 *
 * WHAT WAS MISSING. A skill is text a host hands a model, and nothing held it to the product: a
 * tool renamed in the server left a skill that pointed at nothing, in the one place that tells an
 * agent what to call. Same shape as `the-agent-is-told-what-it-has.test.ts`, which holds the
 * server's own instructions to `tools/list`.
 *
 * WHAT COUNTS AS CITING A TOOL. A backticked word written in the style of a tool or a field —
 * lowercase words joined by underscores, once the host's own prefix (`mcp__plugin_mnema_mnema__`,
 * `mcp__mnema__`) is taken off — must be a tool the server serves, or a field one takes. A single
 * lowercase word is a tool only when it is one, so a renamed `search` is not found by this and a
 * renamed `record_decision` is; the first is a limit of the discriminant, and said.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureTree } from '@mnema/chain';
import { INITIAL_DECISION_STATE, PROJECT_DIR } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';

const SKILLS = join(fileURLToPath(new URL('../../../', import.meta.url)), 'plugin', 'skills');

/** The host's own prefixes on a tool's name, which a skill may spell. */
const HOST_PREFIXES = ['mcp__plugin_mnema_mnema__', 'mcp__mnema__'];

/** The skills the plugin ships, by directory — and at least the ones this product wrote. */
function skillDirectories(): string[] {
  return readdirSync(SKILLS).filter((name) => statSync(join(SKILLS, name)).isDirectory());
}

/** The frontmatter of a skill file: `name` and `description`, as written. */
function frontmatter(text: string): { name: string; description: string } {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '';
  const field = (key: string): string =>
    new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(block)?.[1]?.trim() ?? '';
  return { name: field('name'), description: field('description') };
}

/** Every markdown file a skill carries: its `SKILL.md` and what is under `references/`. */
function filesOf(directory: string): string[] {
  const found = [join(SKILLS, directory, 'SKILL.md')];
  const references = join(SKILLS, directory, 'references');
  try {
    for (const name of readdirSync(references)) found.push(join(references, name));
  } catch {
    // A skill with no references is an ordinary skill.
  }
  return found;
}

/** The names a text writes in the style of a tool or a field, host prefix off. */
function toolStyled(text: string): string[] {
  const words = [...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] as string);
  return words
    .map((word) => HOST_PREFIXES.reduce((rest, prefix) => rest.replace(prefix, ''), word))
    .filter((word) => /^[a-z]+(_[a-z]+)+$/.test(word));
}

describe('every skill the plugin ships', () => {
  it('finds the skills at all, and the ones this product wrote', () => {
    expect(skillDirectories()).toEqual(
      expect.arrayContaining(['recording-decisions', 'recording-rulings', 'diagnosing-recording']),
    );
  });

  it('exists as a SKILL.md, named as its directory, saying when it applies', () => {
    for (const directory of skillDirectories()) {
      const text = readFileSync(join(SKILLS, directory, 'SKILL.md'), 'utf-8');
      const { name, description } = frontmatter(text);
      expect(name, `${directory}: name`).toBe(directory);
      expect(description.length, `${directory}: description`).toBeGreaterThan(0);
      expect(description, `${directory}: it says WHEN, not what`).toMatch(/^Use when /);
    }
  });

  it('says what a subagent does, where a skill tells an agent to record', () => {
    for (const directory of ['recording-decisions', 'recording-rulings']) {
      const text = readFileSync(join(SKILLS, directory, 'SKILL.md'), 'utf-8');
      expect(text, directory).toContain('<SUBAGENT-STOP>');
      expect(text.replace(/\s+/g, ' '), directory).toMatch(/whoever dispatched you records? it/i);
    }
  });

  it('cites only tools, and fields of tools, that the server serves', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'mnema-skills-'));
    try {
      const project = join(sandbox, 'proj');
      mkdirSync(project, { recursive: true });
      ensureTree({ root: join(project, PROJECT_DIR) });
      const { server } = buildMcpServer({
        cwd: sandbox,
        env: { home: join(sandbox, 'home') },
        log: () => {},
      });
      const client = new Client(
        { name: 'claude-code', version: '1.0.0' },
        { capabilities: { roots: {} } },
      );
      client.setRequestHandler(ListRootsRequestSchema, () => ({
        roots: [{ uri: pathToFileURL(project).href }],
      }));
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      const { tools } = await client.listTools();
      await client.close();
      const served = new Set(tools.map((tool) => tool.name));
      const fields = new Set(
        tools.flatMap((tool) => Object.keys(tool.inputSchema.properties ?? {})),
      );

      const cited = new Set<string>();
      for (const directory of skillDirectories()) {
        for (const file of filesOf(directory)) {
          for (const word of toolStyled(readFileSync(file, 'utf-8'))) {
            cited.add(word);
            expect(
              served.has(word) || fields.has(word) || word === INITIAL_DECISION_STATE,
              `${file} cites \`${word}\`, which this server does not serve`,
            ).toBe(true);
          }
        }
      }
      // Non-vacuity: the doors the skills exist for are among what they cite.
      for (const door of ['record_decision', 'capture_memory', 'governing_rules']) {
        expect(cited.has(door), door).toBe(true);
        expect(served.has(door), `${door} is not served`).toBe(true);
      }
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('would find a tool that was renamed: the discriminant, on a text of its own', () => {
    expect(
      toolStyled('Call `record_decison` or `mcp__mnema__record_decision`, or `search`.'),
    ).toEqual(['record_decison', 'record_decision']);
  });
});
