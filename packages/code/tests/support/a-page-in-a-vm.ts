/**
 * A PAGE IN A VM: the HTML `mnema site` wrote, parsed into a small DOM, and the page's script run
 * over it in a context that has no `Buffer`, no `require` and no filesystem.
 *
 * It is a fake, and it says what it is a fake of: the writer's own output (well formed, every
 * attribute double quoted, the five entities `escapeHtml` writes) and the handful of members the
 * script uses (`site/browser/dom.ts`). It is not a browser, and what it cannot say (layout, paint,
 * the real event loop) the cases that use it do not claim.
 *
 * IT REFUSES THE WAYS INTO THE PAGE THAT TAKE MARKUP. Assigning `innerHTML` or `outerHTML`,
 * calling `insertAdjacentHTML` or `document.write`, or touching `style` throws, so a script that
 * used one fails at the line that did. Every write that is allowed is kept in `writes`, by the
 * member it went through, so a case can say that a hostile string entered only as text.
 */

import vm from 'node:vm';

/** What the page's script wrote, by the member it went through. */
export interface Write {
  readonly via: 'textContent' | 'setAttribute' | 'value' | 'hidden' | 'createElement';
  readonly value: string;
}

type Listener = () => void;

/** One element of the parsed page, or a text node (`tag === '#text'`). */
export class FakeElement {
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Listener[]>();
  parent: FakeElement | undefined;
  /** What a control holds: the script reads and sets it like a property. */
  value = '';
  open = false;
  private text = '';

  constructor(
    readonly tag: string,
    readonly attributes: Map<string, string>,
    private readonly log: Write[],
    text = '',
  ) {
    this.text = text;
  }

  get textContent(): string {
    if (this.tag === '#text') return this.text;
    return this.children.map((child) => child.textContent).join('');
  }

  set textContent(value: string | null) {
    this.log.push({ via: 'textContent', value: value ?? '' });
    this.children.length = 0;
    if (value !== null && value !== '') {
      const node = new FakeElement('#text', new Map(), this.log, value);
      node.parent = this;
      this.children.push(node);
    }
  }

  get hidden(): boolean {
    return this.attributes.has('hidden');
  }

  set hidden(value: boolean) {
    this.log.push({ via: 'hidden', value: String(value) });
    if (value) this.attributes.set('hidden', '');
    else this.attributes.delete('hidden');
  }

