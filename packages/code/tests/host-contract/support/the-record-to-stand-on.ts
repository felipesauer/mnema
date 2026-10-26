/**
 * The record a case stands on, written through the product's own verbs in the sandbox project.
 *
 * Nothing here asserts: a verb that refuses throws, because a case whose record was never written
 * proves nothing about what the host did with it.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalogUpcasters } from '@mnema/chain';
import { orderedEvents, resolveTrees } from '@mnema/core';

/** What a case is handed to write a record with. */
export interface TheProject {
  readonly dir: string;
  mnema(...args: string[]): string;
}

/** The id in the parentheses of a verb's echo. */
export function idIn(echo: string): string {
  const id = echo.match(/\(([0-9a-f-]{20,})\)/)?.[1];
  if (id === undefined) throw new Error(`setup: no id in ${JSON.stringify(echo)}`);
  return id;
}

/** A decision recorded and accepted, so it is in force. */
export function decide(project: TheProject, title: string): string {
  const id = idIn(project.mnema('decision', 'record', title, `why: ${title}`));
  project.mnema('decision', 'move', 'accept', id, '--note', 'agreed');
  return id;
}

/** A decision in force, linked to an address under a relation, and the address made a directory. */
export function ruleAt(project: TheProject, title: string, address: string, rel: string): string {
  mkdirSync(join(project.dir, address), { recursive: true });
  const id = decide(project, title);
  project.mnema('link', id, address, '--rel', rel);
  return id;
}

/** A second link of an existing decision to an address, under another relation. */
export function alsoAt(project: TheProject, id: string, address: string, rel: string): void {
  mkdirSync(join(project.dir, address), { recursive: true });
  project.mnema('link', id, address, '--rel', rel);
}

/** A file the case will edit, with the content it has before. */
export function aFile(project: TheProject, path: string, content: string): string {
  mkdirSync(join(project.dir, path, '..'), { recursive: true });
  writeFileSync(join(project.dir, path), content);
  return join(project.dir, path);
}

/**
 * A line the reader refuses, appended to the project's public tail: a copy of its last line under
 * a kind no mnema knows, as a newer mnema's line reads to an older one. Returns the segment's
 * bytes after it, so a case can say nothing more was appended.
 */
export function aLineTheReaderRefuses(project: TheProject): string {
  const tails = join(project.dir, '.mnema', 'tails');
  const [tail, ...others] = readdirSync(tails);
  if (tail === undefined || others.length > 0) throw new Error(`setup: not one tail in ${tails}`);
  const segment = join(tails, tail, '000001.jsonl');
  const sound = readFileSync(segment, 'utf-8');
  const last = sound.trimEnd().split('\n').at(-1) ?? '';
  if (!/"kind":"[a-z.]+"/.test(last)) throw new Error(`setup: no kind in ${segment}`);
  const bytes = `${sound}${last.replace(/"kind":"[a-z.]+"/, '"kind":"bogus.kind"')}\n`;
  writeFileSync(segment, bytes);
  return bytes;
}

/** The bytes of the project's one public segment, read again after a session. */
export function theSegmentOf(project: string): string {
  const tails = join(project, '.mnema', 'tails');
  const [tail] = readdirSync(tails);
  return readFileSync(join(tails, tail ?? '', '000001.jsonl'), 'utf-8');
}

/** How many facts of each kind a project's public tree holds, for the kinds a door writes. */
export function theChannelFactsOf(project: string, home: string): Record<string, number> {
  const events = orderedEvents(
    { root: resolveTrees(project, { home }).projectPublic as string },
    catalogUpcasters(),
  );
  const kinds = ['channel.refused', 'channel.asked', 'channel.served'];
  return Object.fromEntries(
    kinds.map((kind) => [kind, events.filter((event) => event.kind === kind).length]),
  );
}

/** The refusals a project's public tree holds, whole, for a case that asks who recorded them. */
export function theRefusalsOf(project: string, home: string): readonly unknown[] {
  return orderedEvents(
    { root: resolveTrees(project, { home }).projectPublic as string },
    catalogUpcasters(),
  ).filter((event) => event.kind === 'channel.refused');
}
