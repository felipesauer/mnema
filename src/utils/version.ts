import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PACKAGE_ROOT } from './asset-paths.js';

interface PackageManifest {
  readonly version: string;
}

// Resolve the manifest from the identity-checked PACKAGE_ROOT rather than a
// fixed '../../package.json' hop: the relative form assumed this module sits
// exactly two dirs below the root (which differs between src/ and dist/, and
// breaks if the layout ever moves) and trusted whatever package.json landed
// there. PACKAGE_ROOT walks up to the package.json whose name is
// @felipesauer/mnema, so a stray sibling manifest can never be read here.
const manifestPath = resolve(PACKAGE_ROOT, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as PackageManifest;

/**
 * Current Mnema version, read from package.json at module load time.
 */
export const VERSION: string = manifest.version;
