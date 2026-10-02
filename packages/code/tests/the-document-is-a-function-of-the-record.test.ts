/**
 * THE DOCUMENT IS A PURE FUNCTION OF THE RECORD — the property `mnema brief` is sold on,
 * guarded at the PATH and not only at the value.
 *
 * WHAT IS PUBLISHED. `mnema brief --help` says *"The output holds no clock, no session and
 * no path, so the same record always prints the same bytes and a difference is a difference
 * in the record"*, and the file the verb prints says the same thing in its own words:
 * `mnema brief | diff - AGENTS.md` is the ONLY thing that can tell a stale copy from a live
 * one, and it means that only if the bytes move when the record moves and at no other time.
 * Three doc-comments state it — `presentation/brief.ts`, `context/src/context/brief.ts`, and
 * the wiring's help above.
 *
 * AND NOTHING GUARDED IT. Measured by mutation, in the delivery that added this file: the
 * composition was made to call `existsSync` on a path of this machine, and the whole suite
 * came back GREEN — 4692 of 4692. The same mutation with the read's value reaching the
 * ANSWER went red in eight places. So the value was guarded and the path was not, and the
 * gap between those two is exactly where the defect lives: a read whose result is the same
 * on every machine the fixtures run on — `existsSync('AGENTS.md')`, a `cwd`, an env var —
 * passes every case there is and moves the bytes on somebody else's checkout. The failure
 * would not be a red test; it would be `diff` reporting a difference that is not the
 * record's, which is the one signal this whole document rests on.
 *
 * THE FIRST GUARD WAS THE IMPORT, AND THE IMPORT IS NOT THE ONLY DOOR. That is the premise
 * this file was written on — *"a layer reaches the world through a module of the runtime, so
 * match the specifier and the door is shut"* — and it is FALSE, measured the same way it was
 * arrived at: with `process.cwd()` and `Date.now()` planted in `context/src/context/brief.ts`,
 * the suite came back 4698 of 4698 GREEN and `pnpm lint` green with it. `process`, `Date`,
 * `Math.random` and `globalThis` are already in scope; a clock needs no `import` at all, and
 * the very doc-comment above names *"a `cwd`"* as a failure this net catches. It did not.
 *
 * SO THE NET IS TWO NETS, one per door, and the property is the promise rather than either
 * spelling of it. The import net matches the SPECIFIER on the raw source; the global net
 * matches the identifier on the source with comments, strings and patterns blanked, because
 * a global is an identifier in code and `codeOnly` is what tells one from a mention of one.
 * Neither is clever: what is banned is the whole global, with the two members of `Date` that
 * read no clock named as what they are. That list is a fact of the LANGUAGE — `Date.parse`
 * and `Date.UTC` are string-and-number functions — rather than a list of what this
 * repository happens to call today, which is the kind of list that rots.
 *
 * AND A THIRD DOOR, WHICH THIS FILE DECLARED OPEN UNTIL IT WAS CLOSED: an import of somebody
 * else's function that does the reaching. `resolveTrees` walks the filesystem and
 * `systemClock` reads a clock, both are on `@mnema/core`'s surface, and neither net above sees
 * a layer that imports one — the specifier is a package of the workspace and the call names no
 * global. This file said closing it was "a different guard — which exports of `core` touch the
 * world, derived from `core`'s own source rather than from a list that rots". The third net is
 * that guard, and it reaches further than `core` because the door does: every value a layer
 * imports from outside its own root is followed to its declaration, through every re-export,
 * into `@mnema/chain`, into modules of this package outside `presentation/`, and into the
 * published source of a package from outside; and that declaration is judged by the two
 * readings above, applied to it and to everything it names. No export is named in this file.
 *
 * THE PRINTER IS IN IT TOO, for the same reason at the other end: `presentation/brief.ts`
 * composes the bytes, and a printer that read an environment variable would move them just
 * as far. The adapter between them is deliberately NOT in this net — it is where the disk
 * is supposed to be touched, and a guard that accused it would be a guard somebody has to
 * write an exception into within a week.
 *
 * ITS SIBLING IS `presentation/parts.test.ts`, AND THEY ASK DIFFERENT QUESTIONS. That one
 * bans `process.env`, `process.stdout`, `isTTY`, `NO_COLOR` and a colour library in
 * `code/src/presentation/` — a ban on asking WHERE THE OUTPUT IS GOING, over the raw source,
 * one directory deep. This one bans reaching the machine at all, over `codeOnly`, across a
 * whole package and recursively. They overlap on `process` in one directory and neither
 * subsumes the other, and the reason they are two is that they would be reconciled by
 * deleting a question: a renderer may not paint, and a derivation may not read a clock, and
 * the second says nothing about colour.
 */

import { readFileSync, realpathSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codeOnly, sourceFiles } from './support/reading-source.js';

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The layers that may hold NOTHING of this machine: the derivation package whole, and the
 * module that turns its answer into the document's bytes.
 *
 * The `code` side is one FILE and the `context` side is a package, and the asymmetry is the
 * point rather than an oversight. Everything in `context` answers over caches a caller
 * opened, so the rule is the package's; in `code` the disk is what the package is FOR, and
 * only the printer of this one document owes the property.
 */
