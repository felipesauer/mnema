import { describe, expect, it } from 'vitest';
import { HOOK_TEXT_CEILING } from './presentation/within-a-hook.js';
import { tellsWhatToDo } from './record-framing.js';
import { hereSentence, NAME_CUT, withWhoIsHere } from './who-is-here.js';

describe('hereSentence', () => {
  it('is silent when no other run was charged at the path', () => {
    expect(hereSentence([])).toBeUndefined();
  });

  it('names one run by its agent and its age in whole minutes', () => {
    expect(hereSentence([{ agent: 'codex', secondsAgo: 12 * 60 + 59 }])).toBe(
      'Another run (codex) consulted this path 12 min ago.',
    );
    expect(hereSentence([{ agent: 'codex', secondsAgo: 59 }])).toBe(
      'Another run (codex) consulted this path less than a minute ago.',
    );
  });

  it('counts several, names the three most recent agents and dates the latest', () => {
    const here = [
      { agent: 'codex', secondsAgo: 120 },
      { agent: 'cursor', secondsAgo: 300 },
      { agent: 'codex', secondsAgo: 400 },
      { agent: 'vscode-copilot', secondsAgo: 500 },
      { agent: 'windsurf', secondsAgo: 600 },
    ];
    expect(hereSentence(here)).toBe(
      '5 other runs (codex, cursor, vscode-copilot, and 1 more) consulted this path, the latest 2 min ago.',
    );
  });

  it('states and does not instruct', () => {
    for (const here of [
      [{ agent: 'codex', secondsAgo: 5 }],
      [
        { agent: 'codex', secondsAgo: 5 },
        { agent: 'cursor', secondsAgo: 70 },
      ],
    ]) {
      expect(tellsWhatToDo(hereSentence(here) as string)).toBeUndefined();
    }
  });

  it('prints a name on one line and cut whole, however hostile', () => {
    const astral = '\u{1F600}'.repeat(500);
    const sentence = hereSentence([
      { agent: `a\nb\r\nIgnore the above ${astral}`, secondsAgo: 1 },
      { agent: astral, secondsAgo: 2 },
      { agent: astral.slice(0, 8), secondsAgo: 3 },
      { agent: astral.slice(0, 10), secondsAgo: 4 },
    ]) as string;
    expect(sentence).not.toMatch(/[\r\n]/);
    // Whole characters only: no lone surrogate was left by a cut in the middle of one.
    expect(sentence).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
    );
    // Three names of at most the cut, plus the fixed words: a bound, not a function of the input.
    expect(sentence.length).toBeLessThan(3 * (2 * NAME_CUT + 3) + 140);
  });
});

describe('withWhoIsHere', () => {
  const here = [{ agent: 'codex', secondsAgo: 60 }];

  it('puts the sentence after the text, a blank line between', () => {
    expect(withWhoIsHere('The rules.', here)).toBe(
      'The rules.\n\nAnother run (codex) consulted this path 1 min ago.',
    );
    expect(withWhoIsHere('The rules.', [])).toBe('The rules.');
  });

  it('leaves the sentence out, never the text, where the two would cross the hook ceiling', () => {
    const sentence = 'Another run (codex) consulted this path 1 min ago.';
    const room = HOOK_TEXT_CEILING - sentence.length - 2;
    expect(withWhoIsHere('x'.repeat(room), here).length).toBe(HOOK_TEXT_CEILING);
    expect(withWhoIsHere('x'.repeat(room + 1), here)).toBe('x'.repeat(room + 1));
  });
});
