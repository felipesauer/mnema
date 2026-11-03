// How each host of the free block is configured for OpenRouter, through the relay, with the mnema plugin of the commit
// of the tag. The configuration is the one the contract suite (packages/code/tests/host-contract/support/the-*.ts)
// gives each host for a stand-in model, and the documentation of each host for a provider with another base URL: the
// only difference is that the base URL is the relay's and the model is the fixed one. EVERY KEY HERE IS MADE UP: the
// real one is the relay's, read from its file at the moment of a request, and no host ever sees it.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CODEX_WEB_SEARCH } from '../measured/protocol.mjs';
import { trustPluginHooks } from './codex-trust.mjs';

export const STAND_IN_KEY = 'stand-in-key-0000000000000000';

/** Settings common to every host: no update check, no telemetry. Each host's own names are used below. */
export const adapters = {
  qwen: {
    prepare({ box, relayUrl, model, pluginDir }) {
      mkdirSync(join(box.home, '.qwen'), { recursive: true });
      writeFileSync(
        join(box.home, '.qwen', 'settings.json'),
        `${JSON.stringify({ security: { auth: { selectedType: 'openai' } }, general: { enableAutoUpdate: false }, privacy: { usageStatisticsEnabled: false }, telemetry: { enabled: false } }, null, 2)}\n`,
      );
      return {
        env: { OPENAI_BASE_URL: relayUrl, OPENAI_API_KEY: STAND_IN_KEY, OPENAI_MODEL: model.id },
        installs: [['extensions', 'install', join(pluginDir, 'plugin'), '--consent']],
        run: (prompt) => ['-p', prompt, '--approval-mode', 'yolo', '-m', model.id],
      };
    },
  },
  copilot: {
    prepare({ box, relayUrl, model, pluginDir }) {
      const copilotHome = join(box.root, 'copilot');
      mkdirSync(copilotHome, { recursive: true });
      return {
        env: {
          COPILOT_HOME: copilotHome,
          COPILOT_PROVIDER_TYPE: 'openai',
          COPILOT_PROVIDER_BASE_URL: relayUrl,
          COPILOT_PROVIDER_API_KEY: STAND_IN_KEY,
          COPILOT_MODEL: model.id,
          COPILOT_OFFLINE: 'true',
          COPILOT_AUTO_UPDATE: 'false',
          COPILOT_ALLOW_ALL: 'true',
        },
        installs: [
          ['plugin', 'marketplace', 'add', pluginDir],
          ['plugin', 'install', 'mnema@mnema'],
        ],
        run: (prompt) => ['-p', prompt, '--allow-all', '--no-color'],
      };
    },
  },
  opencode: {
    prepare({ box, relayUrl, model, pluginDir, opencodeVersion }) {
      writeFileSync(
        join(box.project, 'opencode.json'),
        `${JSON.stringify(
          {
            autoupdate: false,
            share: 'disabled',
            model: `openrouter/${model.id}`,
            provider: {
              openrouter: {
                options: { baseURL: relayUrl, apiKey: STAND_IN_KEY },
                models: { [model.id]: { name: model.id, tool_call: true, limit: { context: model.context_length, output: 8000 } } },
              },
            },
            mcp: { mnema: { type: 'local', command: ['mnema', 'mcp'] } },
          },
          null,
          2,
        )}\n`,
      );
      mkdirSync(join(box.project, '.opencode', 'plugins'), { recursive: true });
      copyFileSync(join(pluginDir, 'plugin', 'opencode', 'mnema.js'), join(box.project, '.opencode', 'plugins', 'mnema.js'));
      // OpenCode installs `@opencode-ai/plugin` from npm into each folder it reads configuration from; a person's
      // machine has it already, so the folders get what that install leaves and the host does not wait on a lookup.
      for (const folder of [join(box.project, '.opencode'), join(box.root, 'xdg', 'config', 'opencode'), join(box.home, '.opencode')]) {
        mkdirSync(join(folder, 'node_modules'), { recursive: true });
        const dependencies = { '@opencode-ai/plugin': opencodeVersion };
        writeFileSync(join(folder, 'package.json'), JSON.stringify({ dependencies }));
        writeFileSync(join(folder, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies } } }));
      }
      return {
        env: {
          XDG_CONFIG_HOME: join(box.root, 'xdg', 'config'),
          XDG_DATA_HOME: join(box.root, 'xdg', 'data'),
          XDG_CACHE_HOME: join(box.root, 'xdg', 'cache'),
          XDG_STATE_HOME: join(box.root, 'xdg', 'state'),
          OPENCODE_DISABLE_AUTOUPDATE: '1',
          OPENCODE_DISABLE_MODELS_FETCH: '1',
          OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
        },
        installs: [],
        run: (prompt) => ['run', prompt],
      };
    },
  },
  codex: {
    prepare({ box, relayUrl, model, pluginDir, pluginVersion }) {
      const codexHome = join(box.root, 'codex');
      mkdirSync(codexHome, { recursive: true });
      writeFileSync(
        join(codexHome, 'config.toml'),
        [
          `model = "${model.id}"`,
          'model_provider = "openrouter"',
          'check_for_update_on_startup = false',
          // The one line the web search test adds (measured/protocol.mjs CODEX_WEB_SEARCH): Codex then offers the model no web_search tool.
          ...(CODEX_WEB_SEARCH === 'disabled' ? ['web_search = "disabled"'] : []),
          '',
          '[model_providers.openrouter]',
          'name = "openrouter"',
          `base_url = "${relayUrl}"`,
          'wire_api = "responses"',
          'env_key = "STAND_IN_KEY"',
          '',
          '[analytics]',
          'enabled = false',
          '',
          '[otel]',
          'exporter = "none"',
          '',
        ].join('\n'),
      );
      return {
        env: { CODEX_HOME: codexHome, STAND_IN_KEY: STAND_IN_KEY, TERM: 'dumb' },
        installs: [
          ['plugin', 'marketplace', 'add', pluginDir],
          ['plugin', 'add', 'mnema@mnema'],
        ],
        // The plugin's hooks are TRUSTED BY CONFIGURATION in this session's own CODEX_HOME (hosts/codex-trust.mjs): the host's
        // own listing of them, checked against the pinned plugin tree, written as `[hooks.state."<key>"] trusted_hash` into
        // the home's config.toml. No bypass flag: not `--dangerously-bypass-hook-trust`, not
        // `--dangerously-bypass-approvals-and-sandbox`; the host's own read-only sandbox stays on and approvals are never asked
        // (a tool that needs one is refused, not waited for). `--json` makes the host print its events, among them the start
        // and the end of every hook, which is the proof that they ran.
        afterInstall: ({ binary, env, cwd }) => trustPluginHooks({ binary, env, cwd, pinnedPluginDir: join(pluginDir, 'plugin'), pluginVersion }),
        run: (prompt) => ['exec', '--json', '--sandbox', 'read-only', '-c', 'approval_policy="never"', '--skip-git-repo-check', prompt],
      };
    },
  },
};
