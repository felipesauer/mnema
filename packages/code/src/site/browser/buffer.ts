/**
 * The part of Node's `Buffer` the verifier reads with — a `Uint8Array` that knows its hex,
 * base64 and UTF-8 spellings and the handful of integer reads the witness code makes.
 *
 * A page has no `Buffer`, and the verifier is the Node one. This is what stands in for it
 * when the bundle is built (the bundler injects it where the verifier says `Buffer`), and
 * the verdict test runs the bundle in a context that has no `Buffer` at all, so a method
 * the verifier needs and this lacks fails there instead of in somebody's browser.
 */

type Encoding = 'hex' | 'base64' | 'utf-8' | 'utf8';

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

class Bytes extends Uint8Array {
  override toString(encoding: Encoding = 'utf-8', start = 0, end = this.length): string {
    const view = this.subarray(start, end);
    if (encoding === 'hex') {
      let out = '';
      for (const byte of view) out += byte.toString(16).padStart(2, '0');
      return out;
    }
    if (encoding === 'base64') {
      let binary = '';
      for (const byte of view) binary += String.fromCharCode(byte);
      return btoa(binary);
    }
    return utf8Decoder.decode(view);
  }

  equals(other: Uint8Array): boolean {
    return this.length === other.length && this.every((byte, i) => byte === other[i]);
  }

  compare(other: Uint8Array): number {
    return Buffer.compare(this, other);
  }

  override lastIndexOf(value: number, from?: number): number {
    return super.lastIndexOf(value, from ?? this.length - 1);
  }

  readUInt32LE(offset = 0): number {
    return (
      ((this[offset] as number) |
        ((this[offset + 1] as number) << 8) |
        ((this[offset + 2] as number) << 16) |
        ((this[offset + 3] as number) << 24)) >>>
      0
    );
  }

  writeUInt32BE(value: number, offset = 0): number {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setUint32(offset, value, false);
    return offset + 4;
  }

  writeUIntBE(value: number, offset: number, byteLength: number): number {
    let rest = value;
    for (let i = byteLength - 1; i >= 0; i--) {
      this[offset + i] = rest % 256;
      rest = Math.floor(rest / 256);
    }
    return offset + byteLength;
  }
}

export type Buffer = Bytes;

export function fromHex(source: string): Bytes {
  if (source.length % 2 !== 0 || /[^0-9a-fA-F]/.test(source)) {
    // Node's own `hex` decoding stops at the first bad pair; the verifier only ever hands it
    // hex the record wrote, so refuse rather than guess what stopping would mean.
    throw new Error('not a hex string');
  }
  const out = new Bytes(source.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(source.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function fromBase64(source: string): Bytes {
  const binary = atob(source);
  const out = new Bytes(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function copyOf(bytes: ArrayLike<number>): Bytes {
  const out = new Bytes(bytes.length);
  out.set(bytes);
  return out;
}

/** What `Buffer` is called by: the constructors the verifier uses, over {@link Bytes}. */
export const Buffer = {
  from(source: string | ArrayLike<number> | ArrayBuffer, encoding?: Encoding): Bytes {
    if (typeof source === 'string') {
      if (encoding === 'hex') return fromHex(source);
      if (encoding === 'base64') return fromBase64(source);
      return copyOf(utf8Encoder.encode(source));
    }
    return copyOf(source instanceof ArrayBuffer ? new Uint8Array(source) : source);
  },

  alloc(size: number): Bytes {
    return new Bytes(size);
  },

  concat(parts: readonly Uint8Array[]): Bytes {
    const out = new Bytes(parts.reduce((n, part) => n + part.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  },

  byteLength(text: string): number {
    return utf8Encoder.encode(text).length;
  },

  isBuffer(value: unknown): value is Bytes {
    return value instanceof Bytes;
  },

  compare(a: Uint8Array, b: Uint8Array): number {
    const common = Math.min(a.length, b.length);
    for (let i = 0; i < common; i++) {
      if ((a[i] as number) !== (b[i] as number)) {
        return (a[i] as number) < (b[i] as number) ? -1 : 1;
      }
    }
    return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
  },
};
