import matter from 'gray-matter';
import { dump as yamlDump, load as yamlLoad } from 'js-yaml';

/**
 * Single, hardened entry point for every front-matter parse/stringify in
 * Mnema. Every service reads markdown that may originate from an agent over
 * MCP (`skill_record`, `memory_record`), so the parser must never execute
 * code embedded in a file.
 *
 * Three guarantees over the bare `gray-matter` defaults:
 *
 * 1. The YAML engine is js-yaml 5.x (`load`/`dump`) instead of the 3.x that
 *    `gray-matter` bundles via `safeLoad`/`safeDump`. js-yaml 3.x is affected
 *    by CVE-2026-53550 (quadratic-complexity DoS on repeated merge-key
 *    aliases) and is unmaintained; 4.x+ fixes it and is safe by default.
 *    `gray-matter` still does what it is good at — splitting the `---`
 *    delimited block from the body — only the YAML parse/serialise is ours.
 * 2. The `javascript`/`js` engines are replaced by a function that throws.
 *    `gray-matter` would otherwise `eval()` a `---js` front-matter block,
 *    and the language is taken from the file itself — so a hostile file can
 *    opt into the JS engine regardless of what the caller requests. Removing
 *    the engine is the only way to close that path for good.
 * 3. `language` is pinned to `yaml`, the format Mnema actually writes.
 *
 * `gray-matter` merges these engines over its own defaults
 * (`Object.assign({}, engines, opts.engines)`), so the JSON engine still
 * works and our overrides win for `yaml`/`javascript`/`js`.
 */

function rejectJsEngine(): never {
  throw new Error('JavaScript front-matter engine is disabled');
}

const SAFE_OPTIONS = {
  language: 'yaml',
  engines: {
    yaml: {
      parse: (input: string): object => (yamlLoad(input) ?? {}) as object,
      stringify: (data: object): string => yamlDump(data),
    },
    javascript: { parse: rejectJsEngine },
    js: { parse: rejectJsEngine },
  },
} as const;

/**
 * Parses markdown into its front-matter `data` and `content`, with the
 * JavaScript engine disabled. Throws on malformed YAML — callers keep their
 * own try/catch handling, exactly as with a bare `matter(raw)` call.
 */
export function parseFrontmatter(raw: string): matter.GrayMatterFile<string> {
  return matter(raw, SAFE_OPTIONS);
}

/**
 * Serialises `data` as YAML front-matter prepended to `content`. Mirror of
 * `matter.stringify`, routed through the same hardened options for symmetry.
 */
export function stringifyFrontmatter(content: string, data: Record<string, unknown>): string {
  return matter.stringify(content, data, SAFE_OPTIONS);
}
