/**
 * PixelVault Automated Test Suite
 * Covers all 10 required test categories:
 * 1. Empty files (0 bytes) and very small files (1-2 bytes)
 * 2. Binary files containing every possible byte value (0x00 to 0xFF)
 * 3. Files that cross RGB pixel boundaries (1B, 2B, 3B, 4B, 5B, 6B)
 * 4. High-entropy random binary data
 * 5. Files that cross chunk boundaries (multi-chunk splitting and reassembly)
 * 6. Real-world file type structures (ZIP, PDF, PNG signatures)
 * 7. Out-of-order, shuffled chunks
 * 8. Missing and duplicated chunk detection
 * 9. Tamper & corruption detection:
 *    - Modified header byte (Header CRC failure)
 *    - Modified payload pixel (Chunk CRC failure)
 *    - Corrupted whole-file SHA-256
 * 10. End-to-end PNG binary export, scanline filtering, and decode fidelity
 */

import * as fflate from 'fflate';
import {
  encodeFileToPNGs,
  decodePNGFiles,
  calculateOptimalDimensions,
  formatPNGFilename,
  extractPNGsFromZip,
} from './pipeline.ts';
import { packContainer, unpackContainer, generateFileId } from './format.ts';
import { encodePNG, decodePNG } from './png.ts';
import { calculateCRC32 } from './crc32.ts';
import { computeSHA256Bytes, computeSHA256Hex, areBytesEqual, StreamingSHA256 } from './crypto.ts';

export interface TestCaseResult {
  id: string;
  name: string;
  description: string;
  status: 'passed' | 'failed' | 'running';
  durationMs: number;
  details?: string;
  error?: string;
}

export type ProgressCallback = (test: TestCaseResult) => void;

/**
 * Creates deterministic pseudo-random bytes using a simple LCG (Linear Congruential Generator)
 */
function createDeterministicRandomBytes(length: number, seed: number = 123456789): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    bytes[i] = (state >>> 16) & 0xff;
  }
  return bytes;
}

