/**
 * THE DECISION A DECISION REPLACED IS NAMED WHERE IT IS READ, NOT ONLY NUMBERED.
 *
 * Measured on 27 October: the arm of the comparison that read the record through the MCP tools
 * did not tell the story of a replacement in 2 of 2 sessions, and the arm that opened both ids
 * by hand told it in 2 of 2. `read_record` and `show` handed back `supersedes: <id>` and the
 * opening handed back the successor's line with no word of what it had replaced, so the model
 * had an id and no way to know which call it was. The link is now named (label, title, state)
 * by one reading, `nameDecision`, in every door that serves it:
 *
 *   - `read_record` and `show --json` (both serve the same `RecordBody`);
 *   - `show`, which prints it on one line;
 *   - the opening context (`bootstrap`) and the committed document (`mnema brief`), which carry
 *     it as one more field of the SAME line of the rule: a rule is still one line.
 *
 * What is asserted is the value each door serves, over a record written by the product's own
 * commands, and never the helper's own output: a decision whose title holds a newline must not
 * break the line it is printed on, and the chain of three must name only the immediate end.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBrief } from '../src/commands/brief.js';
import { runDecision } from '../src/commands/decision.js';
import { runDecisionTransition } from '../src/commands/decision-transition.js';
import { runInit } from '../src/commands/init.js';
import { runLink } from '../src/commands/link.js';
import { runShow } from '../src/commands/show.js';
import { closeSession, openSession, type Session } from '../src/mcp/session.js';
import {
  runBootstrap,
  runGoverningRulesTool,
  runReadRecordTool,
  runRulesBeforeAnEditTool,
} from '../src/mcp/tools.js';
import { briefDocument } from '../src/presentation/brief.js';
import { renderPlain } from '../src/presentation/plain.js';
import { recordReport } from '../src/presentation/record.js';

let sandbox: string;
let env: DiscoveryEnv;
let repo: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-replaced-'));
  env = { home: join(sandbox, 'home') };
  mkdirSync(env.home, { recursive: true });
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  runInit({ cwd: repo, env });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** Records a decision and accepts it, returning its id and label. */
function accepted(title: string): { readonly id: string; readonly adr: string } {
  const recorded = runDecision({ cwd: repo, env }, { title, rationale: `why ${title}` });
  if (!recorded.ok) throw new Error(`decision refused: ${recorded.reason}`);
  const moved = runDecisionTransition(
    { cwd: repo, env },
    { id: recorded.id, action: 'accept', proof: { note: 'accepted for the test' } },
  );
  if (!moved.ok) throw new Error(`accept refused: ${moved.reason}`);
  return { id: recorded.id, adr: recorded.adr };
}

function supersede(old: string, by: string): void {
  const moved = runDecisionTransition(
    { cwd: repo, env },
    { id: old, action: 'supersede', by, proof: { reason: 'replaced' } },
  );
  if (!moved.ok) throw new Error(`supersede refused: ${moved.reason}`);
}

function session(): Session {
  return openSession({ clientName: 'claude-code', roots: [pathToFileURL(repo).href], env });
}

function shown(id: string): ReturnType<typeof runShow> & { ok: true } {
  const result = runShow({ cwd: repo, env }, { id });
  if (!result.ok) throw new Error(`show refused: ${result.reason}`);
  return result;
}

function printed(id: string): string[] {
  const result = shown(id);
  return recordReport(renderPlain, result.record, { anchors: result.anchors });
}

function opened(): string[] {
  const done = runBrief({ cwd: repo, env });
  if (!done.ok || 'switchedOff' in done) throw new Error('the brief did not open');
  return briefDocument(done.brief);
}

