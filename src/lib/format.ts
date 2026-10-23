/**
 * PixelVault Binary Container Format Specification
 * Version 1 (0x01)
 *
 * Fixed Header Layout (86 bytes total):
 * [00..07] 8B: Magic Signature "PIXELVLT" (ASCII 0x50, 0x49, 0x58, 0x45, 0x4C, 0x56, 0x4C, 0x54)
 * [08..08] 1B: Format Version (0x01)
 * [09..11] 3B: Reserved / Flags (0x00, 0x00, 0x00)
 * [12..27] 16B: File ID (UUID / 128-bit identifier, identical across chunks of same file)
 * [28..35] 8B: Total Original File Size (uint64 Big-Endian)
 * [36..67] 32B: Whole-File SHA-256 Digest (32 bytes)
 * [68..71] 4B: Chunk Index (uint32 Big-Endian, 0-indexed)
 * [72..75] 4B: Total Chunks (uint32 Big-Endian, >= 1)
 * [76..77] 2B: Filename Byte Length (uint16 Big-Endian, max 1024 bytes)
 * [78..81] 4B: Chunk Payload Byte Length (uint32 Big-Endian)
 * [82..85] 4B: Header CRC-32 (uint32 Big-Endian, computed over bytes 0..81)
 *
 * Variable Section:
 * [86..(86+Ln-1)] Ln bytes: Original Filename (UTF-8 encoded)
 * [(86+Ln)..(86+Ln+Lp-1)] Lp bytes: Chunk Payload Data
 * [(86+Ln+Lp)..(86+Ln+Lp+3)] 4B: Chunk Payload CRC-32 (uint32 Big-Endian)
 */

import { calculateCRC32 } from './crc32.ts';
import { bytesToHex } from './crypto.ts';

export const PIXELVAULT_MAGIC = new Uint8Array([0x50, 0x49, 0x58, 0x45, 0x4C, 0x56, 0x4C, 0x54]); // "PIXELVLT"
export const CURRENT_VERSION = 0x01;
export const FIXED_HEADER_SIZE = 86;
export const MAX_FILENAME_BYTES = 1024;
export const MAX_CHUNK_PAYLOAD_BYTES = 512 * 1024 * 1024; // 512 MB max safety limit per image chunk

export interface ContainerHeader {
  version: number;
  flags: number[];
  fileId: string; // Hex string representation of 16-byte ID
  fileIdBytes: Uint8Array;
  totalFileSize: number; // BigInt safe representation
  wholeFileSHA256: string; // 64-char hex
  wholeFileSHA256Bytes: Uint8Array;
  chunkIndex: number;
  totalChunks: number;
  filename: string;
  filenameBytesLength: number;
  chunkPayloadLength: number;
  headerCRC32: number;
}

export interface UnpackedContainer {
  header: ContainerHeader;
  payload: Uint8Array;
  chunkCRC32: number;
  headerCRCValid: boolean;
  chunkCRCValid: boolean;
}

/**
 * Generates a random 16-byte File ID
 */
export function generateFileId(): Uint8Array {
  const id = new Uint8Array(16);
  crypto.getRandomValues(id);
  return id;
}

/**
 * Sanitizes a filename to prevent path traversal or invalid characters.
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    return 'unnamed_file.bin';
  }
  // Strip null bytes and directory traversal elements
  let clean = filename
    .replace(/\0/g, '')
    .replace(/\\/g, '/')
    .split('/')
    .pop() || '';

  // Remove dangerous leading dots or control characters
  clean = clean.replace(/^[.\s]+/, '').replace(/[\x00-\x1F\x7F]/g, '');

  if (clean.length === 0) {
    clean = 'unnamed_file.bin';
  }
  return clean;
}

/**
 * Serializes a file chunk into the PixelVault container byte array.
 */
