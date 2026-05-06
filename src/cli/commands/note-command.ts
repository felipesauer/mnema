import type { Command } from 'commander';
import pc from 'picocolors';

import type { Note, NoteKind } from '../../domain/entities/note.js';
import { printError } from '../../errors/error-printer.js';
import { withCliContext } from '../cli-context.js';

const VALID_KINDS: readonly NoteKind[] = [
  'comment',
  'block_reason',
  'unblock_reason',
  'review_feedback',
  'review_approval',
  'cancel_reason',
  'reopen_reason',
  'agent_observation',
];

interface AddOptions {
  readonly content: string;
  readonly kind?: string;
}

interface ListOptions {
  readonly kind?: string;
}

/**
 * Registers the `mnema note` command group.
 *
 * Subcommands:
 * - `note add <taskKey> --content=...`  → attach a typed note
 * - `note list <taskKey>`               → list notes of a task
 */
export class NoteCommand {
  /**
   * Attaches the `note` command group to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program.command('note').description('Manage task notes');

    group
      .command('add <taskKey>')
      .description('Attach a typed note to a task (default kind: comment)')
      .requiredOption('--content <text>', 'Note content')
      .option('--kind <kind>', `One of: ${VALID_KINDS.join(', ')}`, 'comment')
      .action(async (taskKey: string, options: AddOptions) => {
        await withCliContext(({ container }) => {
          const kind = parseKind(options.kind ?? 'comment');
          const result = container.note.add({
            taskKey,
            content: options.content,
            kind,
            actor: container.identity.getDefaultActor(),
          });
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          process.stdout.write(
            `${pc.green('✓')} note added to ${pc.bold(taskKey)} ${pc.dim(`(${result.value.kind})`)}\n`,
          );
        });
      });

    group
      .command('list <taskKey>')
      .description('List notes of a task')
      .option('--kind <kind>', 'Filter by note kind')
      .action(async (taskKey: string, options: ListOptions) => {
        await withCliContext(({ container }) => {
          const kind = options.kind === undefined ? undefined : parseKind(options.kind);
          const result = container.note.listForTask(taskKey, kind);
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          if (result.value.length === 0) {
            process.stdout.write(`${pc.dim('(no notes)')}\n`);
            return;
          }
          for (const note of result.value) {
            process.stdout.write(`${formatNote(note)}\n`);
          }
        });
      });
  }
}

function parseKind(raw: string): NoteKind {
  if (!VALID_KINDS.includes(raw as NoteKind)) {
    process.stderr.write(`${pc.red('error:')} unknown note kind \`${raw}\`\n`);
    process.exit(2);
  }
  return raw as NoteKind;
}

function formatNote(note: Note): string {
  const header = `${pc.dim(note.at)} ${pc.bold(note.kind.padEnd(20))}`;
  const indented = note.content
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  return `${header}\n${indented}`;
}
