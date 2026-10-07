// A stand-in language model for VS Code's chat agent. It records every request the agent sends it,
// and answers the first request that offers a file-writing tool with one call to that tool. The
// manifest has no `enabledApiProposals`: if `registerLanguageModelChatProvider` were a proposed
// API, registering would throw and say so in the log the case reads.
//
// It listens to nothing and connects to nothing; the agent calls it in process.
const vscode = require('vscode');
const fs = require('node:fs');

const out = process.env.MNEMA_CONTRACT_OUT;
const log = (message) =>
  fs.appendFileSync(`${out}/runner.log`, `${new Date().toISOString()} ${message}\n`);
let requests = 0;
let called = false;

const model = {
  id: 'stand-in-0',
  name: 'Stand-in',
  family: 'claude-sonnet-4.5',
  version: '1',
  maxInputTokens: 200000,
  maxOutputTokens: 8192,
  capabilities: { toolCalling: true, imageInput: false },
};

/** One part of a message, as a plain value a file can hold. */
const partOut = (part) => {
  if (part instanceof vscode.LanguageModelTextPart) return { text: part.value };
  try {
    return { kind: part?.constructor?.name, json: JSON.parse(JSON.stringify(part)) };
  } catch {
    return { kind: 'unserializable' };
  }
};

exports.activate = (context) => {
  log(`vscode ${vscode.version}`);
  log(`manifest declares no API proposal: ${!context.extension.packageJSON.enabledApiProposals}`);
  try {
    context.subscriptions.push(
      vscode.lm.registerLanguageModelChatProvider('stand-in', {
        provideLanguageModelChatInformation: async () => [model],
        provideLanguageModelChatResponse: async (_model, messages, options, progress) => {
          requests += 1;
          fs.writeFileSync(
            `${out}/capture-${requests}.json`,
            JSON.stringify(
              {
                messages: messages.map((m) => ({
                  role: m.role,
                  parts: (m.content || []).map(partOut),
                })),
                tools: (options.tools || []).map((t) => t.name),
              },
              null,
              1,
            ),
          );
          const writer = (options.tools || []).find((t) => /create_?file/i.test(t.name));
          if (writer && !called) {
            called = true;
            log(`answering request ${requests} with a call to ${writer.name}`);
            progress.report(
              new vscode.LanguageModelToolCallPart('call_stand_in_1', writer.name, {
                filePath: `${process.env.MNEMA_CONTRACT_WORKSPACE}/${process.env.MNEMA_CONTRACT_TARGET}`,
                content: 'written by the stand-in\n',
              }),
            );
            return;
          }
          progress.report(new vscode.LanguageModelTextPart('done'));
        },
        provideTokenCount: async (_model, text) =>
          Math.ceil((typeof text === 'string' ? text : JSON.stringify(text)).length / 4),
      }),
    );
    log('registerLanguageModelChatProvider: registered with no API proposal enabled');
  } catch (error) {
    log(`registerLanguageModelChatProvider: threw ${error?.message ?? error}`);
  }
};

exports.deactivate = () => {};