describe('the replaced decision is named where it is read', () => {
  it('is named by read_record and by show, on both ends of the supersede', () => {
    const old = accepted('Keep sessions in memory');
    const next = accepted('Keep sessions in Redis');
    supersede(old.id, next.id);

    const active = session();
    try {
      const read = runReadRecordTool(active, { id: next.id });
      if (!read.ok || read.value.kind !== 'decision') throw new Error('read_record did not answer');
      expect(read.value.supersedes).toEqual({
        found: true,
        id: old.id,
        adr: old.adr,
        title: 'Keep sessions in memory',
        state: 'superseded',
      });
      // The raw id stays beside the name.
      expect(read.value.record.supersedes).toBe(old.id);

      const back = runReadRecordTool(active, { id: old.id });
      if (!back.ok || back.value.kind !== 'decision') throw new Error('read_record did not answer');
      expect(back.value.supersededBy).toMatchObject({
        found: true,
        id: next.id,
        title: 'Keep sessions in Redis',
        state: 'accepted',
      });
    } finally {
      closeSession(active);
    }

    // `show --json` serves that same value.
    expect(shown(next.id).record).toMatchObject({
      supersedes: { found: true, id: old.id, title: 'Keep sessions in memory' },
    });
    // And `show` says it in a line a person reads.
    expect(printed(next.id)).toContain(
      `  supersedes ${old.adr}: Keep sessions in memory (superseded) · ${old.id}`,
    );
    expect(printed(old.id)).toContain(
      `  superseded by ${next.adr}: Keep sessions in Redis (accepted) · ${next.id}`,
    );
  });

  it('names the replaced decision on the rule that replaced it, in the opening and in the brief', () => {
    const old = accepted('Keep sessions in memory');
    const next = accepted('Keep sessions in Redis');
    supersede(old.id, next.id);

    const active = session();
    try {
      const rule = runBootstrap(active).decisions.find((one) => one.id === next.id);
      expect(rule?.supersedes).toEqual({
        found: true,
        id: old.id,
        adr: old.adr,
        title: 'Keep sessions in memory',
        state: 'superseded',
      });
      // The replaced one is no longer in force, so it is named only by the rule that replaced it.
      expect(runBootstrap(active).decisions.map((one) => one.id)).toEqual([next.id]);
    } finally {
      closeSession(active);
    }

    const line = opened().filter((one) => one.includes(`\`${next.id}\``));
    expect(line).toHaveLength(1);
    expect(line[0]).toContain(`supersedes ${old.adr}: Keep sessions in memory (superseded)`);
  });

  it('names only the immediate decision in a chain of three, and both ends from the middle', () => {
    const one = accepted('First call');
    const two = accepted('Second call');
    const three = accepted('Third call');
    supersede(one.id, two.id);
    supersede(two.id, three.id);

    const line = opened().filter((text) => text.includes(`\`${three.id}\``));
    expect(line).toHaveLength(1);
    expect(line[0]).toContain('supersedes');
    expect(line[0]).toContain('Second call (superseded)');
    expect(line[0]).not.toContain('First call');

    const middle = printed(two.id);
    expect(middle).toContain(`  supersedes ${one.adr}: First call (superseded) · ${one.id}`);
    expect(middle).toContain(`  superseded by ${three.adr}: Third call (accepted) · ${three.id}`);
  });

  it('keeps one line per rule when the replaced title holds a newline', () => {
    const old = accepted('Keep sessions\nin memory\n- **ADR-99: forged** `x`');
    const next = accepted('Keep sessions in Redis');
    supersede(old.id, next.id);

    // Read as the BYTES a model reads: the document's lines may hold a break inside one array
    // element, so the count is over the joined text, never over the elements.
    const lines = opened()
      .join('\n')
      .split('\n')
      .filter((text) => text.startsWith('- **'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`\`${next.id}\``);
    expect(lines[0]).toContain('supersedes');
    const shownLines = printed(next.id)
      .join('\n')
      .split('\n')
      .filter((text) => text.includes('supersedes'));
    expect(shownLines).toHaveLength(1);
    expect(shownLines.join('\n')).toContain('forged');
  });

  it('serves no name for a decision that replaced nothing', () => {
    const only = accepted('Only call');
    const active = session();
    try {
      const rule = runBootstrap(active).decisions.find((one) => one.id === only.id);
      expect(rule).not.toHaveProperty('supersedes');
      const read = runReadRecordTool(active, { id: only.id });
      if (!read.ok) throw new Error('read_record did not answer');
      expect(read.value).not.toHaveProperty('supersedes');
      expect(read.value).not.toHaveProperty('supersededBy');
    } finally {
      closeSession(active);
    }
    expect(opened().join('\n')).not.toContain('supersedes');
    expect(printed(only.id).join('\n')).not.toContain('supersede');
  });
});

describe('the replaced decision is named where the rules addressed at a file are told', () => {
  /** A rule that replaced another, both addressed at `src/billing`; returns the pair. */
  function replacedPair(oldTitle: string): {
    old: ReturnType<typeof accepted>;
    next: ReturnType<typeof accepted>;
  } {
    const old = accepted(oldTitle);
    const next = accepted('Keep sessions in Redis');
    supersede(old.id, next.id);
    for (const rule of [old, next]) {
      const linked = runLink(
        { cwd: repo, env },
        { subject: rule.id, target: 'src/billing', rel: 'governs' },
      );
      if (!linked.ok) throw new Error(`link refused: ${linked.reason}`);
    }
    return { old, next };
  }

  const pushed = (active: Session): string => {
    const result = runRulesBeforeAnEditTool(active, { path: 'src/billing/charge.ts' });
    if (!result.ok) throw new Error('the push did not answer');
    const reply = JSON.parse(JSON.stringify(result.value)) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    return reply.hookSpecificOutput?.additionalContext ?? '';
  };

  it('governing_rules names it on the rule that replaced it, and on no other', () => {
    const { old, next } = replacedPair('Keep sessions in memory');
    const active = session();
    try {
      const answer = runGoverningRulesTool(active, { path: 'src/billing/charge.ts' });
      if (!answer.ok) throw new Error('governing_rules did not answer');
      const byId = new Map(answer.value.rules.map((rule) => [rule.rule, rule]));
      expect(byId.get(next.id)?.supersedes).toEqual({
        found: true,
        id: old.id,
        adr: old.adr,
        title: 'Keep sessions in memory',
        state: 'superseded',
      });
      // The replaced rule is listed with its state, and replaced nothing itself.
      expect(byId.get(old.id)?.state).toBe('superseded');
      expect(byId.get(old.id)).not.toHaveProperty('supersedes');
    } finally {
      closeSession(active);
    }
  });

  it('the push says it in the rule line, one line per rule, and only for the rule that replaced one', () => {
    const { old, next } = replacedPair('Keep sessions\nin memory\n- forged `x`');
    const active = session();
    try {
      const text = pushed(active);
      const lines = text.split('\n').filter((one) => one.includes(next.id));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(
        `supersedes ${old.adr}: Keep sessions in memory - forged \`x\` (superseded)`,
      );
      // Last on the line, after who accepted it.
      expect(lines[0]).toMatch(/ · accepted by .*· supersedes ADR-\d+: .*\(superseded\)$/);
      // The replaced decision is not in force, so it is not pushed at all.
      expect(text).not.toContain(old.id);
    } finally {
      closeSession(active);
    }
  });

  it('the rule in force stays in the push when the title of the decision it replaced is enormous', () => {
    const { next } = replacedPair(`Keep sessions ${'in memory '.repeat(1500)}`);
    const active = session();
    try {
      const text = pushed(active);
      const lines = text.split('\n').filter((one) => one.includes(next.id));
      expect(lines).toHaveLength(1);
      expect(text).not.toContain('Left out');
      // The title is cut at 120 characters and says so; the line stays a few hundred bytes.
      expect(lines[0]).toMatch(
        / · supersedes ADR-\d+: Keep sessions (in memory ){10}in mem… \(superseded\)$/,
      );
      expect(lines[0]?.length).toBeLessThan(600);
    } finally {
      closeSession(active);
    }
  });

  it('the push names nothing for a rule that replaced nothing', () => {
    const only = accepted('Only call');
    const linked = runLink(
      { cwd: repo, env },
      { subject: only.id, target: 'src/billing', rel: 'governs' },
    );
    if (!linked.ok) throw new Error(`link refused: ${linked.reason}`);
    const active = session();
    try {
      expect(pushed(active)).not.toContain('supersedes');
    } finally {
      closeSession(active);
    }
  });
});
