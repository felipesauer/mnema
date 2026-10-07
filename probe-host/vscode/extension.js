// A stand-in language model. It records every request the chat agent sends it, and answers the
// first request that offers a file-writing tool with one tool call to it. No `enabledApiProposals`
// in package.json: if registerLanguageModelChatProvider were a proposed API, this would throw.
const vscode = require('vscode');
const fs = require('node:fs');

const out = process.env.PROBE_OUT;
const log = (m) => fs.appendFileSync(`${out}/runner.log`, `${new Date().toISOString()} ${m}\n`);
let n = 0;
let called = false;

const model = {
  id: 'probe-0',
  name: 'Probe',
  family: 'claude-sonnet-4.5',
  version: '1',
  maxInputTokens: 200000,
  maxOutputTokens: 8192,
  capabilities: { toolCalling: true, imageInput: false },
};

const partOut = (p) => {
  if (p instanceof vscode.LanguageModelTextPart) return { text: p.value };
  try {
    return { kind: p?.constructor?.name, json: JSON.parse(JSON.stringify(p)) };
  } catch {
    return { kind: 'unserializable' };
  }
};

exports.activate = (context) => {
  log(`vscode ${vscode.version}; package.json has no enabledApiProposals: ${!context.extension.packageJSON.enabledApiProposals}`);
  try {
    context.subscriptions.push(
      vscode.lm.registerLanguageModelChatProvider('probe', {
        provideLanguageModelChatInformation: async () => [model],
        provideLanguageModelChatResponse: async (_model, messages, options, progress) => {
          n += 1;
          fs.writeFileSync(
            `${out}/capture-${n}.json`,
            JSON.stringify(
              {
                messages: messages.map((m) => ({ role: m.role, parts: (m.content || []).map(partOut) })),
                tools: (options.tools || []).map((t) => t.name),
              },
              null,
              1,
            ),
          );
          const writer = (options.tools || []).find((t) => /create_?file/i.test(t.name));
          if (writer && !called) {
            called = true;
            log(`answering request ${n} with a call to ${writer.name}`);
            progress.report(
              new vscode.LanguageModelToolCallPart('call_probe_1', writer.name, {
                filePath: `${process.env.PROBE_WS}/written.txt`,
                content: 'probe wrote this\n',
              }),
            );
            return;
          }
          progress.report(new vscode.LanguageModelTextPart('ok'));
        },
        provideTokenCount: async (_m, text) =>
          Math.ceil((typeof text === 'string' ? text : JSON.stringify(text)).length / 4),
      }),
    );
    log('registerLanguageModelChatProvider: REGISTERED without any API proposal enabled');
  } catch (e) {
    log(`registerLanguageModelChatProvider: THREW ${e?.message ?? e}`);
  }
};
exports.deactivate = () => {};
