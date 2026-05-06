import path from 'node:path';

import type { Command } from 'commander';
import pc from 'picocolors';
import { printError } from '../../errors/error-printer.js';
import type { Attachment } from '../../storage/sqlite/repositories/attachment-repository.js';
import { withCliContext } from '../cli-context.js';

interface AttachOptions {
  readonly mime?: string;
}

/**
 * Registers `mnema attach`, the attachment ingestion command.
 *
 * Two subcommands today:
 * - `attach add <taskKey> <filePath>` — store the file (dedup) and
 *   attach it to a task
 * - `attach list <taskKey>` — show attachments of a task
 */
export class AttachCommand {
  /**
   * Attaches the `attach` command group to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program.command('attach').description('Manage task attachments');

    group
      .command('add <taskKey> <filePath>')
      .description('Add a file as attachment to a task (deduplicated by hash)')
      .option('--mime <type>', 'Override the inferred MIME type')
      .action(async (taskKey: string, filePath: string, options: AttachOptions) => {
        await withCliContext(({ container, projectRoot }) => {
          const absolute = path.isAbsolute(filePath)
            ? filePath
            : path.resolve(projectRoot, filePath);

          const result = container.attachment.attachToTask({
            taskKey,
            sourcePath: absolute,
            mime: options.mime,
            actor: container.identity.getDefaultActor(),
          });
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          const attachment = result.value;
          process.stdout.write(
            `${pc.green('✓')} ${pc.bold(attachment.filename)} attached to ${pc.bold(taskKey)} ` +
              `${pc.dim(`(${attachment.size}B, ${attachment.hash.slice(0, 12)}…)`)}\n`,
          );
        });
      });

    group
      .command('list <taskKey>')
      .description("List a task's attachments")
      .action(async (taskKey: string) => {
        await withCliContext(({ container }) => {
          const result = container.attachment.listForTask(taskKey);
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          if (result.value.length === 0) {
            process.stdout.write(`${pc.dim('(no attachments)')}\n`);
            return;
          }
          for (const att of result.value) {
            process.stdout.write(`${formatRow(att)}\n`);
          }
        });
      });
  }
}

function formatRow(attachment: Attachment): string {
  return [
    pc.bold(attachment.filename.padEnd(30)),
    `${attachment.size}B`.padEnd(10),
    attachment.mime.padEnd(24),
    pc.dim(attachment.hash.slice(0, 12)),
  ].join(' ');
}
