import path from 'node:path';

import type { Command } from 'commander';
import pc from 'picocolors';
import { printError } from '../../errors/error-printer.js';
import type { Attachment } from '../../storage/sqlite/repositories/attachment-repository.js';
import { withCliContext, withMutatingCliContext } from '../cli-context.js';

interface AttachOptions {
  readonly mime?: string;
}

/**
 * Registers `mnema attach`, the attachment ingestion command.
 *
 * Subcommands:
 * - `attach add <key> <filePath>` — store the file (dedup) and attach
 *   it to a task or decision. The key shape is inferred: keys matching
 *   `<PROJECT>-ADR-<N>` go to decisions, everything else to tasks.
 * - `attach list <key>` — show attachments of a task or decision
 *
 * Notes will join once `NoteService` exposes an attach surface.
 */
export class AttachCommand {
  /**
   * Attaches the `attach` command group to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program
      .command('attach')
      .description('Manage attachments on tasks and decisions');

    group
      .command('add <key> <filePath>')
      .description(
        'Add a file as attachment to a task or decision (deduplicated by hash). ' +
          'Decision keys are recognised by the `-ADR-` segment (e.g. WEBAPP-ADR-3).',
      )
      .option('--mime <type>', 'Override the inferred MIME type')
      .action(async (key: string, filePath: string, options: AttachOptions) => {
        await withMutatingCliContext(({ container, projectRoot }) => {
          const absolute = path.isAbsolute(filePath)
            ? filePath
            : path.resolve(projectRoot, filePath);

          const isDecision = isDecisionKey(key);
          const result = isDecision
            ? container.attachment.attachToDecision({
                decisionKey: key,
                sourcePath: absolute,
                mime: options.mime,
                actor: container.identity.getDefaultActor(),
              })
            : container.attachment.attachToTask({
                taskKey: key,
                sourcePath: absolute,
                mime: options.mime,
                actor: container.identity.getDefaultActor(),
              });
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          const attachment = result.value;
          process.stdout.write(
            `${pc.green('✓')} ${pc.bold(attachment.filename)} attached to ${pc.bold(key)} ` +
              `${pc.dim(`(${attachment.size}B, ${attachment.hash.slice(0, 12)}…)`)}\n`,
          );
        });
      });

    group
      .command('list <key>')
      .description("List a task or decision's attachments")
      .action(async (key: string) => {
        await withCliContext(({ container }) => {
          const result = isDecisionKey(key)
            ? container.attachment.listForDecision(key)
            : container.attachment.listForTask(key);
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

function isDecisionKey(key: string): boolean {
  return /-ADR-\d+$/i.test(key);
}

function formatRow(attachment: Attachment): string {
  return [
    pc.bold(attachment.filename.padEnd(30)),
    `${attachment.size}B`.padEnd(10),
    attachment.mime.padEnd(24),
    pc.dim(attachment.hash.slice(0, 12)),
  ].join(' ');
}
