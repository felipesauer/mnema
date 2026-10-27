/**
 * The part of the page's DOM the script touches, as types.
 *
 * The product compiles without the DOM library (the rest of this package is for Node), so the few
 * members the script uses are named here, and nothing else is reachable from it. Every way the
 * script writes into the page is on this list, and none of them takes markup: text goes in by
 * `textContent`, a value by `setAttribute` or `value`, a visibility by `hidden`, an element by
 * `createElement` and `appendChild`. `the-page-script-writes-no-markup.test.ts` fails on any other
 * way into the page.
 */

/** One element of the page. */
export interface El {
  textContent: string | null;
  hidden: boolean;
  /** The value of a control. */
  value?: string;
  /** Whether a `<details>` is open. */
  open?: boolean;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  appendChild(child: El): void;
  addEventListener(type: string, listener: () => void): void;
  querySelectorAll(selector: string): ArrayLike<El>;
}

/** The document: elements by id, by selector, and new ones. */
export interface Doc {
  getElementById(id: string): El | null;
  createElement(tag: string): El;
  querySelectorAll(selector: string): ArrayLike<El>;
}