const PURE: readonly { readonly what: string; readonly root: string }[] = [
  { what: '@mnema/context', root: join(PACKAGES, 'context', 'src') },
  { what: 'the document’s printer', root: join(PACKAGES, 'code', 'src', 'presentation') },
];

/**
 * A module of the runtime, named in an import — what a layer reaches the machine THROUGH.
 *
 * It matches the SPECIFIER rather than a function, because the specifier is the door: a
 * scanner looking for `existsSync` would be a list of names that grows, and the one after
 * the list is the one that gets through. Both spellings are matched — `node:fs` is the form
 * this repository writes and bare `fs` is the form somebody pasting from elsewhere writes.
 *
 * IT READS THE RAW SOURCE, AND THAT IS THE ONE PLACE THIS FILE DIFFERS FROM ITS SIBLINGS.
 * Every other structural guard here scans `codeOnly`, which blanks comments AND STRING
 * LITERALS — and a specifier IS a string literal, so the collapsed form of every import in
 * this repository is `import { x } from ''`. The first version of this scanner did that and
 * its own probe caught it: a net over `codeOnly` cannot see an import at all. So the match
 * is anchored to the executable form instead — `import` at the START of a line, which is
 * where this repository writes every one of them and where a `*`-prefixed doc-comment line
 * can never be. It is the same anchoring `DECLARES_MODEL_CHANNEL` uses, for the same reason.
 */
const REACHES_THE_MACHINE = new RegExp(
  String.raw`^import\s(?:[^;]*?\bfrom\s+)?['"]${runtimeModules()}['"]`,
  'm',
);

/**
 * The same modules of the runtime, as a whole specifier — what the INDIRECT net below counts
 * as a door when it finds one at the far end of an import. Both patterns are built from
 * {@link runtimeModules}, so the two nets cannot come to disagree about which modules of the
 * runtime reach this machine.
 */
const A_MODULE_OF_THE_RUNTIME = new RegExp(`^${runtimeModules()}$`);

/** The modules of the runtime that reach this machine, both spellings — one list, two nets. */
function runtimeModules(): string {
  return String.raw`(?:node:)?(?:fs|path|os|process|child_process|crypto|url|tty|dns|net|http|https)(?:\/[a-z]+)?`;
}

/**
 * A global of this machine, reached with NO import at all — the other door.
 *
 * It matches a USE rather than a name, which is what keeps a type annotation out of it:
 * `Date` alone is `const at: Date`, while `new Date`, `Date(`, `Date.now` and `Math.round`
 * are the machine being asked something. `process`, `globalThis`, `performance`,
 * `__dirname` and `__filename` are values wherever they appear, so the bare identifier is
 * the whole match; `require(` is matched at the call because a `require` in these packages
 * could only be one.
 *
 * IT MUST RUN OVER `codeOnly`. Every one of these names appears in the prose of this
 * repository — `process` alone is in nine doc-comments of the two roots — and a net over
 * raw source would accuse every one of them. Blanking comments, strings and patterns is
 * what turns "the word appears" into "the code does it".
 */