  setAttribute(name: string, value: string): void {
    if (name === 'style' || name.startsWith('on')) {
      throw new Error(`the script set the attribute ${name}, which a page's policy does not allow`);
    }
    this.log.push({ via: 'setAttribute', value });
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child: FakeElement): void {
    child.parent = this;
    this.children.push(child);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  /** What a reader's action does: runs the listeners the script put on `type`. */
  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = [];
    const walk = (node: FakeElement): void => {
      for (const child of node.children) {
        if (child.tag !== '#text' && child.matches(selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }

  /** `tag`, `.class`, `[attr]`, `[attr="v"]` and any of them together; nothing else is used. */
  matches(selector: string): boolean {
    const parts = selector.match(/^([a-z0-9-]*)((?:\.[\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/);
    if (parts === null) throw new Error(`the fake DOM does not know the selector ${selector}`);
    const [, tag = '', rest = ''] = parts;
    if (tag !== '' && tag !== this.tag) return false;
    for (const part of rest.match(/\.[\w-]+|\[[^\]]+\]/g) ?? []) {
      if (part.startsWith('.')) {
        if (!(this.attributes.get('class') ?? '').split(/\s+/).includes(part.slice(1))) {
          return false;
        }
        continue;
      }
      const [, name = '', value] = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(part) ?? [];
      if (!this.attributes.has(name)) return false;
      if (value !== undefined && this.attributes.get(name) !== value) return false;
    }
    return true;
  }

  /** Every way into the page that takes markup is a refusal. */
  set innerHTML(_: string) {
    throw new Error('the script assigned innerHTML');
  }

  set outerHTML(_: string) {
    throw new Error('the script assigned outerHTML');
  }

  insertAdjacentHTML(): never {
    throw new Error('the script called insertAdjacentHTML');
  }

  get style(): never {
    throw new Error('the script touched style');
  }
}

const VOID = new Set(['meta', 'input', 'br', 'link', 'img', 'hr']);
const RAW = new Set(['script', 'style', 'noscript']);

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};
const decode = (text: string): string =>
  text.replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e] as string);

/** The page: its elements, by id and by selector, and what the script wrote. */
export class FakePage {
  readonly writes: Write[] = [];
  readonly root: FakeElement;
  private readonly byId = new Map<string, FakeElement>();

  constructor(html: string) {
    this.root = new FakeElement('#root', new Map(), this.writes);
    const stack: FakeElement[] = [this.root];
    const top = (): FakeElement => stack[stack.length - 1] as FakeElement;
    const token =
      /<!doctype[^>]*>|<\/([a-z0-9]+)>|<([a-z0-9]+)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/gi;
    let match: RegExpExecArray | null = token.exec(html);
    while (match !== null) {
      const [, closing, opening, attrs, text] = match;
      if (closing !== undefined) {
        const at = stack.map((e) => e.tag).lastIndexOf(closing.toLowerCase());
        if (at > 0) stack.length = at;
      } else if (opening !== undefined) {
        const tag = opening.toLowerCase();
        const attributes = new Map<string, string>();
        for (const [, name, value] of (attrs ?? '').matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
          attributes.set(name as string, decode(value ?? ''));
        }
        const element = new FakeElement(tag, attributes, this.writes);
        element.parent = top();
        top().children.push(element);
        const id = attributes.get('id');
        if (id !== undefined) this.byId.set(id, element);
        if (RAW.has(tag)) {
          const end = html.toLowerCase().indexOf(`</${tag}>`, token.lastIndex);
          const raw = html.slice(token.lastIndex, end);
          const node = new FakeElement('#text', new Map(), this.writes, raw);
          node.parent = element;
          if (raw !== '') element.children.push(node);
          token.lastIndex = end + `</${tag}>`.length;
        } else if (!VOID.has(tag)) {
          stack.push(element);
        }
      } else if (text !== undefined) {
        const node = new FakeElement('#text', new Map(), this.writes, decode(text));
        node.parent = top();
        top().children.push(node);
      }
      match = token.exec(html);
    }
  }

  getElementById(id: string): FakeElement | null {
    return this.byId.get(id) ?? null;
  }

  createElement(tag: string): FakeElement {
    this.writes.push({ via: 'createElement', value: tag });
    return new FakeElement(tag, new Map(), this.writes);
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.root.querySelectorAll(selector);
  }

  write(): never {
    throw new Error('the script called document.write');
  }
}

/** A timer queue the case drains by hand: what the page's `setTimeout` is. */
export class FakeTimers {
  private readonly queue: (() => void)[] = [];
  readonly setTimeout = (callback: () => void): number => this.queue.push(callback);

  /** Runs what was set, and what that sets, until nothing is left. */
  drain(): number {
    let ran = 0;
    for (let next = this.queue.shift(); next !== undefined; next = this.queue.shift()) {
      next();
      ran++;
    }
    return ran;
  }

  get pending(): number {
    return this.queue.length;
  }
}

/** A page, its timers, and the script run over it. */
export interface PageRun {
  readonly page: FakePage;
  readonly timers: FakeTimers;
}

/**
 * Parses `html` and runs `script` over it in a context shaped like a plain page. The timers are
 * NOT drained: the case says when the first paint is over (`timers.drain()`).
 */
export function runInAVm(html: string, script: string): PageRun {
  const page = new FakePage(html);
  const timers = new FakeTimers();
  const context = vm.createContext({
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    URL,
    document: page,
    setTimeout: timers.setTimeout,
  });
  vm.runInContext('delete globalThis.SharedArrayBuffer', context);
  vm.runInContext(script, context);
  return { page, timers };
}