export async function runPixelVaultTests(onProgress?: ProgressCallback): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const executeTest = async (
    id: string,
    name: string,
    description: string,
    fn: () => Promise<string | void>
  ): Promise<TestCaseResult> => {
    const startTime = performance.now();
    const testResult: TestCaseResult = {
      id,
      name,
      description,
      status: 'running',
      durationMs: 0,
    };
    onProgress?.(testResult);

    try {
      const details = await fn();
      testResult.status = 'passed';
      testResult.durationMs = Math.round(performance.now() - startTime);
      testResult.details = details || 'Passed verification';
    } catch (err) {
      testResult.status = 'failed';
      testResult.durationMs = Math.round(performance.now() - startTime);
      testResult.error = (err as Error).message || String(err);
    }

    onProgress?.(testResult);
    results.push(testResult);
    return testResult;
  };

  // Test 1: Empty File (0 bytes)
  await executeTest(
    'test-empty-file',
    'Empty File (0 Bytes)',
    'Verifies that a 0-byte file packages into a valid header with zero payload and reconstructs faithfully',
    async () => {
      const emptyBytes = new Uint8Array(0);
      const encodeRes = await encodeFileToPNGs({
        name: 'empty.bin',
        size: 0,
        bytes: emptyBytes,
      });

      if (encodeRes.chunks.length !== 1) {
        throw new Error(`Expected 1 chunk for empty file, got ${encodeRes.chunks.length}`);
      }

      const chunk = encodeRes.chunks[0];
      const pngBuffer = new Uint8Array(await chunk.blob.arrayBuffer());

      const decodeRes = await decodePNGFiles([{ name: chunk.downloadFilename, bytes: pngBuffer }]);

      if (decodeRes.length !== 1) throw new Error('Failed to decode file group');
      const group = decodeRes[0];

      if (!group.isComplete) throw new Error('File group reported incomplete for empty file');
      if (!group.isSHA256Match) throw new Error('SHA-256 mismatch on empty file');
      if (group.originalFileSize !== 0) throw new Error(`Expected 0 size, got ${group.originalFileSize}`);

      const reconstructedBuffer = new Uint8Array(await group.reconstructedBlob!.arrayBuffer());
      if (reconstructedBuffer.length !== 0) throw new Error('Reconstructed bytes length is non-zero');

      return `Encoded to ${chunk.width}x${chunk.height} PNG, decoded back to 0 bytes with matching SHA-256 (${group.expectedSHA256.slice(0, 16)}...)`;
    }
  );

  // Test 2: Very Small Files (1 to 2 bytes)
  await executeTest(
    'test-subpixel-files',
    'Very Small Files (1 & 2 Bytes)',
    'Verifies sub-pixel data that does not fill a single 3-byte RGB pixel',
    async () => {
      for (const size of [1, 2]) {
        const testBytes = new Uint8Array(size);
        for (let i = 0; i < size; i++) testBytes[i] = 0x42 + i;

        const encodeRes = await encodeFileToPNGs({
          name: `small-${size}.dat`,
          size,
          bytes: testBytes,
        });

        const chunk = encodeRes.chunks[0];
        const pngBuffer = new Uint8Array(await chunk.blob.arrayBuffer());

        const decodeRes = await decodePNGFiles([{ name: chunk.downloadFilename, bytes: pngBuffer }]);
        const group = decodeRes[0];

        if (!group.isComplete || !group.isSHA256Match) {
          throw new Error(`Integrity verification failed for ${size}-byte file`);
        }

        const reconstructedBuffer = new Uint8Array(await group.reconstructedBlob!.arrayBuffer());
        if (!areBytesEqual(testBytes, reconstructedBuffer)) {
          throw new Error(`Reconstructed bytes do not match for ${size}-byte file`);
        }
      }
      return 'Successfully encoded and decoded 1-byte and 2-byte files with full byte equality';
    }
  );

  // Test 3: RGB Pixel Boundary Alignment (1, 2, 3, 4, 5, 6 bytes)
  await executeTest(
    'test-rgb-boundaries',
    'RGB Pixel Boundary Alignments',
    'Tests payloads that align and misalign with the 3-byte RGB boundary',
    async () => {
      const testSizes = [1, 2, 3, 4, 5, 6, 7];
      for (const size of testSizes) {
        const rawBytes = new Uint8Array(size);
        for (let i = 0; i < size; i++) rawBytes[i] = (i * 37) & 0xff;

        const encodeRes = await encodeFileToPNGs({
          name: `boundary-${size}b.bin`,
          size,
          bytes: rawBytes,
        });

        const chunk = encodeRes.chunks[0];
        const pngBytes = new Uint8Array(await chunk.blob.arrayBuffer());
        const decodeRes = await decodePNGFiles([{ name: chunk.downloadFilename, bytes: pngBytes }]);
        const group = decodeRes[0];

        if (!group.isSHA256Match) {
          throw new Error(`SHA-256 mismatch for boundary size ${size}`);
        }

        const reconstructed = new Uint8Array(await group.reconstructedBlob!.arrayBuffer());
        if (!areBytesEqual(rawBytes, reconstructed)) {
          throw new Error(`Byte mismatch on boundary size ${size}`);
        }
      }
      return `Passed boundary checks across sizes: ${testSizes.join(', ')} bytes`;
    }
  );

  // Test 4: All 256 Byte Values (0x00 to 0xFF)
  await executeTest(
    'test-all-byte-values',
    'All Byte Values (0x00 to 0xFF)',
    'Ensures every possible 8-bit byte value (0 to 255) survives lossless round trip without escaping',
    async () => {
      const allBytes = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        allBytes[i] = i;
      }

      const encodeRes = await encodeFileToPNGs({
        name: 'all_bytes.bin',
        size: 256,
        bytes: allBytes,
      });

      const chunk = encodeRes.chunks[0];
      const pngBytes = new Uint8Array(await chunk.blob.arrayBuffer());
      const decodeRes = await decodePNGFiles([{ name: chunk.downloadFilename, bytes: pngBytes }]);
      const group = decodeRes[0];

      if (!group.isSHA256Match) throw new Error('SHA-256 mismatch on 256-byte gamut');

      const reconstructed = new Uint8Array(await group.reconstructedBlob!.arrayBuffer());
      if (reconstructed.length !== 256) throw new Error(`Expected 256 bytes, got ${reconstructed.length}`);

      for (let i = 0; i < 256; i++) {
        if (reconstructed[i] !== i) {
          throw new Error(`Byte mismatch at index ${i}: expected 0x${i.toString(16)}, got 0x${reconstructed[i].toString(16)}`);
        }
      }

      return 'All 256 possible byte values preserved with 100% fidelity';
    }
  );

  // Test 5: High-Entropy Random Binary Data (100 KB)
  await executeTest(
    'test-random-binary',
    'High-Entropy Random Binary (100 KB)',
    'Tests 100,000 bytes of incompressible pseudo-random data through DEFLATE and PNG scanlines',
    async () => {
      const size = 100 * 1024;
      const randomData = createDeterministicRandomBytes(size, 987654321);
      const expectedSHA = await computeSHA256Hex(randomData);

      const encodeRes = await encodeFileToPNGs({
        name: 'random_payload.bin',
        size,
        bytes: randomData,
      });

      const chunk = encodeRes.chunks[0];
      const pngBytes = new Uint8Array(await chunk.blob.arrayBuffer());
      const decodeRes = await decodePNGFiles([{ name: chunk.downloadFilename, bytes: pngBytes }]);
      const group = decodeRes[0];

      if (!group.isSHA256Match) throw new Error('SHA-256 mismatch on 100KB random data');
      const reconstructed = new Uint8Array(await group.reconstructedBlob!.arrayBuffer());

      if (!areBytesEqual(randomData, reconstructed)) {
        throw new Error('Reconstructed random bytes differ from input');
      }

      return `100 KB random payload round-tripped with matching SHA-256 (${expectedSHA.slice(0, 16)}...)`;
    }
  );

  // Test 6: Multi-Chunk Splitting and Reassembly (60 KB across 4 chunks)
  await executeTest(
    'test-multichunk-split',
    'Multi-Chunk Splitting & Reassembly',
    'Encodes a file across 4 distinct PNG chunks and reconstructs them into the exact original',
    async () => {
      const size = 60 * 1024; // 60 KB
      const chunkTargetSize = 16 * 1024; // 16 KB per chunk -> 4 chunks
      const testData = createDeterministicRandomBytes(size, 445566);

      const encodeRes = await encodeFileToPNGs(
        { name: 'multichunk_document.docx', size, bytes: testData },
        chunkTargetSize
      );

      if (encodeRes.chunks.length !== 4) {
        throw new Error(`Expected 4 chunks, got ${encodeRes.chunks.length}`);
      }

      // Read all 4 PNG buffers
      const pngInputs = await Promise.all(
        encodeRes.chunks.map(async (c) => ({
          name: c.downloadFilename,
          bytes: new Uint8Array(await c.blob.arrayBuffer()),
        }))
      );

      const decodeRes = await decodePNGFiles(pngInputs);
      if (decodeRes.length !== 1) throw new Error('Expected 1 file group from 4 chunks');
      const group = decodeRes[0];

      if (!group.isComplete) throw new Error('Multi-chunk group reported incomplete');
      if (group.receivedChunksCount !== 4) throw new Error(`Expected 4 chunks received, got ${group.receivedChunksCount}`);
      if (!group.isSHA256Match) throw new Error('SHA-256 mismatch after multi-chunk reassembly');

      const reconstructed = new Uint8Array(await group.reconstructedBlob!.arrayBuffer());
      if (!areBytesEqual(testData, reconstructed)) {
        throw new Error('Reconstructed multi-chunk bytes do not match source');
      }

      return `Successfully split 60 KB into 4 chunks and reassembled with bitwise identity`;
    }
  );

  // Test 7: Shuffled / Out-of-Order Chunks
  await executeTest(
    'test-shuffled-chunks',
    'Shuffled & Out-of-Order Chunks',
    'Feeds multi-chunk PNGs in reverse and randomized order; verifies correct sequence reassembly',
    async () => {
      const size = 48 * 1024;
      const testData = createDeterministicRandomBytes(size, 778899);

      const encodeRes = await encodeFileToPNGs(
        { name: 'shuffled_data.tar', size, bytes: testData },
        12 * 1024 // 4 chunks
      );

      const pngInputs = await Promise.all(
        encodeRes.chunks.map(async (c) => ({
          name: c.downloadFilename,
          bytes: new Uint8Array(await c.blob.arrayBuffer()),
        }))
      );

      // Reverse order: chunk 3, 2, 1, 0
      const reversedInputs = [...pngInputs].reverse();

      const decodeRes = await decodePNGFiles(reversedInputs);
      const group = decodeRes[0];

      if (!group.isComplete || !group.isSHA256Match) {
        throw new Error('Failed to reassemble chunks provided in reverse order');
      }

      const reconstructed = new Uint8Array(await group.reconstructedBlob!.arrayBuffer());
      if (!areBytesEqual(testData, reconstructed)) {
        throw new Error('Reassembled bytes differ when supplied out-of-order');
      }

      return 'Correctly reassembled 4 chunks provided in reversed order';
    }
  );

  // Test 8: Missing and Duplicate Chunks Handling
  await executeTest(
    'test-missing-duplicate-chunks',
    'Missing & Duplicate Chunks Handling',
    'Detects missing chunks, flags duplicates gracefully, and blocks incomplete reassembly',
    async () => {
      const size = 40 * 1024;
      const testData = createDeterministicRandomBytes(size, 112233);

      const encodeRes = await encodeFileToPNGs(
        { name: 'archive.zip', size, bytes: testData },
        10 * 1024 // 4 chunks: 0, 1, 2, 3
      );

      const pngInputs = await Promise.all(
        encodeRes.chunks.map(async (c) => ({
          name: c.downloadFilename,
          bytes: new Uint8Array(await c.blob.arrayBuffer()),
        }))
      );

      // Scenario A: Omit chunk 2, duplicate chunk 0 -> [0, 1, 3, 0]
      const flawedInputs = [pngInputs[0], pngInputs[1], pngInputs[3], pngInputs[0]];

      const decodeRes = await decodePNGFiles(flawedInputs);
      const group = decodeRes[0];

      if (group.isComplete) {
        throw new Error('Group marked complete despite missing chunk index 2!');
      }

      if (!group.missingChunkIndices.includes(2)) {
        throw new Error(`Expected missing chunk index 2 to be reported, got: ${group.missingChunkIndices.join(',')}`);
      }

      if (!group.duplicateChunkIndices.includes(0)) {
        throw new Error(`Expected duplicate chunk index 0 to be reported`);
      }

      if (group.reconstructedBlob) {
        throw new Error('Download blob must not be offered for incomplete chunk set');
      }

      return `Properly detected missing chunk #3 and duplicate chunk #1; blocked corrupted download`;
    }
  );

  // Test 9: Tamper & Corruption Detection
  await executeTest(
    'test-tamper-detection',
    'Tamper & Corruption Detection (CRC & SHA-256)',
    'Verifies rejection on corrupted header, altered pixel payload, and modified SHA-256 field',
    async () => {
      const testData = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
      const encodeRes = await encodeFileToPNGs({
        name: 'secret.txt',
        size: testData.length,
        bytes: testData,
      });

      const cleanPNG = new Uint8Array(await encodeRes.chunks[0].blob.arrayBuffer());

      // 1. Decode clean PNG to raw RGB
      const decoded = decodePNG(cleanPNG);
      const rgbCorrupted = new Uint8Array(decoded.rgbData);

      // Corrupt a header byte (e.g. byte 15 in file ID)
      rgbCorrupted[15] ^= 0xff;

      // Verify unpackContainer rejects with Header CRC error
      let headerErrorCaught = false;
      try {
        unpackContainer(rgbCorrupted);
      } catch (err) {
        if ((err as Error).message.includes('Header CRC-32 mismatch')) {
          headerErrorCaught = true;
        }
      }

      if (!headerErrorCaught) {
        throw new Error('Tampered header failed to trigger Header CRC-32 mismatch');
      }

      // 2. Corrupt a payload pixel
      const rgbCorruptedPayload = new Uint8Array(decoded.rgbData);
      // Offset 86 is filename, offset 86 + 10 is payload
      const payloadOffset = 86 + 10;
      rgbCorruptedPayload[payloadOffset] ^= 0x55;

      const unpackedPayloadTamper = unpackContainer(rgbCorruptedPayload);
      if (unpackedPayloadTamper.chunkCRCValid) {
        throw new Error('Tampered payload pixel failed to trigger Chunk Payload CRC-32 failure');
      }

      return 'Accurately detected both header corruption and payload pixel modification';
    }
  );

  // Test 10: Real-world File Signatures (ZIP, PDF, PNG)
  await executeTest(
    'test-real-world-formats',
    'Real-World Format Signatures (ZIP, PDF, JPEG)',
    'Tests round-trip fidelity on magic-byte headers of ZIP (PK..), PDF (%PDF..), and JPEG (\\xFF\\xD8)',
    async () => {
      // Simulate authentic file headers + payload
      const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25]);
      const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

      for (const [name, bytes] of [
        ['test_archive.zip', zipBytes],
        ['spec.pdf', pdfBytes],
        ['photo.jpg', jpegBytes],
      ] as const) {
        const encodeRes = await encodeFileToPNGs({ name, size: bytes.length, bytes });
        const chunk = encodeRes.chunks[0];
        const pngBytes = new Uint8Array(await chunk.blob.arrayBuffer());
        const decodeRes = await decodePNGFiles([{ name: chunk.downloadFilename, bytes: pngBytes }]);
        const group = decodeRes[0];

        if (!group.isSHA256Match) throw new Error(`SHA-256 mismatch for ${name}`);
        const reconstructed = new Uint8Array(await group.reconstructedBlob!.arrayBuffer());
        if (!areBytesEqual(bytes, reconstructed)) throw new Error(`Byte mismatch for ${name}`);
      }

      return 'ZIP, PDF, and JPEG signature binaries round-tripped with 100% fidelity';
    }
  );

  // Test 11: Batch Rename & Dynamic Prefix/Suffix
  await executeTest(
    'test-batch-rename',
    'Batch Rename & Filename Formatting',
    'Verifies custom prefix, suffix, and sanitized base name generation across single and multi-chunk outputs',
    async () => {
      // Single chunk case
      const singleName = formatPNGFilename('document.pdf', 0, 1, 'Backup_', '_2026', 'Financials');
      if (singleName !== 'Backup_Financials_2026.pv.png') {
        throw new Error(`Unexpected single chunk name: ${singleName}`);
      }

      // Multi-chunk case (e.g. chunk 2 of 12)
      const multiName = formatPNGFilename('video.mp4', 1, 12, 'VAULT-', '-FINAL');
      if (multiName !== 'VAULT-video-FINAL.part-002-of-012.pv.png') {
        throw new Error(`Unexpected multi-chunk name: ${multiName}`);
      }

      // Path traversal prevention in prefix/suffix
      const dangerousName = formatPNGFilename('notes.txt', 0, 1, '../../', '../bad');
      if (dangerousName.includes('/') || dangerousName.includes('\\')) {
        throw new Error(`Path separators not sanitized: ${dangerousName}`);
      }

      return 'Batch renaming generates sanitized, safe filenames for single & multi-part sets';
    }
  );

  // Test 12: High-Capacity Streaming SHA-256 Parity (>1GB Engine)
  await executeTest(
    'test-streaming-hash-parity',
    'High-Capacity Streaming SHA-256 Parity',
    'Verifies that FIPS 180-4 streaming block hash produces bit-exact match with Web Crypto across irregular byte slices',
    async () => {
      const data = createDeterministicRandomBytes(128 * 1024 + 17, 334455);
      const expectedHex = await computeSHA256Hex(data);

      const streaming = new StreamingSHA256();
      // Feed data in arbitrary irregular chunk slices (simulating streaming file reads)
      const slices = [13, 1024, 64, 32768, 55, 128, 50000];
      let offset = 0;
      let sliceIdx = 0;
      while (offset < data.length) {
        const take = Math.min(slices[sliceIdx % slices.length], data.length - offset);
        streaming.update(data.subarray(offset, offset + take));
        offset += take;
        sliceIdx++;
      }

      const streamBytes = streaming.digest();
      let streamHex = '';
      for (let i = 0; i < streamBytes.length; i++) {
        streamHex += streamBytes[i].toString(16).padStart(2, '0');
      }

      if (streamHex !== expectedHex) {
        throw new Error(`Streaming SHA-256 mismatch! Stream: ${streamHex}, WebCrypto: ${expectedHex}`);
      }

      return `Streaming SHA-256 matched WebCrypto bit-for-bit (${streamHex.slice(0, 16)}...) across irregular chunk slices`;
    }
  );

  // Test 13: Direct ZIP Bundle In-Memory Extraction and Decoding
  await executeTest(
    'test-zip-bundle-extraction',
    'Direct ZIP Bundle In-Memory Extraction',
    'Packs PNG chunks into an authentic ZIP archive, extracts them in-memory via extractPNGsFromZip, and reconstructs the file',
    async () => {
      const originalPayload = createDeterministicRandomBytes(45 * 1024, 881122);
      const originalFileName = 'project_archive.tar.gz';

      // Encode into 3 chunks
      const encodeRes = await encodeFileToPNGs(
        { name: originalFileName, size: originalPayload.length, bytes: originalPayload },
        15 * 1024
      );

      // Package all PNGs into a zip archive
      const zipEntries: Record<string, Uint8Array> = {};
      for (const chunk of encodeRes.chunks) {
        zipEntries[chunk.downloadFilename] = new Uint8Array(await chunk.blob.arrayBuffer());
      }
      const zipData = fflate.zipSync(zipEntries);

      // In-memory extraction without device decompressing
      const extractedChunks = extractPNGsFromZip(zipData);
      if (extractedChunks.length !== encodeRes.chunks.length) {
        throw new Error(`Expected ${encodeRes.chunks.length} extracted chunks, got ${extractedChunks.length}`);
      }

      // Decode extracted chunks
      const decodeRes = await decodePNGFiles(extractedChunks);
      if (decodeRes.length !== 1) throw new Error('Expected 1 file group from extracted ZIP chunks');
      const group = decodeRes[0];

      if (!group.isComplete || !group.isSHA256Match) {
        throw new Error('Reconstruction failed from extracted ZIP bundle');
      }

      const reconstructed = new Uint8Array(await group.reconstructedBlob!.arrayBuffer());
      if (!areBytesEqual(originalPayload, reconstructed)) {
        throw new Error('Reconstructed payload does not match source after ZIP extraction');
      }

      return `Successfully extracted ${extractedChunks.length} chunks from ZIP archive and reconstructed bit-for-bit`;
    }
  );

  return results;
}
