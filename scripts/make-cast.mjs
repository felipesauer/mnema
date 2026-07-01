#!/usr/bin/env node
//
// Synthesises an asciinema v2 .cast of the canonical demo (scripts/
// demo-flow.sh) from the REAL output of a real `mnema`, without a live
// screen recording. Every byte in the cast is produced by actually running
// the commands in a throwaway project — it is a faithful capture, just
// generated deterministically instead of typed by a human.
//
// Usage:
//   node scripts/make-cast.mjs               # writes docs/quickstart.cast
//   MNEMA_BIN=./mnema node scripts/make-cast.mjs
//
// The cast plays each demo line as a prompt + the command, then streams the
// command's real stdout/stderr, with small pauses so it reads at a human
// pace. Render to SVG with `agg`, or host on asciinema.org.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const mnema = process.env.MNEMA_BIN ?? path.join(repoRoot, 'mnema');
const castOut = process.env.CAST_OUT ?? path.join(repoRoot, 'docs', 'quickstart.cast');
const flowFile = path.join(repoRoot, 'scripts', 'demo-flow.sh');

// Parse demo-flow.sh into an ordered list of {comment} / {command} steps so
// the cast mirrors the exact same flow the live recorder uses. We interpret
// a tiny subset: `step "…"` becomes a banner, a `mnema …` line (possibly
// backslash-continued) becomes a command we run and stream, and `sed …`
// stands in for the hand-edit (shown as a comment, then executed).
function parseFlow(src) {
  const lines = src.split('\n');
  const steps = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stepMatch = /^step "(.+)"$/.exec(line);
    if (stepMatch) {
      steps.push({ kind: 'banner', text: stepMatch[1] });
      continue;
    }
    if (/^(mnema|sed|echo|rm) /.test(line)) {
      // Keep TWO forms of a backslash-continued command: `display` is the
      // wrapped source (each line fits the terminal width and reads like a
      // human typed it); `run` is the joined single line actually executed.
      const display = [line];
      let run = line;
      while (run.endsWith('\\')) {
        i++;
        display.push(lines[i]);
        run = `${run.slice(0, -1).trimEnd()} ${lines[i].trim()}`;
      }
      steps.push({ kind: 'command', display, run });
    }
  }
  return steps;
}

// A single throwaway project the whole demo runs in.
const demoDir = mkdtempSync(path.join(tmpdir(), 'mnema-cast-'));
const env = { ...process.env, MNEMA_ACTOR: 'you', NODE_ENV: 'production' };

/** Runs one shell command in the demo dir, returning its combined output. */
function run(cmd) {
  // Route the `mnema` COMMAND through the resolved binary — only the leading
  // token, never an occurrence inside a path like `.mnema/audit` (which a
  // global replace would corrupt). Run via bash so the sed/redirection lines
  // behave exactly as in demo-flow.sh.
  const shell = cmd.replace(/^mnema\b/, JSON.stringify(mnema));
  const r = spawnSync('bash', ['-c', shell], { cwd: demoDir, env, encoding: 'utf-8' });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

const events = [];
let t = 0;
const PROMPT = '[32m$[0m '; // green $
const emit = (text) => events.push([Number(t.toFixed(3)), 'o', text]);
const pause = (s) => {
  t += s;
};

// Type a string out with a subtle per-character delay so it looks typed.
function type(text) {
  for (const ch of text) {
    emit(ch);
    t += 0.012;
  }
  emit('\r\n');
}

try {
  const steps = parseFlow(readFileSync(flowFile, 'utf-8'));
  emit(`${PROMPT}`);
  pause(0.5);
  for (const step of steps) {
    if (step.kind === 'banner') {
      type(`[36m# ${step.text}[0m`); // cyan comment
      pause(0.6);
      emit(PROMPT);
      continue;
    }
    // Type the command as written — a wrapped (backslash-continued)
    // command types line by line, so no single line overflows the width;
    // then run the joined form and stream its real output.
    step.display.forEach((dline, idx) => {
      // Continuation lines echo without a fresh prompt, mirroring a shell.
      if (idx > 0) emit('[2m>[0m '); // dim continuation marker
      type(dline);
    });
    pause(0.3);
    const out = run(step.run);
    if (out.length > 0) emit(out.endsWith('\n') ? out.replace(/\n/g, '\r\n') : `${out}\r\n`);
    pause(0.9);
    emit(PROMPT);
  }
  pause(1.5);

  const header = {
    version: 2,
    width: 100,
    height: 30,
    timestamp: 0,
    env: { SHELL: '/bin/bash', TERM: 'xterm-256color' },
    title: 'Mnema — you drive, agents execute, you can prove what happened',
  };
  const body = events.map((e) => JSON.stringify(e)).join('\n');
  writeFileSync(castOut, `${JSON.stringify(header)}\n${body}\n`);
  process.stdout.write(`✓ wrote ${path.relative(repoRoot, castOut)} (${events.length} frames)\n`);
  process.stdout.write(
    `  render:  agg --speed 1.4 ${path.relative(repoRoot, castOut)} docs/quickstart.gif\n`,
  );
  process.stdout.write(`  or host: asciinema upload ${path.relative(repoRoot, castOut)}\n`);
} finally {
  rmSync(demoDir, { recursive: true, force: true });
}
