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
    walkthroughs?: {
      id: string;
      title: string;
      description: string;
      steps: {
        id: string;
        title: string;
        description: string;
        media: { markdown: string };
        completionEvents?: string[];
      }[];
    }[];
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

  it('gives every command a codicon and a title of one to three words after the product name, because it is the tooltip of a button', () => {
    expect(commands.length).toBeGreaterThan(0);
    for (const { command, title, icon } of commands) {
      expect(icon, `${command} icon`).toMatch(/^\$\([a-z]+(-[a-z]+)*\)$/);
      expect(title, `${command} title`).toMatch(/^mnema: [A-Z][A-Za-z]*( [A-Za-z]+){0,2}$/);
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

  it('groups the buttons by meaning: at most three icons beside an item, the rest in named, ordered groups', () => {
    for (const menu of ['view/title', 'view/item/context']) {
      for (const view of ['view == mnema.proposed', 'view == mnema.stacks']) {
        const items = (menus[menu] ?? []).filter((item) => item.when?.includes(view));
        const buttons = items.filter((item) => /^(inline|navigation)@\d+$/.test(item.group ?? ''));
        expect(buttons.length, `${menu} ${view}`).toBeLessThanOrEqual(3);
        for (const item of items) {
          expect(item.group, `${menu} ${item.command}`).toMatch(
            /^(inline|navigation|\d_[a-z]+)@\d+$/,
          );
        }
      }
    }
    const rest = (menus['view/item/context'] ?? []).filter((item) => /^\d_/.test(item.group ?? ''));
    expect(
      rest.some((item) => item.command === 'mnema.stacks.remove' && item.group?.startsWith('9_')),
    ).toBe(true);
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
      expect(whens, id).toContain('!mnema.hasRecord');
      expect(
        whens
          .filter((when) => when !== '!mnema.hasRecord')
          .every((when) => when.startsWith('mnema.hasRecord')),
        id,
      ).toBe(true);
    }
    // What a view says of its own emptiness is true only if mnema read it: the stacks view claims
    // "no stack is adopted" only when the list was read, and says it did not read otherwise.
    const stacksWhens = viewsWelcome.filter((w) => w.view === 'mnema.stacks').map((w) => w.when);
    expect(stacksWhens.sort()).toEqual([
      '!mnema.hasRecord',
      'mnema.hasRecord && !mnema.cliMissing && !mnema.stacksRead',
      'mnema.hasRecord && !mnema.cliMissing && mnema.stacksRead',
      'mnema.hasRecord && mnema.cliMissing',
    ]);
    for (const w of viewsWelcome.filter((w) => w.when.endsWith('&& mnema.stacksRead'))) {
      expect(w.contents).toContain('No stack is adopted');
    }
    for (const w of viewsWelcome.filter((w) => w.when.endsWith('&& !mnema.stacksRead'))) {
      expect(w.contents).not.toContain('No stack is adopted');
      expect(w.contents).toContain('status bar');
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
    expect(check.replace("'mnema.mnema'", '')).not.toMatch(/'mnema\.[A-Za-z.]+'/);
    expect(check).toContain('contributes.commands');
  });

  it('tells each view that the command is missing, apart from empty, and no view says "nothing pending" then', () => {
    for (const { id } of Object.values(views).flat()) {
      const mine = viewsWelcome.filter((w) => w.view === id);
      const missing = mine.filter((w) => w.when === 'mnema.hasRecord && mnema.cliMissing');
      expect(missing, id).toHaveLength(1);
      expect(missing[0]?.contents, id).toContain('@mnema/code');
      expect(missing[0]?.contents, id).toContain('mnema.command');
      // Every other entry for a folder with a record is off while the command is missing.
      for (const w of mine.filter((w) => w.when.startsWith('mnema.hasRecord'))) {
        if (w !== missing[0]) expect(w.when, id).toContain('!mnema.cliMissing');
      }
    }
  });

  it('opens with a walkthrough of three steps: point at the command, init, run verify', () => {
    const [walkthrough, ...others] = manifest.contributes.walkthroughs ?? [];
    expect(others).toEqual([]);
    expect(walkthrough?.steps.map((step) => step.id)).toEqual([
      'mnema.start.command',
      'mnema.start.init',
      'mnema.start.verify',
    ]);
    for (const step of walkthrough?.steps ?? []) {
      const page = readFileSync(new URL(`../${step.media.markdown}`, import.meta.url), 'utf8');
      expect(page.length, step.id).toBeGreaterThan(100);
      // What it promises is what the command line says, never that the record is safe.
      expect(`${step.title} ${step.description} ${page}`, step.id).not.toMatch(
        /\b(is|are) (safe|secure|verified|proven|trusted)\b|\byour record is\b/i,
      );
    }
    const last = walkthrough?.steps.at(-1);
    expect(last?.description).toContain('mnema verify');
  });

  it('keeps its words free of emoji and of the long dash', () => {
    const text = JSON.stringify(manifest);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(text).not.toContain(String.fromCharCode(0x2014));
  });
});