export function packContainer(params: {
  fileId: Uint8Array;
  totalFileSize: number;
  wholeFileSHA256Bytes: Uint8Array;
  chunkIndex: number;
  totalChunks: number;
  filename: string;
  payload: Uint8Array;
}): Uint8Array {
  const {
    fileId,
    totalFileSize,
    wholeFileSHA256Bytes,
    chunkIndex,
    totalChunks,
    filename,
    payload,
  } = params;

  if (fileId.length !== 16) {
    throw new Error('File ID must be exactly 16 bytes');
  }
  if (wholeFileSHA256Bytes.length !== 32) {
    throw new Error('Whole-File SHA-256 must be exactly 32 bytes');
  }
  if (chunkIndex < 0 || chunkIndex >= totalChunks) {
    throw new Error(`Invalid chunk index ${chunkIndex} for total ${totalChunks}`);
  }

  const cleanFilename = sanitizeFilename(filename);
  const textEncoder = new TextEncoder();
  const filenameBytes = textEncoder.encode(cleanFilename);

  if (filenameBytes.length > MAX_FILENAME_BYTES) {
    throw new Error(`Filename exceeds maximum allowed size (${MAX_FILENAME_BYTES} bytes)`);
  }

  const filenameLen = filenameBytes.length;
  const payloadLen = payload.length;

  // Total container size: Fixed Header (86) + Filename (filenameLen) + Payload (payloadLen) + Payload CRC (4)
  const totalContainerSize = FIXED_HEADER_SIZE + filenameLen + payloadLen + 4;
  const buffer = new Uint8Array(totalContainerSize);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // 1. Magic [0..7]
  buffer.set(PIXELVAULT_MAGIC, 0);

  // 2. Version [8]
  buffer[8] = CURRENT_VERSION;

  // 3. Flags [9..11]
  buffer[9] = 0;
  buffer[10] = 0;
  buffer[11] = 0;

  // 4. File ID [12..27]
  buffer.set(fileId, 12);

  // 5. Total File Size [28..35] as BigInt uint64
  view.setBigUint64(28, BigInt(totalFileSize), false);

  // 6. Whole-File SHA-256 [36..67]
  buffer.set(wholeFileSHA256Bytes, 36);

  // 7. Chunk Index [68..71]
  view.setUint32(68, chunkIndex, false);

  // 8. Total Chunks [72..75]
  view.setUint32(72, totalChunks, false);

  // 9. Filename Length [76..77]
  view.setUint16(76, filenameLen, false);

  // 10. Chunk Payload Length [78..81]
  view.setUint32(78, payloadLen, false);

  // 11. Compute Header CRC-32 over bytes [0..81]
  const headerCRC = calculateCRC32(buffer.subarray(0, 82));
  view.setUint32(82, headerCRC, false);

  // 12. Filename Bytes [86..86+filenameLen-1]
  buffer.set(filenameBytes, FIXED_HEADER_SIZE);

  // 13. Chunk Payload [offset..offset+payloadLen-1]
  const payloadOffset = FIXED_HEADER_SIZE + filenameLen;
  buffer.set(payload, payloadOffset);

  // 14. Compute Chunk Payload CRC-32 and write [offset+payloadLen..offset+payloadLen+3]
  const payloadCRC = calculateCRC32(payload);
  const crcOffset = payloadOffset + payloadLen;
  view.setUint32(crcOffset, payloadCRC, false);

  return buffer;
}

/**
 * Unpacks and rigorously verifies a PixelVault container from raw byte stream.
 */
