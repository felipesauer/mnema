// The shell commands a scripted model asks a host's shell tool to run in the dry runs and the tests: each rewrites ONE string in ONE file
// of the synthetic repository. They are written so that no quoting can break them (the code travels as base64), and they need only `node`.
import { GOVERNED_EDIT } from '../../seed/make-parity-repo.mjs';

export function replaceCmd(file, from, to) {
  const code = `const fs=require('fs');const p=${JSON.stringify(file)};const t=fs.readFileSync(p,'utf8');if(!t.includes(${JSON.stringify(from)}))process.exit(7);fs.writeFileSync(p,t.replace(${JSON.stringify(from)},${JSON.stringify(to)}))`;
  return `node -e "eval(Buffer.from('${Buffer.from(code).toString('base64')}','base64').toString())"`;
}

export const JS_EDIT = replaceCmd(GOVERNED_EDIT, 'const line = raw.trim();', "const line = raw.trim().replace(/^export\\s+/, '');");
export const PHP_EDIT = replaceCmd('packages/php/src/Formats/EnvAccessor.php', '$line = trim($raw);', "$line = preg_replace('/^export\\s+/', '', trim($raw));");
export const README_EDIT = replaceCmd('README.md', '# synthetic-accessors\n', '# Synthetic Accessors\n');
