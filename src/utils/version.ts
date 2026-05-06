import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface PackageManifest {
  readonly version: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(here, '../../package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as PackageManifest;

/**
 * Current Mnema version, read from package.json at module load time.
 */
export const VERSION: string = manifest.version;
