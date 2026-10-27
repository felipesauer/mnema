import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Command {
  command: string;
  title: string;
  category?: string;
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
        {
          scope?: unknown;
          type?: unknown;
          default?: unknown;
          description?: unknown;
          markdownDescription?: unknown;
        }
      >;
    };
    viewsContainers?: { activitybar?: { id: string; title: string; icon: string }[] };
    views: Record<string, { id: string; name: string }[]>;
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

  it('lets only the person hide the status bar item, because it says when verify fails: the setting is machine-scoped, on by default', () => {
    const setting = manifest.contributes.configuration.properties['mnema.statusBar.enabled'];
    expect(setting?.scope).toBe('machine');
    expect(setting?.type).toBe('boolean');
    expect(setting?.default).toBe(true);
  });

  it('does not run in a workspace that is not trusted', () => {
    expect(manifest.capabilities?.untrustedWorkspaces?.supported).toBe(false);
  });

  it('gives every command a codicon, the category mnema and a title of one to three words, because the editor writes the category before the title in the palette and the title alone is the tooltip of a button', () => {
    expect(commands.length).toBeGreaterThan(0);
    for (const { command, title, icon, category } of commands) {
      expect(icon, `${command} icon`).toMatch(/^\$\([a-z]+(-[a-z]+)*\)$/);
      expect(category, `${command} category`).toBe('mnema');
      expect(title, `${command} title`).toMatch(/^[A-Z][A-Za-z]*( [A-Za-z]+){0,2}$/);
    }
  });

  it('has its own container in the activity bar, titled mnema, with the icon the packer writes, and both views live in it and in no other', () => {
    const containers = manifest.contributes.viewsContainers?.activitybar ?? [];
    expect(containers.map((c) => ({ id: c.id, title: c.title, icon: c.icon }))).toEqual([
      { id: 'mnema', title: 'mnema', icon: 'media/mnema.svg' },
    ]);
    const packer = readFileSync(new URL('../build/package-vsix.mjs', import.meta.url), 'utf8');
    expect(packer).toContain("join(scratch, 'media', 'mnema.svg')");
    expect(Object.keys(views)).toEqual(['mnema']);
    expect(views.mnema?.map((v) => [v.id, v.name])).toEqual([
      ['mnema.proposed', 'Awaiting Judgment'],
      ['mnema.stacks', 'Stacks'],
    ]);
  });

  it('puts no button in a view without the icon that stands for it', () => {
    const icons = new Map(commands.map((c) => [c.command, c.icon]));
    const buttons = [...(menus['view/title'] ?? []), ...(menus['view/item/context'] ?? [])].filter(
      (item) => item.group === undefined || /^(inline|navigation)/.test(item.group),
    );
    expect(buttons.length).toBeGreaterThan(0);
    for (const item of buttons) expect(icons.get(item.command), item.command).toBeDefined();
  });

  it('keeps one action of the stacks title in the overflow menu, not as a third icon', () => {
    const title = menus['view/title'] ?? [];
    const overflow = title.filter((item) => /^\d_[a-z]+@\d+$/.test(item.group ?? ''));
    expect(overflow.map((item) => item.command)).toEqual(['mnema.stacks.addFromIndex']);
    const stacks = title.filter((item) => item.when === 'view == mnema.stacks');
    expect(stacks.filter((item) => item.group?.startsWith('navigation')).length).toBe(2);
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

  it('opens a decision by a command of its own, whose icon is neither a check nor a seal', () => {
    const open = commands.find((c) => c.command === 'mnema.openDecision');
    expect(open?.title).toBe('Open Decision');
    expect(open?.icon).not.toMatch(/check|pass|verified|shield|workspace-trusted/);
  });

  it('keeps accept and reject apart in the context menu of a proposal, each in a group of its own', () => {
    const groups = (menus['view/item/context'] ?? [])
      .filter((item) => item.when === 'view == mnema.proposed' && /^\d_/.test(item.group ?? ''))
      .map((item) => [item.command, item.group]);
    expect(groups).toEqual([
      ['mnema.accept', '1_accept@1'],
      ['mnema.reject', '2_reject@1'],
    ]);
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
    const proposedWhens = viewsWelcome
      .filter((w) => w.view === 'mnema.proposed')
      .map((w) => w.when);
    expect(proposedWhens.sort()).toEqual([
      '!mnema.hasRecord',
      'mnema.hasRecord && !mnema.cliMissing && !mnema.proposedRead',
      'mnema.hasRecord && !mnema.cliMissing && mnema.proposedRead',
      'mnema.hasRecord && mnema.cliMissing',
    ]);
    for (const w of viewsWelcome.filter((w) => w.when.endsWith('&& mnema.proposedRead'))) {
      expect(w.contents).toContain('Nothing awaits a judgment');
    }
    for (const w of viewsWelcome.filter((w) => w.when.endsWith('&& !mnema.proposedRead'))) {
      expect(w.contents).not.toContain('Nothing awaits');
      expect(w.contents).toContain('status bar');
    }
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
    const known = [
      ...commands.map((c) => c.command),
      'workbench.action.openSettings',
      'workbench.action.terminal.new',
    ];
    for (const { contents } of viewsWelcome) {
      for (const [, target] of contents.matchAll(/\]\(command:([^)?]+)/g)) {
        expect(known).toContain(target);
      }
    }
  });

  it('has no welcome line that is only a link, because the editor draws such a line as a wide blue button', () => {
    expect(viewsWelcome.length).toBeGreaterThan(0);
    for (const { view, when, contents } of viewsWelcome) {
      for (const line of contents.split('\n')) {
        expect(line.trim(), `${view} ${when}`).not.toMatch(/^\[[^\]]*\]\([^)]*\)\.?$/);
      }
    }
  });

  it('says in a folder with no record how to start one and where a first one is shown, in every view', () => {
    for (const { id } of Object.values(views).flat()) {
      const none = viewsWelcome.filter((w) => w.view === id && w.when === '!mnema.hasRecord');
      expect(none, id).toHaveLength(1);
      expect(none[0]?.contents, id).toContain('mnema init');
      expect(none[0]?.contents, id).toContain('docs/first-record.md');
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
