import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Result of storing a file in the {@link FileStore}.
 *
 * `relativePath` is rooted at the attachments directory and is what
 * the database persists; `absolutePath` is the materialised path on
 * disk (handy for tests and for downloads).
 */
export interface StoredFile {
  readonly hash: string;
  readonly size: number;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly extension: string;
  /** True when the content already existed (dedup hit). */
  readonly deduplicated: boolean;
}

/**
 * Content-addressed storage for binary attachments.
 *
 * Files are stored under `attachmentsDir/{sha256}{.ext}`. Identical
 * content (same hash) is written exactly once: subsequent calls with
 * the same payload return `deduplicated: true` without touching disk.
 *
 * The store is intentionally synchronous: the dataset is small (a few
 * MB at most) and the sync API keeps the code path simple in the
 * Node-side hot path.
 */
export class FileStore {
  constructor(private readonly attachmentsDir: string) {}

  /**
   * Stores a file by its SHA-256 hash.
   *
   * @param sourcePath - Absolute path to the file to ingest
   * @returns Hash, size and resolved paths of the stored attachment
   */
  store(sourcePath: string): StoredFile {
    if (!existsSync(this.attachmentsDir)) {
      mkdirSync(this.attachmentsDir, { recursive: true });
    }

    const buffer = readFileSync(sourcePath);
    const hash = createHash('sha256').update(buffer).digest('hex');
    const extension = path.extname(sourcePath);
    const fileName = `${hash}${extension}`;
    const absolutePath = path.join(this.attachmentsDir, fileName);
    const relativePath = path.posix.join('.app', 'attachments', fileName);

    let deduplicated = false;
    if (existsSync(absolutePath)) {
      deduplicated = true;
    } else {
      writeFileSync(absolutePath, buffer);
    }

    const size = statSync(absolutePath).size;
    return { hash, size, relativePath, absolutePath, extension, deduplicated };
  }
}
