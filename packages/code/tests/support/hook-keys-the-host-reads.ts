/**
 * WHAT CLAUDE CODE READS IN A HOOKS FILE — the events and the keys, as the host documents them.
 *
 * READ OFF https://code.claude.com/docs/en/hooks on 2026-10-05: the events from the table under
 * "Hook lifecycle", the matcher-group shape from "Configuration", the handler keys from "Hook
 * handler fields" (common fields, then one table per handler type), and the plugin file's
 * optional top-level `description` from "Reference scripts by path" (a plugin's
 * `hooks/hooks.json`). The manifest page is https://code.claude.com/docs/en/plugins/manifest-reference.
 *
 * It is a list copied from a page that moves. A name the host adds after that date and this
 * plugin uses makes the test that calls {@link whatTheHostDoesNotRead} red until the list is
 * read again and the date above changes with it: a red that names its own cause, and the cheaper
 * mistake of the two — the other is a hook that never runs.
 */

/** Every event in the host's lifecycle table. */
export const EVENTS: readonly string[] = [
  'SessionStart',
  'Setup',
  'UserPromptSubmit',
  'UserPromptExpansion',
  'PreToolUse',
  'PermissionRequest',
  'PermissionDenied',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'Notification',
  'MessageDisplay',
  'SubagentStart',
  'SubagentStop',
  'TaskCreated',
  'TaskCompleted',
  'Stop',
  'StopFailure',
  'TeammateIdle',
  'InstructionsLoaded',
  'ConfigChange',
  'CwdChanged',
  'DirectoryAdded',
  'FileChanged',
  'WorktreeCreate',
  'WorktreeRemove',
  'PreCompact',
  'PostCompact',
  'PreModelSwitch',
  'PostModelSwitch',
  'Elicitation',
  'ElicitationResult',
  'SessionEnd',
];

/** The keys of a plugin's `hooks/hooks.json`. */
const TOP_LEVEL: readonly string[] = ['description', 'hooks'];

/** The keys of a matcher group. */
const MATCHER_GROUP: readonly string[] = ['matcher', 'hooks'];

/** The keys every handler accepts. */
const COMMON: readonly string[] = ['type', 'if', 'timeout', 'statusMessage', 'once'];

/** The keys each handler type accepts beyond the common ones. */
const BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  command: ['command', 'args', 'async', 'asyncRewake', 'shell'],
  http: ['url', 'headers', 'allowedEnvVars'],
  mcp_tool: ['server', 'tool', 'input'],
  prompt: ['prompt', 'model'],
  agent: ['prompt', 'model'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every event, key or handler type of a parsed hooks file that the host does not read, one
 * sentence each; empty when the file says only what is documented.
 */
export function whatTheHostDoesNotRead(file: Record<string, unknown>): string[] {
  const found: string[] = [];
  for (const key of Object.keys(file)) {
    if (!TOP_LEVEL.includes(key)) found.push(`top-level key "${key}"`);
  }
  const events = isRecord(file.hooks) ? file.hooks : {};
  for (const [event, groups] of Object.entries(events)) {
    if (!EVENTS.includes(event)) found.push(`event "${event}"`);
    for (const group of Array.isArray(groups) ? groups : []) {
      if (!isRecord(group)) continue;
      for (const key of Object.keys(group)) {
        if (!MATCHER_GROUP.includes(key)) found.push(`${event} matcher group key "${key}"`);
      }
      for (const handler of Array.isArray(group.hooks) ? group.hooks : []) {
        if (!isRecord(handler)) continue;
        const type = typeof handler.type === 'string' ? handler.type : '';
        const own = BY_TYPE[type];
        if (own === undefined) {
          found.push(`${event} handler type "${type}"`);
          continue;
        }
        for (const key of Object.keys(handler)) {
          if (!COMMON.includes(key) && !own.includes(key)) {
            found.push(`${event} handler (${type}) key "${key}"`);
          }
        }
      }
    }
  }
  return found;
}
