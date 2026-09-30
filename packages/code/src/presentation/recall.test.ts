/**
 * The notes a session opens with, as text — what each line says and what it never says.
 *
 * The hits here are what the index serves (`searchRecords`), built by hand with values the
 * product produces: a uuid v7 id, one of the three trees, an ISO instant, and the index's
 * own `derived` flag (a memory's line is an excerpt; an observation's is its topic).
 */

import type { PertinentSearch, RecordHit } from '@mnema/copilot';
import { detectSecrets, excerptOf, SEARCH_DEFAULT_LIMIT } from '@mnema/core';
import { describe, expect, it } from 'vitest';
import { recordFraming, tellsWhatToDo } from '../record-framing.js';
import type { SessionTouch } from '../what-the-session-touches.js';
import { recallDocument, recallWithin } from './recall.js';
import { HOOK_TEXT_CEILING, printedLength } from './within-a-hook.js';

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
    const lines = recallDocument({
      touched: untouched,
      memories: all([memory(1, 'a note')]),
      observations: none,
    });
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
    const whole = recallDocument({
      touched: untouched,
      memories: all([memory(1, 'one')]),
      observations: none,
    });
    expect(whole.join('\n')).not.toContain('are recorded here, and these are');
  });

  it('says in words which kind holds nothing, when the other holds something', () => {
    const lines = recallDocument({
      touched: untouched,
      memories: none,
      observations: all([observation(1, 'x')]),
    });
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

describe('an observation’s topic is cut by the index’s own rule', () => {
  /** A topic longer than any line the notes print — a name somebody typed has no length. */
  const topic = `month-end volume ${'and the batch that follows it '.repeat(40).trimEnd()}`;

  it('prints the start of a long topic, as a memory prints the start of its text', () => {
    const lines = recallDocument({
      touched: untouched,
      memories: none,
      observations: all([observation(1, topic)]),
    });
    expect(topic.length).toBeGreaterThan(excerptOf(topic).length);
    expect(lines).toContain(`- **${excerptOf(topic)}** · \`01a0ca93-9ab1-7000-8a6c-000000000001\``);
    expect(lines.join('\n')).not.toContain(topic);
  });

  it('prints a short topic exactly as it was named', () => {
    const lines = recallDocument({
      touched: untouched,
      memories: none,
      observations: all([observation(1, 'a topic')]),
    });
    expect(lines).toContain('- **a topic** · `01a0ca93-9ab1-7000-8a6c-000000000001`');
  });

  it('asks the WHOLE topic for a credential, not the part it prints', () => {
    // A credential past where the line is cut: judging the excerpt would print the start of a
    // line that, whole, the door would have recognized.
    const token = 'ghp_0123456789abcdefghijklmnopqrstuvwxyzA';
    const late = `${'a long preamble about the deploy '.repeat(6)}${token}`;
    expect(excerptOf(late)).not.toContain(token);
    const text = recallDocument({
      touched: untouched,
      memories: none,
      observations: all([observation(1, late)]),
    });
    expect(text.join('\n')).toContain('holds a credential');
    expect(text.join('\n')).not.toContain('a long preamble');
  });
});

describe('the hook’s copy of the notes stays inside what a hook carries', () => {
  /** The longest line each kind can print: an excerpt at its full length. */
  const longest = excerptOf('every word of a long note is here '.repeat(20));
  const full = (make: (n: number, text: string) => RecordHit, pertinent = 0): PertinentSearch => ({
    hits: Array.from({ length: SEARCH_DEFAULT_LIMIT }, (_, at) => make(at + 1, longest)),
    total: 9_999,
    pertinent,
  });

  it('fits whole at the most the index serves, at the longest line each kind prints', () => {
    // The bound the topic's excerpt bought: before it, twenty long topics alone crossed it.
    const notes = {
      touched: untouched,
      memories: full(memory),
      observations: full(observation),
    };
    expect(printedLength(recallDocument(notes))).toBeLessThanOrEqual(HOOK_TEXT_CEILING);
    expect(recallWithin(notes, HOOK_TEXT_CEILING)).toEqual(recallDocument(notes));
  });

  it('stops at a whole note in a smaller room, newest first, and says how many there are', () => {
    const notes = {
      touched: untouched,
      memories: full(memory),
      observations: full(observation),
    };
    const room = 4_000;
    const cut = recallWithin(notes, room);
    expect(printedLength(cut)).toBeLessThanOrEqual(room);
    const lines = cut.filter((line) => line.startsWith('- '));
    // A prefix of the whole text's notes, in its order: every memory before any observation.
    expect(lines).toEqual(
      recallDocument(notes)
        .filter((line) => line.startsWith('- '))
        .slice(0, lines.length),
    );
    expect(cut).toContain(
      `9999 are recorded here, and these are the ${lines.length} newest; \`search\` with`,
    );
  });

  it('says a section cut to nothing holds notes — never that none is recorded', () => {
    const notes = {
      touched: untouched,
      memories: full(memory),
      observations: full(observation),
    };
    const cut = recallWithin(notes, 4_000);
    expect(cut).toContain('## Observations (0)');
    expect(cut).toContain('9999 are recorded here, and none of them is below; `search` with');
    expect(cut).toContain('`kind` `observation` serves the rest.');
    expect(cut).not.toContain('No observation is recorded here.');
  });

  it('counts the near ones among the lines it printed, when a hook cut the nearest part short', () => {
    // The order is nearest first when the session touched something, and the hook's copy drops
    // from the end — so a cut that falls inside the near part leaves every printed line near,
    // and the count under the heading says so of what is there, never of what was cut.
    const notes = {
      touched,
      memories: full(memory, 18),
      observations: full(observation, 3),
    };
    const cut = recallWithin(notes, 4_000);
    const printed = cut.filter((line) => line.startsWith('- '));
    expect(printed.length).toBeGreaterThan(0);
    expect(printed.length).toBeLessThan(18);
    expect(cut).toContain(
      `9999 are recorded here, and these are ${printed.length} of them; \`search\` with`,
    );
    expect(cut).toContain('Every one of these shares a word with what this session touches.');
    expect(cut.join('\n')).not.toContain('The first 18 share a word');
    expect(cut).toContain('9999 are recorded here, and none of them is below; `search` with');
  });
});