const A_GLOBAL_OF_THIS_MACHINE =
  /\b(?:new\s+Date\b|Date\s*(?:\.\s*[A-Za-z_$][\w$]*|\()|Math\s*\.\s*[A-Za-z_$][\w$]*|process\b|globalThis\b|performance\b|require\s*\(|__dirname\b|__filename\b)/g;

/**
 * The members of a banned global that read NOTHING — a fact of the language rather than an
 * allowance for a call site.
 *
 * `Date.parse` and `Date.UTC` take a string or numbers and return a number; `Math` is pure
 * whole except for `Math.random`. Everything else on those two objects reads the clock or
 * the entropy pool, and everything on the other globals reads the machine. A member that is
 * not named here goes red on the day it is written — including one nobody has thought of —
 * which is the opposite of a list of exceptions that grows by one each time.
 */
const READ_NOTHING = new Set(['Date.parse', 'Date.UTC']);

/** Whether one matched use is the machine being read. */
function readsThisMachine(use: string): boolean {
  const said = use.replace(/\s+/g, '').replace(/^new/, '');
  if (said.startsWith('Math.')) return said === 'Math.random';
  if (said.startsWith('Date')) return !READ_NOTHING.has(said);
  return true;
}

/** Every use of a machine global in one file's code, prose and literals excluded. */
function globalsOf(source: string): string[] {
  return (codeOnly(source).match(A_GLOBAL_OF_THIS_MACHINE) ?? []).filter(readsThisMachine);
}

/** Every file under `root` whose source reaches the machine, by repo-relative path. */
function reachTheMachine(root: string): string[] {
  return sourceFiles(root)
    .filter((path) => {
      const source = readFileSync(path, 'utf-8');
      return REACHES_THE_MACHINE.test(source) || globalsOf(source).length > 0;
    })
    .map((path) =>
      path
        .slice(PACKAGES.length + 1)
        .split(sep)
        .join('/'),
    )
    .sort();
}

// ---------------------------------------------------------------------------
// The third door: what an import from outside the layer brings in with it
// ---------------------------------------------------------------------------

/** A top-level declaration of one module: its name, what it is, and its code. */
interface Declaration {
  readonly file: string;
  readonly name: string;
  readonly kind: string;
  /** The declaration's lines over `codeOnly`: no comment, no literal, the code alone. */
  body: string;
}

/** One module, read as far as this net needs it. */
interface Module {
  readonly declarations: ReadonlyMap<string, Declaration>;
  /** Every name bound by a VALUE import, to where it comes from. `import type` binds none. */
  readonly imports: ReadonlyMap<string, { readonly spec: string; readonly name: string }>;
  /** `export { a as b } from '…'`, by the name it goes out under. */
  readonly reexports: ReadonlyMap<string, { readonly spec: string; readonly name: string }>;
  /** `export * from '…'`. */
  readonly stars: readonly string[];
}

/**
 * Where an exported name ends: a declaration this net can read, a door out of what it can read,
 * a module of the runtime that reaches nothing, or nowhere — which is a ruler that broke.
 */
type Destination =
  | { readonly declaration: Declaration }
  | { readonly door: string }
  | { readonly builtin: string }
  | { readonly unread: string };

/**
 * The bindings of one import or export clause: `{ a, b as c, type T }`, `* as ns`, `d`.
 * A member marked `type` binds no value and is left out, as the compiler leaves it out.
 */
function bindingsOf(clause: string): { readonly local: string; readonly name: string }[] {
  const found: { local: string; name: string }[] = [];
  const braced = /\{([^}]*)\}/.exec(clause);
  for (const part of (braced?.[1] ?? '').split(',').map((one) => one.trim())) {
    if (part === '' || part.startsWith('type ')) continue;
    const [name, local] = part.split(/\s+as\s+/) as [string, string | undefined];
    found.push({ name, local: local ?? name });
  }
  const namespace = /\*\s+as\s+([\w$]+)/.exec(clause);
  if (namespace !== null) found.push({ name: '*', local: namespace[1] as string });
  const byDefault = /^([\w$]+)\s*(?:,|$)/.exec(clause.trim());
  if (byDefault !== null) found.push({ name: 'default', local: byDefault[1] as string });
  return found;
}

/**
 * A top-level declaration's first line. Anchored at column 0, which is where this repository
 * writes every one of them and where no statement inside a body ever starts.
 */
const A_DECLARATION =
  /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;

/** Kinds that carry no code: a type reaches nothing, and a name used as one reaches nothing. */
const NO_CODE = new Set(['interface', 'type']);

/**
 * One module of the workspace, read from its text.
 *
 * Imports and re-exports are read from the RAW source, anchored at the start of a line, for the
 * reason {@link REACHES_THE_MACHINE} gives: a specifier is a literal, and `codeOnly` blanks it.
 * Declarations are read over `codeOnly`, so a name in a comment or a string is not a use of it;
 * each runs from its first line to the next top-level declaration or import.
 */
function moduleOf(file: string, source: string): Module {
  const declarations = new Map<string, Declaration>();
  const imports = new Map<string, { spec: string; name: string }>();
  const reexports = new Map<string, { spec: string; name: string }>();
  const stars: string[] = [];
  for (const match of source.matchAll(/^import\s+(type\s+)?([^;]*?)\s+from\s+'([^']+)'/gm)) {
    if (match[1] !== undefined) continue;
    for (const { local, name } of bindingsOf(match[2] as string)) {
      imports.set(local, { spec: match[3] as string, name });
    }
  }
  for (const match of source.matchAll(/^export\s+(type\s+)?\{([^}]*)\}\s*from\s+'([^']+)'/gm)) {
    if (match[1] !== undefined) continue;
    for (const { local, name } of bindingsOf(`{${match[2]}}`)) {
      reexports.set(local, { spec: match[3] as string, name });
    }
  }
  for (const match of source.matchAll(/^export\s+\*\s+from\s+'([^']+)'/gm)) {
    stars.push(match[1] as string);
  }
  let current: Declaration | undefined;
  let byDefault: string | undefined;
  for (const line of codeOnly(source).split('\n')) {
    const declared = A_DECLARATION.exec(line);
    const named = /^export\s+default\s+([A-Za-z_$][\w$]*)\s*;/.exec(line);
    if (declared !== null) {
      current = { file, name: declared[2] as string, kind: declared[1] as string, body: '' };
      declarations.set(current.name, current);
      if (/^export\s+default\b/.test(line)) declarations.set('default', current);
    } else if (named !== null) {
      byDefault = named[1] as string;
      current = undefined;
    } else if (/^export\s+default\b/.test(line)) {
      // An anonymous default — a function, a class or an expression — is a declaration too.
      current = { file, name: 'default', kind: 'const', body: '' };
      declarations.set('default', current);
    } else if (/^(?:import\b|export\s*[{*])/.test(line)) {
      current = undefined;
    }
    if (current !== undefined) current.body += `${line}\n`;
  }
  // `export default name;` goes out under a name declared or imported above it.
  if (byDefault !== undefined) {
    const local = declarations.get(byDefault);
    const imported = imports.get(byDefault);
    if (local !== undefined) declarations.set('default', local);
    else if (imported !== undefined) reexports.set('default', imported);
  }
  return { declarations, imports, reexports, stars };
}