export function unpackContainer(rawBytes: Uint8Array): UnpackedContainer {
  if (rawBytes.length < FIXED_HEADER_SIZE + 4) {
    throw new Error(
      `Container truncated: size (${rawBytes.length} bytes) is smaller than minimum header size (${FIXED_HEADER_SIZE + 4} bytes)`
    );
  }

  // 1. Verify Magic
  for (let i = 0; i < 8; i++) {
    if (rawBytes[i] !== PIXELVAULT_MAGIC[i]) {
      throw new Error('Invalid Magic: Not a valid PixelVault PNG container');
    }
  }

  // 2. Check Version
  const version = rawBytes[8];
  if (version !== CURRENT_VERSION) {
    throw new Error(
      `Unsupported container version: received 0x${version.toString(16)}, expected 0x${CURRENT_VERSION.toString(16)}`
    );
  }

  const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);

  // 3. Flags
  const flags = [rawBytes[9], rawBytes[10], rawBytes[11]];

  // 4. File ID
  const fileIdBytes = rawBytes.slice(12, 28);
  const fileId = bytesToHex(fileIdBytes);

  // 5. Total Original File Size
  const totalFileSizeBig = view.getBigUint64(28, false);
  if (totalFileSizeBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Total file size exceeds browser safe integer limit');
  }
  const totalFileSize = Number(totalFileSizeBig);

  // 6. Whole-File SHA-256
  const wholeFileSHA256Bytes = rawBytes.slice(36, 68);
  const wholeFileSHA256 = bytesToHex(wholeFileSHA256Bytes);

  // 7. Chunk Index & Total Chunks
  const chunkIndex = view.getUint32(68, false);
  const totalChunks = view.getUint32(72, false);

  if (totalChunks === 0) {
    throw new Error('Total chunks count cannot be zero');
  }
  if (chunkIndex >= totalChunks) {
    throw new Error(`Chunk index (${chunkIndex}) out of bounds for total chunks (${totalChunks})`);
  }

  // 8. Filename Length
  const filenameBytesLength = view.getUint16(76, false);
  if (filenameBytesLength > MAX_FILENAME_BYTES) {
    throw new Error(`Filename length (${filenameBytesLength}) exceeds maximum safety limit`);
  }

  // 9. Chunk Payload Length
  const chunkPayloadLength = view.getUint32(78, false);
  if (chunkPayloadLength > MAX_CHUNK_PAYLOAD_BYTES) {
    throw new Error(`Chunk payload length (${chunkPayloadLength}) exceeds maximum safety limit`);
  }

  // 10. Verify Header CRC-32
  const expectedHeaderCRC = view.getUint32(82, false);
  const actualHeaderCRC = calculateCRC32(rawBytes.subarray(0, 82));
  const headerCRCValid = expectedHeaderCRC === actualHeaderCRC;

  if (!headerCRCValid) {
    throw new Error(
      `Header CRC-32 mismatch! Header data is corrupted (Expected: 0x${expectedHeaderCRC.toString(16).toUpperCase()}, Computed: 0x${actualHeaderCRC.toString(16).toUpperCase()})`
    );
  }

  // 11. Bounds check before reading filename and payload
  const minRequiredLength = FIXED_HEADER_SIZE + filenameBytesLength + chunkPayloadLength + 4;
  if (rawBytes.length < minRequiredLength) {
    throw new Error(
      `Container truncated: payload requires ${minRequiredLength} bytes, but only ${rawBytes.length} bytes available`
    );
  }

  // 12. Parse Filename
  const filenameBytes = rawBytes.subarray(FIXED_HEADER_SIZE, FIXED_HEADER_SIZE + filenameBytesLength);
  const textDecoder = new TextDecoder('utf-8', { fatal: false });
  const rawFilename = textDecoder.decode(filenameBytes);
  const sanitizedFilename = sanitizeFilename(rawFilename);

  // 13. Extract Payload
  const payloadOffset = FIXED_HEADER_SIZE + filenameBytesLength;
  const payload = rawBytes.slice(payloadOffset, payloadOffset + chunkPayloadLength);

  // 14. Verify Chunk Payload CRC-32
  const crcOffset = payloadOffset + chunkPayloadLength;
  const expectedChunkCRC = view.getUint32(crcOffset, false);
  const actualChunkCRC = calculateCRC32(payload);
  const chunkCRCValid = expectedChunkCRC === actualChunkCRC;

  const header: ContainerHeader = {
    version,
    flags,
    fileId,
    fileIdBytes,
    totalFileSize,
    wholeFileSHA256,
    wholeFileSHA256Bytes,
    chunkIndex,
    totalChunks,
    filename: sanitizedFilename,
    filenameBytesLength,
    chunkPayloadLength,
    headerCRC32: expectedHeaderCRC,
  };

  return {
    header,
    payload,
    chunkCRC32: expectedChunkCRC,
    headerCRCValid,
    chunkCRCValid,
  };
}
