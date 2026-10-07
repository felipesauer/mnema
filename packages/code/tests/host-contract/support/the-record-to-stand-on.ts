/**
 * The record a case stands on, written through the product's own verbs in the sandbox project.
 *
 * Nothing here asserts: a verb that refuses throws, because a case whose record was never written
 * proves nothing about what the host did with it.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
