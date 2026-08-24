/**
 * THE PRODUCT CALLS NO MODEL, AND ONE FILE IS ALLOWED TO REACH THE NETWORK AT ALL.
 *
 * WHY THIS IS A GUARD AND NOT A HABIT. This project's second stated refusal is *a
 * fact summarized by a model entering as a recorded entry* — the record is only
 * worth what it proves, and a paragraph a model wrote about work it did not watch
 * proves nothing while looking exactly like something that does. That refusal is
 * currently held by nothing but everyone remembering it, and the verb that reads
 * other people's decision files (`decision import`) is the first thing in the
 * product a reasonable person would try to improve by calling one. So the rule gets
 * a case: it fails on the day somebody adds the call, in the diff that adds it,
 * rather than being noticed later by whoever wonders why the product needs an API
 * key.
 *
 * THE ALLOWLIST HAS EXACTLY ONE MEMBER, and it is the outside WITNESS: T3 asks a
 * calendar to attest a checkpoint digest, which is the one thing this product does
 * that cannot be done on this machine. What leaves is a digest and nothing else —
 * no id, no title, no body, no count — which is why that one exception is
 * defensible and why the allowlist is by FILE rather than by package.
 *
 * THE NAIVE SWEEP MISSES IT, and that is the reason this file greps what it greps.
 * A `grep 'fetch('` over the whole product returns NOTHING — the single real call
 * site is `const call = network.fetch ?? fetch`, a bare reference to the global
 * with no parenthesis after it, handed to a variable and called through that. So a
 * rule written around the call shape would have reported a product with no network
 * at all and been wrong about the one file that has it. The discriminant here is
 * the IDENTIFIER, free of a preceding dot, in code with its comments removed.
 *
 * COMMENTS ARE REMOVED FOR THE CALL PATTERNS AND KEPT FOR THE HOSTS. Two files
 * describe an unrelated read as "fetching" in prose, and accusing them buys
 * nothing; but a model endpoint written in a comment is exactly as much of a finding
 * as one written in code, because it means somebody was building toward it. The
 * line-comment strip deliberately does not fire on `//` preceded by a colon, so a
 * URL in a string keeps its host — the one thing the host patterns need.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The workspace root — this file is `packages/code/tests/…`. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * EVERY FILE THE WORKSPACE HOLDS, ASKED OF GIT rather than of a list. A hand-written
 * list of directories carries whoever wrote it's blind spot, and a package added
 * next month would simply not be swept.
 */
const TRACKED: readonly string[] = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: ROOT, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 },
)
  .split('\n')
  .filter((where) => where !== '');

/**
 * The product: the sources that are published and run for a user — every package's
 * `src`, plus the plugin. Tests are out because a test that injects a fake fetcher
 * is exactly how the one real network call is proved without one.
 */
