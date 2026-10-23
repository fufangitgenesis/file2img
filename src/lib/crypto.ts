/**
 * Cryptographic hash utilities (SHA-256)
 * Supports standard Web Crypto API for fast hashing of small-to-medium buffers,
 * plus a high-performance streaming chunked SHA-256 implementation (FIPS 180-4)
 * capable of hashing multi-gigabyte files (> 1 GB) using low-memory slice streaming.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * Streaming SHA-256 Hash Engine (FIPS 180-4)
 * Processes arbitrary stream in 64-byte blocks with constant low memory overhead.
 */
export class StreamingSHA256 {
  private h0 = 0x6a09e667;
  private h1 = 0xbb67ae85;
  private h2 = 0x3c6ef372;
  private h3 = 0xa54ff53a;
  private h4 = 0x510e527f;
  private h5 = 0x9b05688c;
  private h6 = 0x1f83d9ab;
  private h7 = 0x5be0cd19;

  private block = new Uint8Array(64);
  private blockLen = 0;
  private totalBytes = 0;
  private w = new Uint32Array(64);

  public update(chunk: Uint8Array): void {
    const chunkLen = chunk.length;
    this.totalBytes += chunkLen;
    let offset = 0;

    // Fill residual block if any
    if (this.blockLen > 0) {
      const needed = 64 - this.blockLen;
      if (chunkLen >= needed) {
        this.block.set(chunk.subarray(0, needed), this.blockLen);
        this.processBlock(this.block, 0);
        this.blockLen = 0;
        offset = needed;
      } else {
        this.block.set(chunk, this.blockLen);
        this.blockLen += chunkLen;
        return;
      }
    }

    // Process full 64-byte blocks
    while (offset + 64 <= chunkLen) {
      this.processBlock(chunk, offset);
      offset += 64;
    }

    // Retain leftovers
    if (offset < chunkLen) {
      this.block.set(chunk.subarray(offset), 0);
      this.blockLen = chunkLen - offset;
    }
  }

  private processBlock(buf: Uint8Array, offset: number): void {
    const w = this.w;
    // Load 16 words (big-endian)
    for (let i = 0; i < 16; i++) {
      const idx = offset + (i << 2);
      w[i] = ((buf[idx] << 24) | (buf[idx + 1] << 16) | (buf[idx + 2] << 8) | buf[idx + 3]) >>> 0;
    }

    // Extend 16 words into 64 words
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 2];
      const s1 = (((w15 >>> 17) | (w15 << 15)) ^ ((w15 >>> 19) | (w15 << 13)) ^ (w15 >>> 10)) >>> 0;
      const w2 = w[i - 15];
      const s0 = (((w2 >>> 7) | (w2 << 25)) ^ ((w2 >>> 18) | (w2 << 14)) ^ (w2 >>> 3)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = this.h0;
    let b = this.h1;
    let c = this.h2;
    let d = this.h3;
    let e = this.h4;
    let f = this.h5;
    let g = this.h6;
    let h = this.h7;

    for (let i = 0; i < 64; i++) {
      const s1 = (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this.h0 = (this.h0 + a) >>> 0;
    this.h1 = (this.h1 + b) >>> 0;
    this.h2 = (this.h2 + c) >>> 0;
    this.h3 = (this.h3 + d) >>> 0;
    this.h4 = (this.h4 + e) >>> 0;
    this.h5 = (this.h5 + f) >>> 0;
    this.h6 = (this.h6 + g) >>> 0;
    this.h7 = (this.h7 + h) >>> 0;
  }

  public digest(): Uint8Array {
    // Pad message according to FIPS 180-4
    // Append bit '1' (0x80)
    const pad = new Uint8Array(128);
    pad.set(this.block.subarray(0, this.blockLen), 0);
    pad[this.blockLen] = 0x80;

    let padLen = this.blockLen + 1;
    while (padLen % 64 !== 56) {
      pad[padLen++] = 0;
    }

    // Append 64-bit length in bits (big-endian)
    const totalBits = BigInt(this.totalBytes) * 8n;
    const view = new DataView(pad.buffer, pad.byteOffset, pad.byteLength);
    view.setBigUint64(padLen, totalBits, false);
    padLen += 8;

    for (let offset = 0; offset < padLen; offset += 64) {
      this.processBlock(pad, offset);
    }

    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer, out.byteOffset, out.byteLength);
    outView.setUint32(0, this.h0, false);
    outView.setUint32(4, this.h1, false);
    outView.setUint32(8, this.h2, false);
    outView.setUint32(12, this.h3, false);
    outView.setUint32(16, this.h4, false);
    outView.setUint32(20, this.h5, false);
    outView.setUint32(24, this.h6, false);
    outView.setUint32(28, this.h7, false);

    return out;
  }
}

/**
 * Computes SHA-256 digest of a byte array and returns 32-byte Uint8Array.
 * Uses Web Crypto API when available, falling back seamlessly.
 */
export async function computeSHA256Bytes(data: Uint8Array): Promise<Uint8Array> {
  if (typeof crypto !== 'undefined' && crypto.subtle && data.byteLength < 256 * 1024 * 1024) {
    try {
      const digestBuffer = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
      return new Uint8Array(digestBuffer);
    } catch {
      // Fall through to streaming implementation if buffer exceeds browser crypto limits
    }
  }

  const hasher = new StreamingSHA256();
  hasher.update(data);
  return hasher.digest();
}

/**
 * Streams an arbitrary File or Blob in 16 MB slices and computes its SHA-256 digest.
 * Allows hashing multi-gigabyte files (> 1 GB) without holding the whole file in memory.
 */
export async function computeSHA256FileStream(
  file: File | Blob,
  onProgress?: (hashedBytes: number, totalBytes: number, percent: number) => void,
  abortSignal?: AbortSignal
): Promise<Uint8Array> {
  const hasher = new StreamingSHA256();
  const sliceSize = 16 * 1024 * 1024; // 16 MB slices
  const total = file.size;

  if (total === 0) {
    return hasher.digest();
  }

  for (let offset = 0; offset < total; offset += sliceSize) {
    if (abortSignal?.aborted) {
      throw new Error('Hashing aborted by user');
    }

    const sliceBlob = file.slice(offset, Math.min(offset + sliceSize, total));
    const arrayBuffer = await sliceBlob.arrayBuffer();
    hasher.update(new Uint8Array(arrayBuffer));

    if (onProgress) {
      const currentHashed = Math.min(total, offset + arrayBuffer.byteLength);
      const pct = Math.min(100, Math.round((currentHashed / total) * 100));
      onProgress(currentHashed, total, pct);
    }
  }

  return hasher.digest();
}

/**
 * Computes SHA-256 digest and returns a 64-character lowercase hex string.
 */
export async function computeSHA256Hex(data: Uint8Array): Promise<string> {
  const bytes = await computeSHA256Bytes(data);
  return bytesToHex(bytes);
}

/**
 * Converts a Uint8Array to a lowercase hex string.
 */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Converts a hex string into a Uint8Array.
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.replace(/[^0-9a-fA-F]/g, '');
  if (cleanHex.length % 2 !== 0) {
    throw new Error('Invalid hex string length');
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Compares two Uint8Arrays for exact equality in constant-ish time.
 */
export function areBytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
