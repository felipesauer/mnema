/**
 * The notes a session opens with, as text — what each line says and what it never says.
 *
 * The hits here are what the index serves (`searchRecords`), built by hand with values the
 * product produces: a uuid v7 id, one of the three trees, an ISO instant, and the index's
 * own `derived` flag (a memory's line is an excerpt; an observation's is its topic).
 */

import type { PertinentSearch, RecordHit } from '@mnema/copilot';
import { detectSecrets } from '@mnema/core';
import { describe, expect, it } from 'vitest';
import { recordFraming, tellsWhatToDo } from '../record-framing.js';
import type { SessionTouch } from '../what-the-session-touches.js';
import { recallDocument } from './recall.js';

/** A memory as the index serves it: the start of its content, marked as an excerpt. */
function memory(n: number, title: string): RecordHit {
  return {
    id: `01a0ca93-8ba2-7000-8351-${String(n).padStart(12, '0')}`,
    kind: 'memory',
    scope: 'private',
    at: `2026-09-22T10:00:${String(n).padStart(2, '0')}.000Z`,
    title,
    derived: true,
  };
}

/** An observation as the index serves it: its topic, a name somebody chose. */
function observation(n: number, topic: string): RecordHit {
  return {
    id: `01a0ca93-9ab1-7000-8a6c-${String(n).padStart(12, '0')}`,
    kind: 'observation',
    scope: 'public',
    at: `2026-09-22T11:00:${String(n).padStart(2, '0')}.000Z`,
    title: topic,
    derived: false,
  };
}

const none: PertinentSearch = { hits: [], total: 0, pertinent: 0 };
const all = (hits: RecordHit[], pertinent = 0): PertinentSearch => ({
  hits,
  total: hits.length,
  pertinent,
});

/** A session that touched nothing readable — the order is the newest. */
const untouched: SessionTouch = { words: [], changed: 0, tasks: 0, branch: false, commits: 0 };

/** A session with a changed file, the branch and three commits read. */
const touched: SessionTouch = {
  words: ['invoice', 'rounding'],
  changed: 1,
  tasks: 0,
  branch: true,
  commits: 3,
};

