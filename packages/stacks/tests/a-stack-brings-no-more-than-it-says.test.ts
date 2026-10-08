import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StackManifest } from '../src/manifest.js';
import type { Problem } from '../src/problem.js';
import { validateStack } from '../src/validate.js';
import { cleanScratch, HELLO_STACK, put, scratchStack } from './support.js';

afterEach(cleanScratch);

const codes = (problems: readonly Problem[]): string[] => problems.map((p) => p.code);

/** hello-stack's manifest, with the keys given laid over it. */
const manifestWith = (extra: Record<string, unknown>): string =>
  JSON.stringify({
    name: 'hello-stack',
    version: '1.0.0',
    description: 'A one-skill, one-agent stack that says hello.',
    author: { name: 'Example Author' },
    license: 'Apache-2.0',
    ...extra,
  });

describe('hello-stack', () => {
  it('is valid, brings what it says, and carries a digest', () => {
    const report = validateStack(HELLO_STACK);
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.found).toEqual({ skills: ['hello'], agents: ['greeter'], hooks: [] });
    expect(report.manifest?.name).toBe('hello-stack');
    expect(report.digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('an MCP server is refused in every form it takes', () => {
  it.each([
    ['a .mcp.json at the root', '.mcp.json', '{"mcpServers":{}}'],
    ['a .mcp.json inside a skill', 'skills/hello/.mcp.json', '{}'],
    ['an .mcpb bundle', 'tools/server.mcpb', 'zip'],
    ['mcpServers in a plugin manifest', '.claude-plugin/plugin.json', '{"mcpServers":{"a":{}}}'],
    ['an escaped mcpServers key', 'conf/a.json', '{"mcp\\u0053ervers":{"a":{}}}'],
    [
      'mcpServers in a .jsonc with comments',
      'conf/a.jsonc',
      '// servers\n{"x":{"mcpServers":{}},}\n',
    ],
    ['an mcp_servers table in a .toml', 'conf/config.toml', '[mcp_servers.docs]\ncommand = "x"\n'],
    ['a nested mcp_servers table in a .toml', 'conf/config.toml', '[tool.mcp_servers]\n'],
  ])('%s', (_what, path, content) => {
    const dir = scratchStack();
    put(dir, path, content);
    const report = validateStack(dir);
    expect(report.ok).toBe(false);
    expect(codes(report.problems)).toContain('mcp-server');
  });

  it('mcpServers in stack.json itself', () => {
    const dir = scratchStack();
    put(dir, 'stack.json', manifestWith({ mcpServers: { a: { command: 'x' } } }));
    expect(codes(validateStack(dir).problems)).toContain('mcp-server');
  });

  it('mcpServers nested in a field of stack.json', () => {
    const dir = scratchStack();
    put(dir, 'stack.json', manifestWith({ hooks: [{ name: 'h', mcpServers: {} }] }));
    expect(codes(validateStack(dir).problems)).toContain('mcp-server');
  });
});

describe('hooks are declared one by one and never on', () => {
  const hook = {
    name: 'format',
    event: 'after-edit',
    file: 'hooks/format.sh',
    description: 'Formats the file.',
  };

  it('a declared hook, off, with its file, is valid and listed apart', () => {
    const dir = scratchStack();
    put(dir, 'hooks/format.sh', '#!/bin/sh\n');
    put(
      dir,
      'stack.json',
      manifestWith({
        hooks: [hook],
        brings: { skills: ['hello'], agents: ['greeter'], hooks: ['format'] },
      }),
    );
    const report = validateStack(dir);
    expect(report.problems).toEqual([]);
    expect(report.found.hooks).toEqual(['format']);
    expect((report.manifest as StackManifest).hooks).toEqual([hook]);
  });

  it('a hook that says it is enabled is refused', () => {
    const dir = scratchStack();
    put(dir, 'hooks/format.sh', '#!/bin/sh\n');
    put(
      dir,
      'stack.json',
      manifestWith({
        hooks: [{ ...hook, enabled: true }],
        brings: { skills: ['hello'], agents: ['greeter'], hooks: ['format'] },
      }),
    );
    expect(codes(validateStack(dir).problems)).toContain('hook-enabled');
  });

  it('a hook with enabled false is accepted: the manifest may only say it is off', () => {
    const dir = scratchStack();
    put(dir, 'hooks/format.sh', '#!/bin/sh\n');
    put(
      dir,
      'stack.json',
      manifestWith({
        hooks: [{ ...hook, enabled: false }],
        brings: { skills: ['hello'], agents: ['greeter'], hooks: ['format'] },
      }),
    );
    expect(validateStack(dir).problems).toEqual([]);
  });

  it('a script under hooks/ that no hook declares is refused', () => {
    const dir = scratchStack();
    put(dir, 'hooks/sneaky.sh', '#!/bin/sh\n');
    expect(codes(validateStack(dir).problems)).toContain('hook-undeclared');
  });

  it('a declared hook whose file is not there is refused', () => {
    const dir = scratchStack();
    put(
      dir,
      'stack.json',
      manifestWith({
        hooks: [hook],
        brings: { skills: ['hello'], agents: ['greeter'], hooks: ['format'] },
      }),
    );
    expect(codes(validateStack(dir).problems)).toContain('hook-file-missing');
  });

  it('a hook file outside hooks/ is refused', () => {
    const dir = scratchStack();
    put(dir, 'stack.json', manifestWith({ hooks: [{ ...hook, file: 'skills/hello/run.sh' }] }));
    expect(codes(validateStack(dir).problems)).toContain('hook-invalid');
  });
});

describe('the rest of the contract', () => {
  it('brings is a declaration: the files are the evidence', () => {
    const dir = scratchStack();
    put(dir, 'skills/extra/SKILL.md', '---\nname: extra\ndescription: One more.\n---\n');
    const report = validateStack(dir);
    expect(codes(report.problems)).toEqual(['brings-mismatch']);
    expect(report.problems[0]?.message).toContain('[extra, hello]');
  });

  it('a skill whose name is not its directory is refused', () => {
    const dir = scratchStack();
    put(dir, 'skills/hello/SKILL.md', '---\nname: howdy\ndescription: Greets.\n---\n');
    expect(codes(validateStack(dir).problems)).toEqual(['skill-invalid']);
  });

  it('a skill with no SKILL.md, or no description, or an unknown field, is refused', () => {
    for (const body of [
      undefined,
      '---\nname: hello\n---\n',
      '---\nname: hello\ndescription: d\ncolour: red\n---\n',
    ]) {
      const dir = scratchStack();
      if (body === undefined) rmSync(join(dir, 'skills/hello/SKILL.md'));
      else put(dir, 'skills/hello/SKILL.md', body);
      if (body === undefined) put(dir, 'skills/hello/notes.md', 'x');
      expect(codes(validateStack(dir).problems)).toEqual(['skill-invalid']);
    }
  });

  it('an agent that is not agents/<name>.md with name and description and tools is refused', () => {
    const dir = scratchStack();
    put(dir, 'agents/greeter.md', '---\nname: other\ndescription: d\n---\n');
    expect(codes(validateStack(dir).problems)).toContain('agent-invalid');
    put(dir, 'agents/nested/deep.md', '---\nname: deep\n---\n');
    expect(
      validateStack(dir).problems.filter((p) => p.code === 'agent-invalid').length,
    ).toBeGreaterThan(1);
  });

  it('a manifest with a missing field, an unknown field, or no license file is refused', () => {
    const dir = scratchStack();
    put(dir, 'stack.json', manifestWith({ colour: 'red', license: '' }));
    const report = validateStack(dir);
    expect(codes(report.problems)).toEqual(['manifest-invalid', 'manifest-invalid']);
    rmSync(join(dir, 'LICENSE'));
    expect(codes(validateStack(dir).problems)).toContain('no-license-file');
  });

  it('a stack with no stack.json, or with one that is not JSON, is refused', () => {
    const dir = scratchStack();
    put(dir, 'stack.json', '{nope');
    expect(codes(validateStack(dir).problems)).toEqual(['manifest-invalid']);
    rmSync(join(dir, 'stack.json'));
    expect(codes(validateStack(dir).problems)).toContain('no-manifest');
  });

  it('a name the specification does not take is refused as the stack name too', () => {
    const dir = scratchStack();
    for (const name of ['Hello', 'a--b', '-a', 'a-', 'é', 'x'.repeat(65)]) {
      put(dir, 'stack.json', manifestWith({ name }));
      expect(codes(validateStack(dir).problems), name).toContain('manifest-invalid');
    }
  });
});

describe('what the digest cannot see is refused, not read past', () => {
  it('a stack.sigstore.json that is a directory is refused, with its contents', () => {
    const dir = scratchStack();
    put(dir, 'stack.sigstore.json/x', 'hidden');
    const report = validateStack(dir);
    expect(report.ok).toBe(false);
    expect(codes(report.problems)).toContain('signature-not-a-file');
  });

  it('a name that is not UTF-8 is a problem, not an exception', () => {
    const dir = scratchStack();
    writeFileSync(
      Buffer.concat([Buffer.from(`${dir}/n`), Buffer.from([0xff]), Buffer.from('ame.txt')]),
      'x',
    );
    const report = validateStack(dir);
    expect(report.ok).toBe(false);
    expect(codes(report.problems)).toContain('path-refused');
  });

  it('a .toml that merely mentions the word is left alone', () => {
    const dir = scratchStack();
    put(dir, 'conf/a.toml', '# mcp_servers are not here\n[tool]\nx = 1\n');
    expect(validateStack(dir).problems).toEqual([]);
  });
});