/**
 * THE INDIRECT NET: which declarations reach this machine, directly or through anything they
 * name, read from the source of everything a layer's imports lead to.
 *
 * WHAT REACHES, DIRECTLY. A declaration whose code uses a global of this machine (the second
 * net's reading, {@link globalsOf}), or names a binding imported from a DOOR: a module of the
 * runtime on the first net's list ({@link A_MODULE_OF_THE_RUNTIME}), or a package this net
 * cannot find and read. A module of the runtime OFF that list reaches nothing here, exactly as
 * it reaches nothing to the first net.
 *
 * AND THROUGH WHAT IT NAMES. A declaration that names another declaration — of its own module,
 * or one it imports, followed through every re-export to where it is declared — reaches
 * whatever that one reaches. The answer is a fixed point over every declaration found, so a
 * cycle of calls cannot hide a door behind the order it was walked in.
 *
 * WHERE A SPECIFIER LEADS, and nothing about it is listed here. `@mnema/<name>[/<subpath>]` is
 * the `exports` entry of the package with that name, taken from `dist/` back to `src/`. Any
 * other package is found the way Node finds it — `node_modules/<name>`, walking up from the
 * REAL path of the file that imports it, because pnpm puts a package's own dependencies beside
 * it in the store and not beside the workspace — and its published source is read like ours.
 * A package it cannot find is a door: nothing here can clear what it cannot read.
 *
 * `read` and `real` are seams for this net's own cases, which hand it a workspace of a few
 * lines; the suite hands it the disk.
 */
