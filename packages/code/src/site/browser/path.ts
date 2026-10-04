/** The part of `node:path` the verifier reads with: POSIX paths over the files the page carries. */

export function join(...parts: string[]): string {
  const kept: string[] = [];
  for (const segment of parts.join('/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') kept.pop();
    else kept.push(segment);
  }
  const joined = kept.join('/');
  return parts[0]?.startsWith('/') ? `/${joined}` : joined;
}

export function dirname(path: string): string {
  const cut = path.lastIndexOf('/');
  if (cut < 0) return '.';
  return cut === 0 ? '/' : path.slice(0, cut);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function relative(): never {
  throw new Error('relative is not available in the browser verifier');
}
