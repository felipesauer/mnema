/**
 * The name the extension has in the stores, and the one source of it. The workspace package is `@mnema/vscode`, which
 * `vsce` refuses for being scoped, so the packer writes this name into the manifest it packs, and the stores know the
 * extension as `<publisher>.<this name>` (`mnema.mnema`). The site reads it from here to say where the extension is found.
 */
export const EXTENSION_NAME = 'mnema';