const PRODUCT: readonly string[] = TRACKED.filter(
  (where) =>
    /\.(ts|mts|cts|js|mjs|cjs)$/.test(where) &&
    !/\.test\.ts$/.test(where) &&
    (/^packages\/[^/]+\/src\//.test(where) || /^plugin\//.test(where)),
);

/** Every package manifest, where a dependency on a model SDK would have to appear. */
const MANIFESTS: readonly string[] = TRACKED.filter(
  (where) => /(?:^|\/)package\.json$/.test(where) && !where.includes('node_modules'),
);

/**
 * The ONE file allowed to reach the network: the outside witness. See the header.
 *
 * It is a literal path and not a pattern, so moving the file is a decision somebody
 * makes here rather than a rule that quietly follows it.
 */
const MAY_REACH_THE_NETWORK: readonly string[] = ['packages/chain/src/chain/witness-request.ts'];

/** Ways to reach the network from JavaScript. */
const REACHES_THE_NETWORK: readonly (readonly [string, RegExp])[] = [
  ['the fetch global', /(?<![.\w$])fetch\b/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['a WebSocket', /\bnew\s+WebSocket\b/],
  ['an EventSource', /\bnew\s+EventSource\b/],
  ['sendBeacon', /\bsendBeacon\s*\(/],
  [
    'a network module',
    /['"](?:node:)?(?:https?|net|tls|dgram|dns)['"]|['"](?:undici|axios|node-fetch|got|superagent|ws)['"]/,
  ],
];

/** Endpoints of the model providers, wherever they are written. */
const A_MODEL_ENDPOINT: readonly (readonly [string, RegExp])[] = [
  ['Anthropic', /api\.anthropic\.com/],
  ['OpenAI', /api\.openai\.com/],
  ['Google', /generativelanguage\.googleapis\.com/],
  ['Cohere', /api\.cohere\.(?:ai|com)/],
  ['Mistral', /api\.mistral\.ai/],
  ['Groq', /api\.groq\.com/],
  ['OpenRouter', /openrouter\.ai/],
  ['Bedrock', /bedrock-runtime/],
  ['a local model server', /:11434\b/],
];

/** Package names that ARE a model client. */
const A_MODEL_SDK: readonly RegExp[] = [
  /^@anthropic-ai\//,
  /^openai$/,
  /^@google\/(?:genai|generative-ai)$/,
  /^@mistralai\//,
  /^cohere-ai$/,
  /^ollama$/,
  /^(?:@langchain\/|langchain$)/,
  /^llamaindex$/,
  /^ai$/,
];

/**
 * The text with its comments taken out.
 *
 * The line strip skips a `//` that follows a colon, so `'https://host'` keeps its
 * host: the host patterns read the ORIGINAL text, but a naive strip here would also
 * be the shape somebody copies for the next sweep.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<!:)\/\/[^\n]*/g, ' ');
}

/** The file's text, read from the workspace. */
function read(where: string): string {
  return readFileSync(join(ROOT, where), 'utf-8');
}

describe('the product calls no model', () => {
  it('sweeps a product that is actually there', () => {
    // A guard over an ABSENCE goes vacuous the day its sweep comes back empty, and
    // nothing else in the suite would say so. This is the non-vacuity half: the
    // sweep found the product, and it found the file the allowlist names.
    expect(PRODUCT.length).toBeGreaterThan(150);
    expect(PRODUCT).toContain('packages/code/src/commands/decision-import.ts');
    expect(PRODUCT).toContain('packages/core/src/adr/read.ts');
    expect(PRODUCT).toContain(MAY_REACH_THE_NETWORK[0] as string);
    expect(MANIFESTS.length).toBeGreaterThan(3);
  });

  it('has a ruler that fires — every pattern, against a control', () => {
    // An instrument that cannot say it is broken is worse than none. Each pattern is
    // held against text it MUST match, so a regex edited into inertness is red here
    // rather than silently reporting a clean product.
    const controls: Readonly<Record<string, string>> = {
      'the fetch global': 'const call = network.fetch ?? fetch;',
      XMLHttpRequest: 'const x = new XMLHttpRequest();',
      'a WebSocket': 'const s = new WebSocket(url);',
      'an EventSource': 'const s = new EventSource(url);',
      sendBeacon: 'navigator.sendBeacon(url, body);',
      'a network module': "import { request } from 'node:https';",
    };
    for (const [name, pattern] of REACHES_THE_NETWORK) {
      expect(pattern.test(controls[name] as string), `${name} must match its control`).toBe(true);
    }
    for (const [name, pattern] of A_MODEL_ENDPOINT) {
      const control = `const url = 'https://${
        {
          Anthropic: 'api.anthropic.com/v1/messages',
          OpenAI: 'api.openai.com/v1/chat/completions',
          Google: 'generativelanguage.googleapis.com/v1',
          Cohere: 'api.cohere.ai/v1/chat',
          Mistral: 'api.mistral.ai/v1',
          Groq: 'api.groq.com/openai/v1',
          OpenRouter: 'openrouter.ai/api/v1',
          Bedrock: 'bedrock-runtime.us-east-1.amazonaws.com',
          'a local model server': 'localhost:11434/api/generate',
        }[name]
      }';`;
      expect(pattern.test(control), `${name} must match its control`).toBe(true);
    }
    // And the comment strip does what the header says: prose goes, a URL stays.
    expect(code('// fetch the rest of the history')).not.toMatch(/fetch/);
    expect(code("const u = 'https://api.anthropic.com';")).toMatch(/api\.anthropic\.com/);
  });

  it('reaches the network from ONE file, and that file is the witness', () => {
    const reaching: string[] = [];
    for (const where of PRODUCT) {
      const source = code(read(where));
      for (const [name, pattern] of REACHES_THE_NETWORK) {
        if (pattern.test(source)) reaching.push(`${where} (${name})`);
      }
    }
    expect(reaching.map((line) => line.split(' (')[0])).toEqual(
      reaching.map(() => MAY_REACH_THE_NETWORK[0]),
    );
    // And the exception is still USED, so the allowlist is not a leftover entry
    // protecting a file that stopped needing it.
    expect(reaching.length).toBeGreaterThan(0);
  });

  it('names no model endpoint anywhere in the product', () => {
    const named: string[] = [];
    for (const where of PRODUCT) {
      const source = read(where);
      for (const [name, pattern] of A_MODEL_ENDPOINT) {
        if (pattern.test(source)) named.push(`${where} (${name})`);
      }
    }
    expect(named).toEqual([]);
  });

  it('depends on no model SDK, in any package', () => {
    const depended: string[] = [];
    for (const where of MANIFESTS) {
      const manifest = JSON.parse(read(where)) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      const names = [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ];
      for (const name of names) {
        if (A_MODEL_SDK.some((sdk) => sdk.test(name))) depended.push(`${where}: ${name}`);
      }
    }
    expect(depended).toEqual([]);
  });

  it('reads other people’s decisions with no model, and the reader proves it', () => {
    // The specific case the guard was written for: the verb that reads decision
    // documents is deterministic — headings and labels — and neither module it is
    // built from reaches anything.
    for (const where of ['packages/core/src/adr/read.ts', 'packages/core/src/adr/scan.ts']) {
      const source = code(read(where));
      for (const [, pattern] of REACHES_THE_NETWORK) expect(pattern.test(source)).toBe(false);
    }
  });
});