function reachOf(
  read: (file: string) => string | undefined,
  root: string,
  real: (path: string) => string = (path) => path,
) {
  const modules = new Map<string, Module>();
  const moduleAt = (file: string): Module => {
    const known = modules.get(file);
    if (known !== undefined) return known;
    const source = read(file);
    if (source === undefined) throw new Error(`RULER BROKEN: no module at ${file}`);
    const found = moduleOf(file, source);
    modules.set(file, found);
    return found;
  };

  /** The file an `exports` map (or a `main`) points at for one subpath, or undefined. */
  const entryIn = (manifest: string, subpath: string): string | undefined => {
    const { exports, main } = JSON.parse(manifest) as { exports?: unknown; main?: string };
    const pick = (target: unknown): string | undefined => {
      if (typeof target === 'string') return target;
      if (target === null || typeof target !== 'object') return undefined;
      const conditions = target as Record<string, unknown>;
      for (const condition of ['import', 'node', 'default']) {
        const chosen = pick(conditions[condition]);
        if (chosen !== undefined) return chosen;
      }
      return undefined;
    };
    if (exports === undefined) return subpath === '.' ? (main ?? 'index.js') : undefined;
    const keyed =
      typeof exports === 'object' &&
      exports !== null &&
      Object.keys(exports).some((key) => key.startsWith('.'));
    return pick(keyed ? (exports as Record<string, unknown>)[subpath] : exports);
  };

  /** The file a specifier names from `from`, or undefined when there is none to read. */
  const fileOf = (from: string, spec: string): string | undefined => {
    if (spec.startsWith('.')) {
      const base = join(dirname(from), spec);
      const bare = base.replace(/\.m?js$/, '');
      for (const candidate of [
        `${bare}.ts`,
        join(bare, 'index.ts'),
        base,
        `${bare}.js`,
        join(bare, 'index.js'),
      ]) {
        if (read(candidate) !== undefined) return candidate;
      }
      throw new Error(`RULER BROKEN: ${spec} from ${from} names no module`);
    }
    const [, name, subpath] = /^((?:@[^/]+\/)?[^/]+)(\/.+)?$/.exec(spec) ?? [];
    if (name === undefined) return undefined;
    if (name.startsWith('@mnema/')) {
      for (const dir of ['chain', 'core', 'context', 'code']) {
        const manifest = read(join(root, dir, 'package.json'));
        if (manifest === undefined || JSON.parse(manifest).name !== name) continue;
        const built = entryIn(manifest, `.${subpath ?? ''}`);
        if (built === undefined) return undefined;
        return join(root, dir, built.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts'));
      }
      return undefined;
    }
    for (let at = dirname(real(from)); ; at = dirname(at)) {
      const manifest = read(join(at, 'node_modules', name, 'package.json'));
      if (manifest !== undefined) {
        const target = entryIn(manifest, `.${subpath ?? ''}`);
        return target === undefined
          ? undefined
          : join(real(join(at, 'node_modules', name)), target);
      }
      if (dirname(at) === at) return undefined;
    }
  };

  const exported = (file: string, name: string, seen: Set<string>): Destination => {
    const key = `${file}#${name}`;
    if (seen.has(key)) return { unread: key };
    seen.add(key);
    const module = moduleAt(file);
    const declaration = module.declarations.get(name);
    if (declaration !== undefined) return { declaration };
    const onward = module.reexports.get(name) ?? module.imports.get(name);
    if (onward !== undefined) return destinationOf(file, onward.spec, onward.name, seen);
    for (const star of module.stars) {
      const found = destinationOf(file, star, name, seen);
      if (!('unread' in found)) return found;
    }
    return { unread: key };
  };

  const destinationOf = (
    from: string,
    spec: string,
    name: string,
    seen = new Set<string>(),
  ): Destination => {
    if (A_MODULE_OF_THE_RUNTIME.test(spec)) return { door: spec };
    if (spec.startsWith('node:') || builtinModules.includes(spec)) return { builtin: spec };
    const file = fileOf(from, spec);
    if (file === undefined) return { door: spec };
    const found = exported(file, name, seen);
    // Inside the workspace a name that leads nowhere is a ruler that broke; in a package from
    // outside it is source this reader cannot read (CommonJS declares nothing it sees), and what
    // cannot be read cannot be cleared.
    return 'unread' in found && file.includes(`${sep}node_modules${sep}`) ? { door: spec } : found;
  };

  /** Why each declaration reaches the machine, one step at a time; absent when it does not. */
  const why = new Map<Declaration, string>();
  const edges = new Map<Declaration, { to: Declaration; via: string }[]>();
  /** Names a declaration used that led nowhere this net can read — a ruler that broke. */
  const unread: string[] = [];

  const mentions = (body: string, name: string): boolean =>
    new RegExp(`(?<![.\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(body);

  const visit = (start: Declaration): void => {
    const pending = [start];
    while (pending.length > 0) {
      const declaration = pending.pop() as Declaration;
      if (edges.has(declaration) || NO_CODE.has(declaration.kind)) continue;
      const out: { to: Declaration; via: string }[] = [];
      edges.set(declaration, out);
      const uses = globalsOf(declaration.body);
      if (uses.length > 0) why.set(declaration, `uses ${uses[0]}`);
      const module = moduleAt(declaration.file);
      for (const [local, from] of module.imports) {
        if (!mentions(declaration.body, local)) continue;
        const found = destinationOf(declaration.file, from.spec, from.name);
        if ('door' in found) {
          if (!why.has(declaration)) why.set(declaration, `imports ${local} from ${found.door}`);
        } else if ('declaration' in found) {
          out.push({ to: found.declaration, via: local });
          pending.push(found.declaration);
        } else if ('unread' in found) {
          unread.push(`${declaration.name} uses ${local}, and ${found.unread} does not declare it`);
        }
      }
      for (const [name, other] of module.declarations) {
        if (other === declaration || NO_CODE.has(other.kind)) continue;
        if (!mentions(declaration.body, name)) continue;
        out.push({ to: other, via: name });
        pending.push(other);
      }
    }
    let moved = true;
    while (moved) {
      moved = false;
      for (const [declaration, out] of edges) {
        if (why.has(declaration)) continue;
        const through = out.find((edge) => why.has(edge.to));
        if (through === undefined) continue;
        why.set(declaration, `calls ${through.via}`);
        moved = true;
      }
    }
  };

  /** The chain of reasons from `declaration` to the door it reaches, or undefined. */
  const reason = (declaration: Declaration): string | undefined => {
    const steps: string[] = [];
    const walked = new Set<Declaration>();
    for (let at: Declaration | undefined = declaration; at !== undefined && !walked.has(at); ) {
      walked.add(at);
      const step = why.get(at);
      if (step === undefined) break;
      steps.push(`${at.name} ${step}`);
      const via = step.startsWith('calls ') ? step.slice('calls '.length) : undefined;
      at = via === undefined ? undefined : edges.get(at)?.find((edge) => edge.via === via)?.to;
    }
    return steps.length === 0 ? undefined : steps.join(' → ');
  };

  /** What `name`, imported by `from` through `spec`, reaches — and by what path — or undefined. */
  const reaches = (from: string, spec: string, name: string): string | undefined => {
    const found = destinationOf(from, spec, name);
    if ('door' in found) return `${name} is ${found.door} itself`;
    if ('builtin' in found) return undefined;
    if ('unread' in found) {
      unread.push(`${name} from ${spec}: ${found.unread} does not declare it`);
      return undefined;
    }
    visit(found.declaration);
    return reason(found.declaration);
  };

  return { reaches, fileOf, unread };
}

/** The disk, as {@link reachOf} reads it: a file's text, or undefined when there is none. */
function fromDisk(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf-8');
  } catch {
    return undefined;
  }
}

/** A path with its links resolved, as {@link reachOf} walks up from it; itself when absent. */
function realOnDisk(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** One value a layer imports from a module outside its own root. */
interface Imported {
  readonly layer: string;
  readonly file: string;
  readonly name: string;
  readonly spec: string;
}

/**
 * Every value a pure layer imports from OUTSIDE ITS OWN ROOT: another package of the workspace,
 * a module of the same package elsewhere (`presentation/` importing `../one-line.js`), or a door.
 * What a layer imports from inside itself is already read by the two nets above, file by file.
 */
function importedFromOutside(net: ReturnType<typeof reachOf>): Imported[] {
  const found: Imported[] = [];
  for (const layer of PURE) {
    for (const file of sourceFiles(layer.root)) {
      const module = moduleOf(file, readFileSync(file, 'utf-8'));
      for (const [local, from] of module.imports) {
        const where = from.spec.startsWith('.') ? net.fileOf(file, from.spec) : undefined;
        if (where?.startsWith(layer.root + sep) === true) continue;
        // A namespace names no export, so there is nothing to follow; said, not skipped.
        if (from.name === '*' && !A_MODULE_OF_THE_RUNTIME.test(from.spec)) {
          net.unread.push(`${file}: \`* as ${local}\` from ${from.spec} is not read by this net`);
          continue;
        }
        found.push({ layer: layer.what, file, name: from.name, spec: from.spec });
      }
    }
  }
  return found;
}