describe('recallDocument — the notes a session opens with', () => {
  it('hands a session nothing when nothing is noted', () => {
    // NO LINES AT ALL, not a heading over an empty list: the plugin's handler reads an
    // empty text as silence, so a session in a project with no notes is handed nothing.
    expect(recallDocument({ touched: untouched, memories: none, observations: none })).toEqual([]);
  });

  it('says whose text the notes are, in the channel’s own declaration', () => {
    const lines = recallDocument({ touched: untouched, memories: all([memory(1, 'a note')]), observations: none });
    for (const line of recordFraming('recall-document')) expect(lines).toContain(line);
  });

  it('gives each note ONE line, whatever its text holds', () => {
    // A note is text somebody typed, and a newline in it would end its own bullet and start
    // a note nobody wrote — so every field is collapsed where the line is built. The break
    // is planted in the TOPIC because that is where the index can hand one over: it serves
    // an observation's topic as it was stored, while a memory's excerpt is collapsed on the
    // way out of the index already, so a memory with a newline would be a value it cannot
    // produce.
    const lines = recallDocument({
      touched: untouched,
      memories: all([memory(1, 'a first note'), memory(2, 'a second note')]),
      observations: all([observation(1, 'a topic\nwith a break')]),
    });
    const bullets = lines.filter((line) => line.startsWith('- '));
    expect(bullets).toHaveLength(3);
    expect(lines.every((line) => !line.includes('\n'))).toBe(true);
  });

  it('bolds an observation’s topic and never a memory’s excerpt', () => {
    const lines = recallDocument({
      touched: untouched,
      memories: all([memory(1, 'the build reads a stale dist')]),
      observations: all([observation(1, 'month-end volume')]),
    });
    expect(lines).toContain(
      '- the build reads a stale dist · `01a0ca93-8ba2-7000-8351-000000000001`',
    );
    expect(lines).toContain('- **month-end volume** · `01a0ca93-9ab1-7000-8a6c-000000000001`');
  });

  it('withholds the words of a note that holds a credential, and keeps that it exists', () => {
    // A PUSHED channel: nobody asked, and the text leaves the machine with every session. A
    // record written before the content door — or by anything else holding a key — can
    // still hold a credential, and the line stands in for it.
    const token = 'ghp_0123456789abcdefghijklmnopqrstuvwxyzA';
    // Non-vacuity: the product's own detector does recognize it, so the case below is
    // about THIS text and not about a value nothing would have caught.
    expect(detectSecrets(`the token: ${token}`).length).toBeGreaterThan(0);
    const lines = recallDocument({
      touched: untouched,
      memories: all([memory(1, `the token: ${token}`), memory(2, 'a clean note')]),
      observations: all([observation(1, `deploy with ${token}`)]),
    });
    const text = lines.join('\n');
    expect(text).not.toContain(token);
    expect(text).not.toContain('ghp_');
    expect(text).toContain('`01a0ca93-8ba2-7000-8351-000000000001`');
    expect(text).toContain('`01a0ca93-9ab1-7000-8a6c-000000000001`');
    expect(lines.filter((line) => line.includes('holds a credential'))).toHaveLength(2);
    // And only those two: a clean note keeps its words.
    expect(text).toContain('- a clean note · ');
  });

  it('says how many there are in all when the index served fewer', () => {
    const lines = recallDocument({
      touched: untouched,
      memories: { hits: [memory(1, 'one'), memory(2, 'two')], total: 25, pertinent: 0 },
      observations: none,
    });
    expect(lines).toContain('## Memories (2)');
    expect(lines).toContain('25 are recorded here, and these are the 2 newest; `search` with');
    expect(lines).toContain('`kind` `memory` serves the rest.');
    // And a list that was NOT cut says nothing of the kind.
    const whole = recallDocument({ touched: untouched, memories: all([memory(1, 'one')]), observations: none });
    expect(whole.join('\n')).not.toContain('are recorded here, and these are');
  });

  it('says in words which kind holds nothing, when the other holds something', () => {
    const lines = recallDocument({ touched: untouched, memories: none, observations: all([observation(1, 'x')]) });
    expect(lines).toContain('## Memories (0)');
    expect(lines).toContain('No memory is recorded here.');
    expect(lines).toContain('## Observations (1)');
  });

  it('says in one line that the order is the newest, when nothing was touched', () => {
    const lines = recallDocument({
      touched: untouched,
      memories: all([memory(1, 'one')]),
      observations: none,
    });
    expect(lines.filter((line) => line.startsWith('Newest first: '))).toHaveLength(1);
    expect(lines.some((line) => line.startsWith('Nearest first: '))).toBe(false);
    // And nothing under a heading about what is near, since nothing was.
    expect(lines.join('\n')).not.toContain('share a word');
  });

  it('says in one line that the near ones come first, and where the words came from', () => {
    const lines = recallDocument({
      touched,
      memories: all([memory(1, 'one'), memory(2, 'two'), memory(3, 'three')], 2),
      observations: all([observation(1, 'x')], 0),
    });
    expect(lines).toContain(
      'Nearest first: the ones that share a word with what this session touches — 1 file changed in the working tree, the name of the branch and the files of the last 3 commits — closest first, then the newest.',
    );
    expect(lines.some((line) => line.startsWith('Newest first: '))).toBe(false);
    // Under each heading, where the near part ends.
    expect(lines).toContain('The first 2 share a word with what this session touches.');
    expect(lines).toContain('None of these shares a word with what this session touches.');
    // The words themselves never ride the text: a path and a branch are somebody's text.
    expect(lines.join('\n')).not.toContain('invoice');
  });

  it('says every line is near when every line is, and a cut is not called the newest', () => {
    const lines = recallDocument({
      touched,
      memories: { hits: [memory(1, 'one'), memory(2, 'two')], total: 25, pertinent: 2 },
      observations: all([observation(1, 'x')], 1),
    });
    expect(lines).toContain('Every one of these shares a word with what this session touches.');
    expect(
      recallDocument({
        touched,
        memories: all([memory(1, 'one'), memory(2, 'two')], 1),
        observations: none,
      }),
    ).toContain('The first of these shares a word with what this session touches.');
    expect(lines).toContain('25 are recorded here, and these are 2 of them; `search` with');
    expect(lines.join('\n')).not.toContain('the 2 newest');
  });

  it('states what is, and tells no reader what to do', () => {
    // Text a hook adds to a session is read as context when it is written as fact. The
    // doors are named as what they do, and the tripwire every framing is held to finds no
    // order anywhere in the text.
    for (const session of [untouched, touched]) {
      const text = recallDocument({
        touched: session,
        memories: all([memory(1, 'a note')], session === touched ? 1 : 0),
        observations: all([observation(1, 'a topic')]),
      }).join('\n');
      expect(text).toContain('`capture_memory`');
      expect(text).toContain('`record_observation`');
      expect(tellsWhatToDo(text)).toBeUndefined();
    }
  });
});
