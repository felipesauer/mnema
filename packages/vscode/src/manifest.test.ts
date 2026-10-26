import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Command {
  command: string;
  title: string;
  icon?: string;
}
interface MenuItem {
  command: string;
  when?: string;
  group?: string;
}
interface Manifest {
  capabilities?: { untrustedWorkspaces?: { supported?: unknown } };
  contributes: {
    configuration: {
      properties: Record<
        string,
        { scope?: unknown; description?: unknown; markdownDescription?: unknown }
      >;
    };
    views: Record<string, { id: string }[]>;
    viewsWelcome: { view: string; contents: string; when: string }[];
    commands: Command[];
    menus: Record<string, MenuItem[]>;
  };
}

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as Manifest;
const { commands, menus, views, viewsWelcome } = manifest.contributes;

describe('the extension manifest', () => {
  it('reads the executable only from the user or machine settings, never from a repository', () => {
    expect(manifest.contributes.configuration.properties['mnema.command']?.scope).toBe('machine');
  });

  it('does not run in a workspace that is not trusted', () => {
    expect(manifest.capabilities?.untrustedWorkspaces?.supported).toBe(false);
  });

  it('gives every command a codicon and a short title that starts with the product name', () => {
    expect(commands.length).toBeGreaterThan(0);
    for (const { command, title, icon } of commands) {
      expect(icon, `${command} icon`).toMatch(/^\$\([a-z]+(-[a-z]+)*\)$/);
      expect(title, `${command} title`).toMatch(/^mnema: [A-Z][A-Za-z]*( [A-Za-z]+){0,4}$/);
    }
  });

  it('puts no button in a view without the icon that stands for it', () => {
    const icons = new Map(commands.map((c) => [c.command, c.icon]));
    const buttons = [...(menus['view/title'] ?? []), ...(menus['view/item/context'] ?? [])].filter(
      (item) => item.group === undefined || /^(inline|navigation)/.test(item.group),
    );
    expect(buttons.length).toBeGreaterThan(0);
    for (const item of buttons) expect(icons.get(item.command), item.command).toBeDefined();
  });

  it('lists every command in the palette, only where a workspace is open, and the file command only over a file', () => {
    const palette = new Map((menus.commandPalette ?? []).map((item) => [item.command, item.when]));
    expect([...palette.keys()].sort()).toEqual(commands.map((c) => c.command).sort());
    for (const [command, when] of palette) {
      expect(when, command).toMatch(/^workspaceFolderCount > 0/);
    }
    expect(palette.get('mnema.showRules')).toContain('resourceScheme == file');
  });

  it('tells each view what to do when it is empty, with and without a record in the folder', () => {
    const ids = Object.values(views)
      .flat()
      .map((view) => view.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const whens = viewsWelcome.filter((w) => w.view === id).map((w) => w.when);
      expect(whens.sort(), id).toEqual(['!mnema.hasRecord', 'mnema.hasRecord']);
    }
    const known = [...commands.map((c) => c.command), 'workbench.action.openSettings'];
    for (const { contents } of viewsWelcome) {
      for (const [, target] of contents.matchAll(/\]\(command:([^)?]+)/g)) {
        expect(known).toContain(target);
      }
    }
  });

  it('describes each setting in markdown', () => {
    for (const [key, setting] of Object.entries(manifest.contributes.configuration.properties)) {
      expect(typeof setting.markdownDescription, key).toBe('string');
      expect(setting.description, key).toBeUndefined();
    }
  });

  it('keeps the list of commands in one place: the editor check reads it from the installed manifest', () => {
    const check = readFileSync(new URL('../build/in-the-editor.cjs', import.meta.url), 'utf8');
    expect(check).not.toMatch(/'mnema\.[A-Za-z.]+'/);
    expect(check).toContain('contributes.commands');
  });
});