/** Every import of a pure layer that reaches the machine, with the path it takes. */
function reachedThroughAnImport(): { accused: string[]; read: number; unread: string[] } {
  const net = reachOf(fromDisk, PACKAGES, realOnDisk);
  const imported = importedFromOutside(net);
  const accused: string[] = [];
  for (const { layer, file, name, spec } of imported) {
    // The first net already rules on an import of a module of the runtime; this one adds the
    // imports it cannot see through.
    if (A_MODULE_OF_THE_RUNTIME.test(spec)) continue;
    const path = net.reaches(file, spec, name);
    if (path !== undefined) {
      accused.push(
        `${layer}: ${file.slice(PACKAGES.length + 1)} imports ${name} from ${spec} — ${path}`,
      );
    }
  }
  return { accused, read: imported.length, unread: net.unread };
}

describe('the bytes of the document move when the record moves, and at no other time', () => {
  it('lets no layer of the document reach a clock or a filesystem at all', () => {
    for (const layer of PURE) {
      expect(reachTheMachine(layer.root), `${layer.what} reaches this machine`).toEqual([]);
    }
  });

  it('read enough source to mean something, or the two sweeps above are empty', () => {
    // The scanner's own non-vacuity: a root that stopped resolving would answer `[]` for
    // the best possible reason and the case above would pass over nothing at all.
    const walked = PURE.flatMap((layer) => sourceFiles(layer.root));
    expect(walked.length).toBeGreaterThan(30);
    expect(walked.map((path) => path.split(sep).join('/'))).toContain(
      join(PACKAGES, 'context', 'src', 'context', 'brief.ts').split(sep).join('/'),
    );
    expect(walked.map((path) => path.split(sep).join('/'))).toContain(
      join(PACKAGES, 'code', 'src', 'presentation', 'brief.ts').split(sep).join('/'),
    );
  });

  it('accuses a layer that reached the machine — on input of its own', () => {
    // THE MECHANISM'S TEETH. With the tree honest the case above says only "nothing was
    // accused", so it has never shown this net can go red. The probe is the mutation that
    // found the hole: the composition calling `existsSync`, which left 4692 of 4692 green.
    const probe = "import { existsSync } from 'node:fs';\nconst a = existsSync('/etc');";
    expect(REACHES_THE_MACHINE.test(probe)).toBe(true);
    // Both spellings, since somebody pasting from elsewhere writes the bare one, and the
    // side-effect form, which names no binding to grep for.
    expect(REACHES_THE_MACHINE.test("import { join } from 'path';")).toBe(true);
    expect(REACHES_THE_MACHINE.test("import 'node:process';")).toBe(true);
    // AND IT IS NOT A CONSTANT. The imports these layers really do make come through clean,
    // and a MENTION of one in prose is not a reach — which is what the line anchor buys,
    // since a doc-comment's lines begin with a star.
    expect(REACHES_THE_MACHINE.test("import type { Scope } from '@mnema/core';")).toBe(false);
    expect(REACHES_THE_MACHINE.test(" * it must never import from 'node:fs'.")).toBe(false);
    expect(REACHES_THE_MACHINE.test("const said = readFileSync('x');")).toBe(false);
  });

  it('accuses the global that needs no import — the mutation that went green', () => {
    // THE SECOND NET'S TEETH, and the input is the mutation that falsified this file's own
    // premise: both of these, planted in `context/src/context/brief.ts`, left the suite at
    // 4698 of 4698 green while the import net was the only one here.
    expect(globalsOf('const root = process.cwd();')).toEqual(['process']);
    expect(globalsOf('const at = Date.now();')).toEqual(['Date.now']);
    // The rest of the door, each on the form somebody would write.
    expect(globalsOf('const at = new Date();')).toEqual(['new Date']);
    expect(globalsOf('const pick = Math.random();')).toEqual(['Math.random']);
    expect(globalsOf('const g = globalThis.crypto;')).toEqual(['globalThis']);
    expect(globalsOf('const t = performance.now();')).toEqual(['performance']);
    expect(globalsOf("const x = require('node:fs');")).toEqual(['require(']);
    expect(globalsOf('const here = __dirname;')).toEqual(['__dirname']);
  });

  it('leaves the pure members and the prose alone, or it is a net nobody can live with', () => {
    // THE OTHER HALF OF THE SECOND NET. A guard that accused arithmetic and doc-comments
    // would be turned off within a week, and these are the exact uses the two roots make
    // today: three `Date.parse` and seven `Math.<something>`, none of which reads anything.
    expect(globalsOf('const at = Date.parse(envelope.at);')).toEqual([]);
    expect(globalsOf('const at = Date.UTC(2026, 0, 1);')).toEqual([]);
    expect(globalsOf('const w = Math.max(a, b) - Math.floor(c);')).toEqual([]);
    // A type annotation is not a use, and neither is a word in prose or in a string.
    expect(globalsOf('function since(at: Date): number { return 1; }')).toEqual([]);
    expect(globalsOf("const said = 'the process reads Date.now()';")).toEqual([]);
    // The prose cases carry the comment's OPENING, and that is the probe's own finding
    // rather than decoration: `codeOnly` blanks a block from `/*`, so a bare ` * …` line
    // handed to it on its own reads as code and both words are accused. Real source always
    // carries the opening; a probe that dropped it would be testing a file that cannot
    // exist, and this one said so by going red.
    expect(
      globalsOf('/**\n * a command-line process opens them, and Date.now is read.\n */'),
    ).toEqual([]);
    expect(globalsOf('// process.cwd() is banned in this layer, and so is Date.now().')).toEqual(
      [],
    );
    // And a name that merely starts with a banned one is a different name.
    expect(globalsOf('const processed = performanceBudget;')).toEqual([]);
  });

  it('leaves the ADAPTER out, and says so by naming what it does', () => {
    // The other half of a total rule: the disk is touched, and it is touched where the
    // product says it is. A net that accused these would be a net somebody writes an
    // exception into, and an exception is where the next hole goes.
    const adapters = reachTheMachine(join(PACKAGES, 'code', 'src'));
    expect(adapters).toContain('code/src/commands/status.ts');
    expect(adapters).toContain('code/src/outside-the-record.ts');
    // And no file of the printer is among them, which is the case above read from the
    // other end — the same sweep, over a root that holds both.
    expect(adapters.filter((path) => path.startsWith('code/src/presentation/'))).toEqual([]);
  });

  it('lets no layer import what reaches the machine from another module', () => {
    // THE THIRD DOOR, AND IT WAS DECLARED RATHER THAN CLOSED UNTIL THIS CASE. The one this
    // replaces read: "what remains open is the INDIRECT one: a layer can still reach a disk by
    // importing a function of `@mnema/core` that does. `resolveTrees` walks the filesystem and
    // `systemClock` reads a clock", and closing it was "a different guard — which exports of
    // `core` touch the world, derived from `core`'s own source rather than from a list that
    // rots". That is {@link reachOf}: nothing in this file names an export, and the answer for
    // each comes off the workspace's source. It reaches past `core` because the door does:
    // the printer imports `@mnema/chain`, `@mnema/context` and four modules of its own package
    // from outside `presentation/`, and each is the same door with another name.
    const { accused, unread } = reachedThroughAnImport();
    expect(unread, 'RULER BROKEN: an import led somewhere this net cannot read').toEqual([]);
    expect(accused).toEqual([]);
  });

  it('read every import from outside the layers, and knows what core touches without a list', () => {
    // NON-VACUITY, from both ends. A net that resolved nothing would accuse nothing, so the
    // count of what it read is pinned under what is there; and the two names the case above
    // replaced as a DECLARATION are asserted here as a DERIVATION — found reaching the machine,
    // with the path, while four the layers really import are found reaching nothing.
    const { read } = reachedThroughAnImport();
    expect(read).toBeGreaterThanOrEqual(40);
    const net = reachOf(fromDisk, PACKAGES, realOnDisk);
    const printer = join(PACKAGES, 'code', 'src', 'presentation', 'state.ts');
    expect(net.reaches(printer, '@mnema/core', 'resolveTrees')).toMatch(/^resolveTrees calls /);
    expect(net.reaches(printer, '@mnema/core', 'resolveTrees')).toMatch(/imports \w+ from node:/);
    expect(net.reaches(printer, '@mnema/core', 'systemClock')).toBe('systemClock uses new Date');
    expect(net.reaches(printer, '@mnema/core', 'openDatabase')).toMatch(/from node:fs/);
    expect(net.reaches(printer, '@mnema/core/write', 'openTreeForWriting')).toBeDefined();
    for (const pure of ['isTaskState', 'taskDisposition', 'newestFirst', 'detectSecrets']) {
      expect(net.reaches(printer, '@mnema/core', pure), pure).toBeUndefined();
    }
    expect(net.unread).toEqual([]);
  });

  it('follows a name through its re-exports and its calls, on a workspace of its own', () => {
    // THE INSTRUMENT'S OWN CASE. Over the real tree the two cases above only ever say "nothing
    // is accused", and that has never shown this net can tell a door from a function.
    const files: Record<string, string> = {
      '/w/core/package.json': JSON.stringify({
        name: '@mnema/core',
        exports: { '.': { default: './dist/index.js' } },
      }),
      '/w/core/src/index.ts': "export { far, near, pure } from './a.js';\nexport * from './b.js';",
      '/w/core/src/a.ts': [
        "import { readFileSync } from 'node:fs';",
        "import { format } from 'node:util';",
        "import type { Shape } from './b.js';",
        'function door(): string {',
        "  return readFileSync('x', 'utf-8');",
        '}',
        'export function near(): string {',
        '  return door();',
        '}',
        'export function far(): string {',
        '  return near();',
        '}',
        'export function pure(at: Shape): string {',
        '  // door() and readFileSync are only mentioned here',
        "  const said = 'door()';",
        '  return format(said, at.door, at);',
        '}',
      ].join('\n'),
      '/w/core/src/b.ts': [
        'export interface Shape { readonly door: string }',
        'export const late = (): number => Date.now();',
      ].join('\n'),
      // Packages from outside the workspace, found the way Node finds them and read.
      '/w/node_modules/measures/package.json': JSON.stringify({
        exports: { types: './index.d.ts', default: './index.js' },
      }),
      '/w/node_modules/measures/index.js': [
        "import { part } from './part.js';",
        'export default function width(s) {',
        '  return part(s) * 2;',
        '}',
      ].join('\n'),
      '/w/node_modules/measures/part.js': 'export const part = (s) => s.length;',
      '/w/node_modules/colours/package.json': JSON.stringify({ main: 'main.js' }),
      '/w/node_modules/colours/main.js': [
        'const level = () => (process.env.NO_COLOR ? 0 : 1);',
        'export default level;',
      ].join('\n'),
      '/w/node_modules/common/package.json': JSON.stringify({ main: 'index.js' }),
      '/w/node_modules/common/index.js': 'module.exports = function open() {};',
    };
    const net = reachOf((file) => files[file], '/w');
    const from = '/w/code/src/presentation/x.ts';
    // A call chain, followed through a re-export, to the door and with the path.
    expect(net.reaches(from, '@mnema/core', 'far')).toBe(
      'far calls near → near calls door → door imports readFileSync from node:fs',
    );
    // A global with no import at all, through `export *`.
    expect(net.reaches(from, '@mnema/core', 'late')).toBe('late uses Date.now');
    // And what it must NOT accuse: a mention in a comment or a string, a property that shares
    // a name, a type, and a module of the runtime off the first net's list.
    expect(net.reaches(from, '@mnema/core', 'pure')).toBeUndefined();
    // A package from outside is read like ours: one that only counts clears, one that asks the
    // environment is accused, and one this reader cannot read — nowhere to be found, or
    // CommonJS, which declares nothing it sees — is a door, because nothing here can clear it.
    expect(net.reaches(from, 'measures', 'default')).toBeUndefined();
    expect(net.reaches(from, 'colours', 'default')).toBe('level uses process');
    expect(net.reaches(from, 'common', 'default')).toBe('default is common itself');
    expect(net.reaches(from, 'nowhere', 'default')).toBe('default is nowhere itself');
    // And an export of the WORKSPACE that is not there says the ruler broke instead of passing.
    expect(net.unread).toEqual([]);
    expect(net.reaches(from, '@mnema/core', 'missing')).toBeUndefined();
    expect(net.unread).toEqual([
      'missing from @mnema/core: /w/core/src/index.ts#missing does not declare it',
    ]);
  });

  it('says what it does NOT cover, so the promise is not wider than the net', () => {
    // THE LIMITS OF THE THIRD NET, each one a way it can be wrong and which way:
    //   - A DECLARATION IS ONE UNIT. A class with one method that reads the disk reaches the
    //     machine as a whole, and so does every function that names it — even as a type in an
    //     annotation, because a name is a use wherever it stands as an identifier. So is a
    //     local that shadows a top-level name. All three ACCUSE; none clears.
    //   - A VALUE THAT ARRIVES AT RUNTIME is not followed: a callback, or a handle a caller
    //     opened — `context` answers over caches somebody else opened, by design, and a method
    //     called on one is invisible here.
    //   - `import()` at runtime, `require` (the second net's), `export default` and a
    //     destructured declaration are not read. The last two cannot slip through: a name that
    //     resolves to nothing is `RULER BROKEN` rather than pure.
    //   - A module of the runtime off the first net's list reaches nothing to this net either;
    //     one list, read by both. And a module ON the list counts whole, as it does to the first
    //     net: `join` from `node:path` or `createHash` from `node:crypto` reaches the machine
    //     here, so a helper that only joins strings or hashes them ACCUSES — `resolveTrees` is
    //     found through a `join` before any read of the disk.
    //   - A package from outside the workspace is read as far as it can be: the entry its
    //     `exports` map or `main` names, as ESM, on this disk. One it cannot find, or cannot
    //     read — CommonJS declares nothing it sees — is a door, and ACCUSES.
    // And the other side of the rule, so no layer is asked for more than it owes: the ADAPTER
    // is where the disk is supposed to be touched, and the case above that names it holds.
    expect(A_MODULE_OF_THE_RUNTIME.test('node:fs')).toBe(true);
    expect(A_MODULE_OF_THE_RUNTIME.test('fs/promises')).toBe(true);
    expect(A_MODULE_OF_THE_RUNTIME.test('node:util')).toBe(false);
  });
});
