/**
 * End-to-end Pipeline: File Chunking, Packaging, PNG Generation,
 * Multi-chunk Ledger, Reassembly, and Integrity Verification.
 * Supports streaming slice processing for files > 1 GB.
 */

import * as fflate from 'fflate';
import { computeSHA256Bytes, computeSHA256FileStream, bytesToHex } from './crypto.ts';
import {
  packContainer,
  unpackContainer,
  generateFileId,
  sanitizeFilename,
  UnpackedContainer,
} from './format.ts';
import { encodePNG, decodePNG } from './png.ts';
import { formatCRC32Hex } from './crc32.ts';

export interface DecodeProgress {
  stage: 'inspecting' | 'unzipping' | 'decoding' | 'reassembling' | 'completed' | 'cancelled';
  currentFile: number;
  totalFiles: number;
  currentFileName: string;
  progress: number; // 0 to 100
  message: string;
  speedBytesPerSec?: number;
  estimatedSecondsRemaining?: number | null;
  elapsedSeconds?: number;
}

export type DecodeProgressCallback =
  | ((progress: DecodeProgress) => void)
  | ((processed: number, total: number, message: string) => void);

export interface EncodeProgress {
  stage: 'idle' | 'hashing' | 'chunking' | 'encoding' | 'completed' | 'cancelled';
  progress: number; // 0 to 100
  currentChunk: number;
  totalChunks: number;
  message: string;
  processedBytes?: number;
  totalBytes?: number;
  speedBytesPerSec?: number;
  estimatedSecondsRemaining?: number | null;
  elapsedSeconds?: number;
}

/**
 * Tracks throughput (bytes/second) and calculates a smoothed dynamic Estimated Time Remaining (ETA)
 */
export class EncodeProgressEstimator {
  private startTime: number;
  private totalFileSize: number;
  private smoothedSpeed: number = 0;
  private smoothedRemainingSeconds: number | null = null;

  constructor(totalFileSize: number) {
    this.startTime = performance.now();
    this.totalFileSize = Math.max(1, totalFileSize);
  }

  public report(
    stage: 'idle' | 'hashing' | 'chunking' | 'encoding' | 'completed' | 'cancelled',
    progress: number,
    currentChunk: number,
    totalChunks: number,
    message: string,
    bytesProcessed: number
  ): EncodeProgress {
    const now = performance.now();
    const elapsedSeconds = Math.max(0.01, (now - this.startTime) / 1000);

    // Throughput speed in bytes per second
    const currentSpeed = bytesProcessed / elapsedSeconds;
    if (this.smoothedSpeed === 0) {
      this.smoothedSpeed = currentSpeed;
    } else {
      this.smoothedSpeed = 0.85 * this.smoothedSpeed + 0.15 * currentSpeed;
    }

    let estimatedSecondsRemaining: number | null = null;
    if (stage === 'completed') {
      estimatedSecondsRemaining = 0;
    } else if (progress >= 3 && progress < 100 && elapsedSeconds >= 0.1) {
      const rawRemaining = elapsedSeconds * ((100 - progress) / progress);
      if (this.smoothedRemainingSeconds === null) {
        this.smoothedRemainingSeconds = rawRemaining;
      } else {
        // Weighted smoothing to avoid abrupt fluctuations
        this.smoothedRemainingSeconds = 0.7 * this.smoothedRemainingSeconds + 0.3 * rawRemaining;
      }
      estimatedSecondsRemaining = Math.max(0, Math.round(this.smoothedRemainingSeconds));
    }

    return {
      stage,
      progress,
      currentChunk,
      totalChunks,
      message,
      processedBytes: Math.min(bytesProcessed, this.totalFileSize),
      totalBytes: this.totalFileSize,
      speedBytesPerSec: Math.round(this.smoothedSpeed),
      estimatedSecondsRemaining,
      elapsedSeconds: Math.round(elapsedSeconds * 10) / 10,
    };
  }
}

export interface EncodedPNGChunk {
  chunkIndex: number;
  totalChunks: number;
  width: number;
  height: number;
  pixelCount: number;
  pngByteLength: number;
  payloadByteLength: number;
  chunkCRC32: number;
  chunkCRC32Hex: string;
  blob: Blob;
  url: string;
  downloadFilename: string;
}

export interface NamingOptions {
  prefix?: string;
  suffix?: string;
  customBaseName?: string;
}

export interface EncodeResult {
  fileId: string;
  originalFilename: string;
  originalFileSize: number;
  wholeFileSHA256: string;
  chunks: EncodedPNGChunk[];
}

export interface DecodedChunkInfo {
  chunkIndex: number;
  totalChunks: number;
  payloadLength: number;
  chunkCRC32: number;
  chunkCRC32Hex: string;
  chunkCRCValid: boolean;
  headerCRCValid: boolean;
  sourceFilename: string;
  unpacked: UnpackedContainer;
}

export interface FileReconstructionGroup {
  fileId: string;
  originalFilename: string;
  originalFileSize: number;
  expectedSHA256: string;
  totalChunks: number;
  receivedChunksCount: number;
  missingChunkIndices: number[];
  duplicateChunkIndices: number[];
  hasCorruptedChunks: boolean;
  isComplete: boolean;
  chunksByIndex: Map<number, DecodedChunkInfo>;
  // Reconstructed file result (only when complete & valid)
  reconstructedBlob?: Blob;
  reconstructedUrl?: string;
  reconstructedSHA256?: string;
  isSHA256Match?: boolean;
  errors: string[];
}

/**
 * Formats a PNG chunk download filename with optional prefix, suffix, and custom base name.
 */
export function formatPNGFilename(
  originalFilename: string,
  chunkIndex: number,
  totalChunks: number,
  prefix: string = '',
  suffix: string = '',
  customBaseName?: string
): string {
  const dotIndex = originalFilename.lastIndexOf('.');
  const defaultBaseName = dotIndex !== -1 ? originalFilename.slice(0, dotIndex) : originalFilename;
  const baseName = (customBaseName?.trim() || defaultBaseName).replace(/[^a-zA-Z0-9_\-]/g, '_');
  const safePrefix = prefix.replace(/[/\\:*?"<>|]/g, '_');
  const safeSuffix = suffix.replace(/[/\\:*?"<>|]/g, '_');

  const combinedName = `${safePrefix}${baseName}${safeSuffix}`;

  if (totalChunks <= 1) {
    return `${combinedName}.pv.png`;
  }
  const padLen = Math.max(3, String(totalChunks).length);
  const partNumStr = String(chunkIndex + 1).padStart(padLen, '0');
  const totalPartsStr = String(totalChunks).padStart(padLen, '0');
  return `${combinedName}.part-${partNumStr}-of-${totalPartsStr}.pv.png`;
}

/**
 * Calculates optimal width and height for a target pixel count.
 * Forms a square or near-square rectangle.
 */
export function calculateOptimalDimensions(totalBytes: number): { width: number; height: number; pixelCount: number } {
  // 3 bytes per pixel (RGB)
  const pixelCount = Math.ceil(totalBytes / 3);
  const width = Math.ceil(Math.sqrt(pixelCount));
  const height = Math.ceil(pixelCount / width);
  return { width, height, pixelCount: width * height };
}

/**
 * Encodes an input file into one or more lossless PNG images.
 * Uses streaming slice reading when file is a File/Blob to seamlessly handle files > 1 GB without OOM.
 */
export async function encodeFileToPNGs(
  file: File | Blob | { name: string; size: number; bytes: Uint8Array },
  targetChunkSizeBytes: number = 8 * 1024 * 1024,
  onProgress?: (progress: EncodeProgress) => void,
  abortSignal?: AbortSignal,
  namingOptions?: NamingOptions
): Promise<EncodeResult> {
  const fileNameStr = 'name' in file ? file.name : 'unnamed_file.bin';
  const originalFilename = sanitizeFilename(fileNameStr);
  const originalFileSize = file.size;
  const estimator = new EncodeProgressEstimator(originalFileSize);

  const isBlobLike = 'slice' in file && typeof (file as Blob).slice === 'function';
  let directBytes: Uint8Array | null = null;
  if ('bytes' in file && file.bytes instanceof Uint8Array) {
    directBytes = file.bytes;
  }

  if (abortSignal?.aborted) {
    throw new Error('Encoding cancelled by user');
  }

  // 1. Calculate Whole-File SHA-256
  onProgress?.(
    estimator.report(
      'hashing',
      2,
      0,
      0,
      originalFileSize > 500 * 1024 * 1024
        ? 'High-Capacity Stream: Hashing large file in 16 MB slices...'
        : 'Computing whole-file SHA-256 digest...',
      0
    )
  );

  let wholeFileSHA256Bytes: Uint8Array;

  if (directBytes) {
    wholeFileSHA256Bytes = await computeSHA256Bytes(directBytes);
    onProgress?.(
      estimator.report(
        'hashing',
        20,
        0,
        0,
        'Computed whole-file SHA-256 digest',
        Math.round(originalFileSize * 0.2)
      )
    );
  } else if (isBlobLike) {
    wholeFileSHA256Bytes = await computeSHA256FileStream(
      file as Blob,
      (hashedBytes, totalBytes, pct) => {
        const progressPct = Math.min(20, Math.round(2 + pct * 0.18));
        const effectiveProcessed = Math.round(hashedBytes * 0.2);
        onProgress?.(
          estimator.report(
            'hashing',
            progressPct,
            0,
            0,
            `Hashing file stream: ${pct}% complete...`,
            effectiveProcessed
          )
        );
      },
      abortSignal
    );
  } else {
    const arrayBuffer = await (file as File).arrayBuffer();
    directBytes = new Uint8Array(arrayBuffer);
    wholeFileSHA256Bytes = await computeSHA256Bytes(directBytes);
    onProgress?.(
      estimator.report(
        'hashing',
        20,
        0,
        0,
        'Computed whole-file SHA-256 digest',
        Math.round(originalFileSize * 0.2)
      )
    );
  }

  const wholeFileSHA256 = bytesToHex(wholeFileSHA256Bytes);

  if (abortSignal?.aborted) {
    throw new Error('Encoding cancelled by user');
  }

  // 2. Determine chunk count
  // Empty file (0 bytes) is encoded as 1 chunk with 0 payload bytes
  const totalChunks = originalFileSize === 0
    ? 1
    : Math.max(1, Math.ceil(originalFileSize / targetChunkSizeBytes));

  const fileId = generateFileId();
  const fileIdHex = bytesToHex(fileId);

  const chunks: EncodedPNGChunk[] = [];

  // 3. Process each chunk
  for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
    if (abortSignal?.aborted) {
      throw new Error('Encoding cancelled by user');
    }

    const startByte = chunkIdx * targetChunkSizeBytes;
    const endByte = Math.min(startByte + targetChunkSizeBytes, originalFileSize);

    const chunkStartPct = Math.round(20 + ((chunkIdx + 0.15) / totalChunks) * 78);
    const chunkProcessedBytes = Math.round(originalFileSize * (0.2 + 0.8 * (chunkIdx / totalChunks)));
    onProgress?.(
      estimator.report(
        'encoding',
        chunkStartPct,
        chunkIdx + 1,
        totalChunks,
        `Packaging and encoding PNG chunk ${chunkIdx + 1} of ${totalChunks}...`,
        chunkProcessedBytes
      )
    );

    // Read chunk slice into memory
    let chunkPayload: Uint8Array;
    if (directBytes) {
      chunkPayload = directBytes.subarray(startByte, endByte);
    } else if (isBlobLike) {
      const sliceBlob = (file as Blob).slice(startByte, endByte);
      const arrayBuffer = await sliceBlob.arrayBuffer();
      chunkPayload = new Uint8Array(arrayBuffer);
    } else {
      chunkPayload = new Uint8Array(0);
    }

    // Pack into container
    const containerBytes = packContainer({
      fileId,
      totalFileSize: originalFileSize,
      wholeFileSHA256Bytes,
      chunkIndex: chunkIdx,
      totalChunks,
      filename: originalFilename,
      payload: chunkPayload,
    });

    // Calculate dimensions
    const { width, height } = calculateOptimalDimensions(containerBytes.length);
    const totalRGBBytes = width * height * 3;

    // Allocate RGB buffer
    const rgbData = new Uint8Array(totalRGBBytes);
    rgbData.set(containerBytes, 0); // Remaining bytes remain 0 (black padding)

    // Encode to standards-compliant PNG
    const pngBytes = encodePNG(width, height, rgbData);

    const blob = new Blob([pngBytes as unknown as BlobPart], { type: 'image/png' });
    const url = URL.createObjectURL(blob);

    const downloadFilename = formatPNGFilename(
      originalFilename,
      chunkIdx,
      totalChunks,
      namingOptions?.prefix ?? '',
      namingOptions?.suffix ?? '',
      namingOptions?.customBaseName
    );

    // Extract payload CRC from container view
    const view = new DataView(containerBytes.buffer, containerBytes.byteOffset, containerBytes.byteLength);
    const crcOffset = containerBytes.length - 4;
    const chunkCRC32 = view.getUint32(crcOffset, false);

    chunks.push({
      chunkIndex: chunkIdx,
      totalChunks,
      width,
      height,
      pixelCount: width * height,
      pngByteLength: pngBytes.length,
      payloadByteLength: chunkPayload.length,
      chunkCRC32,
      chunkCRC32Hex: formatCRC32Hex(chunkCRC32),
      blob,
      url,
      downloadFilename,
    });

    const chunkEndPct = Math.round(20 + ((chunkIdx + 1) / totalChunks) * 78);
    const chunkEndProcessedBytes = Math.round(originalFileSize * (0.2 + 0.8 * ((chunkIdx + 1) / totalChunks)));
    onProgress?.(
      estimator.report(
        'encoding',
        chunkEndPct,
        chunkIdx + 1,
        totalChunks,
        `Completed PNG chunk ${chunkIdx + 1} of ${totalChunks}`,
        chunkEndProcessedBytes
      )
    );
  }

  onProgress?.(
    estimator.report(
      'completed',
      100,
      totalChunks,
      totalChunks,
      `Successfully encoded into ${totalChunks} PNG ${totalChunks === 1 ? 'image' : 'images'}!`,
      originalFileSize
    )
  );

  return {
    fileId: fileIdHex,
    originalFilename,
    originalFileSize,
    wholeFileSHA256,
    chunks,
  };
}

/**
 * Unzips an in-memory ZIP archive buffer and extracts all authentic PNG files contained inside.
 * Allows decoding directly from ZIP archives without prior decompressing on device.
 */
export function extractPNGsFromZip(zipBytes: Uint8Array): Array<{ name: string; bytes: Uint8Array }> {
  if (zipBytes.length < 4 || zipBytes[0] !== 0x50 || zipBytes[1] !== 0x4b) {
    return [];
  }

  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = fflate.unzipSync(zipBytes);
  } catch (err) {
    console.error('Failed to unpack zip archive:', err);
    return [];
  }

  const extractedPNGs: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const [filename, fileData] of Object.entries(unzipped)) {
    if (fileData.length < 8) continue;
    // Verify 8-byte PNG signature: 137, 80, 78, 71, 13, 10, 26, 10
    if (
      fileData[0] === 137 &&
      fileData[1] === 80 &&
      fileData[2] === 78 &&
      fileData[3] === 71 &&
      fileData[4] === 13 &&
      fileData[5] === 10 &&
      fileData[6] === 26 &&
      fileData[7] === 10
    ) {
      const cleanName = filename.replace(/\\/g, '/').split('/').pop() || filename;
      extractedPNGs.push({
        name: cleanName,
        bytes: fileData,
      });
    }
  }

  return extractedPNGs;
}

/**
 * Decodes a collection of uploaded PNG files, verifies container headers and CRCs,
 * tracks missing/duplicate chunks, and reassembles complete files with low-memory streaming.
 * Yields to the UI event loop between files to eliminate UI freezing, and computes dynamic throughput/ETA.
 */
export async function decodePNGFiles(
  pngInputs: Array<{ name: string; bytes: Uint8Array }>,
  onProgress?: DecodeProgressCallback,
  abortSignal?: AbortSignal
): Promise<FileReconstructionGroup[]> {
  const groupsMap = new Map<string, FileReconstructionGroup>();
  const total = pngInputs.length;
  const startTime = performance.now();
  let totalProcessedBytes = 0;

  const notifyProgress = (p: DecodeProgress) => {
    if (!onProgress) return;
    if (onProgress.length >= 3) {
      (onProgress as (c: number, t: number, m: string) => void)(p.currentFile, p.totalFiles, p.message);
    } else {
      (onProgress as (prog: DecodeProgress) => void)(p);
    }
  };

  for (let i = 0; i < total; i++) {
    if (abortSignal?.aborted) {
      throw new Error('Decoding cancelled by user');
    }

    const input = pngInputs[i];
    const now = performance.now();
    const elapsed = Math.max(0.01, (now - startTime) / 1000);
    const progressPct = Math.round((i / total) * 90);
    const speed = totalProcessedBytes / elapsed;
    const remainingTime = i > 0 ? Math.max(0, Math.round((elapsed / i) * (total - i))) : null;

    notifyProgress({
      stage: 'decoding',
      currentFile: i + 1,
      totalFiles: total,
      currentFileName: input.name,
      progress: progressPct,
      message: `Decoding and inspecting chunk ${i + 1} of ${total}: ${input.name}`,
      speedBytesPerSec: Math.round(speed),
      estimatedSecondsRemaining: remainingTime,
      elapsedSeconds: Math.round(elapsed * 10) / 10,
    });

    // Yield to the browser event loop so UI paints and GC can run
    await new Promise((resolve) => setTimeout(resolve, 0));

    let rawRGB: Uint8Array;
    try {
      const decodedPNG = decodePNG(input.bytes);
      rawRGB = decodedPNG.rgbData;
    } catch (err) {
      console.error(`Failed to decode PNG ${input.name}:`, err);
      totalProcessedBytes += input.bytes.byteLength;
      continue;
    }

    let unpacked: UnpackedContainer;
    try {
      unpacked = unpackContainer(rawRGB);
    } catch (err) {
      console.warn(`File ${input.name} is not a valid PixelVault container:`, err);
      totalProcessedBytes += input.bytes.byteLength;
      continue;
    }

    totalProcessedBytes += input.bytes.byteLength;

    const { header, chunkCRC32, chunkCRCValid, headerCRCValid } = unpacked;
    const fileId = header.fileId;

    if (!groupsMap.has(fileId)) {
      groupsMap.set(fileId, {
        fileId,
        originalFilename: header.filename,
        originalFileSize: header.totalFileSize,
        expectedSHA256: header.wholeFileSHA256,
        totalChunks: header.totalChunks,
        receivedChunksCount: 0,
        missingChunkIndices: [],
        duplicateChunkIndices: [],
        hasCorruptedChunks: false,
        isComplete: false,
        chunksByIndex: new Map<number, DecodedChunkInfo>(),
        errors: [],
      });
    }

    const group = groupsMap.get(fileId)!;

    if (group.chunksByIndex.has(header.chunkIndex)) {
      if (!group.duplicateChunkIndices.includes(header.chunkIndex)) {
        group.duplicateChunkIndices.push(header.chunkIndex);
      }
    } else {
      group.chunksByIndex.set(header.chunkIndex, {
        chunkIndex: header.chunkIndex,
        totalChunks: header.totalChunks,
        payloadLength: header.chunkPayloadLength,
        chunkCRC32,
        chunkCRC32Hex: formatCRC32Hex(chunkCRC32),
        chunkCRCValid,
        headerCRCValid,
        sourceFilename: input.name,
        unpacked,
      });
      group.receivedChunksCount = group.chunksByIndex.size;

      if (!chunkCRCValid || !headerCRCValid) {
        group.hasCorruptedChunks = true;
        group.errors.push(
          `Chunk #${header.chunkIndex + 1} (${input.name}) failed integrity CRC-32 check.`
        );
      }
    }

    // Yield again for responsive UI update
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // Finalize each group: calculate missing chunks and reassemble if complete
  const results: FileReconstructionGroup[] = [];

  for (const group of groupsMap.values()) {
    if (abortSignal?.aborted) {
      throw new Error('Decoding cancelled by user');
    }

    const missing: number[] = [];
    for (let c = 0; c < group.totalChunks; c++) {
      if (!group.chunksByIndex.has(c)) {
        missing.push(c);
      }
    }
    group.missingChunkIndices = missing;
    group.isComplete = missing.length === 0 && !group.hasCorruptedChunks;

    if (group.isComplete) {
      const now = performance.now();
      const elapsed = Math.max(0.01, (now - startTime) / 1000);
      notifyProgress({
        stage: 'reassembling',
        currentFile: total,
        totalFiles: total,
        currentFileName: group.originalFilename,
        progress: 95,
        message: `Reassembling ${group.originalFilename} and verifying SHA-256...`,
        speedBytesPerSec: Math.round(totalProcessedBytes / elapsed),
        estimatedSecondsRemaining: 1,
        elapsedSeconds: Math.round(elapsed * 10) / 10,
      });

      // Yield before hashing
      await new Promise((resolve) => setTimeout(resolve, 0));

      const parts: BlobPart[] = [];
      let totalReconstructed = 0;

      for (let c = 0; c < group.totalChunks; c++) {
        const chunkInfo = group.chunksByIndex.get(c)!;
        const payload = chunkInfo.unpacked.payload;
        parts.push(payload as unknown as BlobPart);
        totalReconstructed += payload.length;
      }

      if (totalReconstructed !== group.originalFileSize) {
        group.errors.push(
          `Reconstructed size mismatch: expected ${group.originalFileSize} bytes, got ${totalReconstructed} bytes.`
        );
        group.isComplete = false;
      } else {
        const reconstructedBlob = new Blob(parts, { type: 'application/octet-stream' });
        // Stream compute SHA-256 over reconstructed Blob (handles >1GB safely)
        const actualSHA256Bytes = await computeSHA256FileStream(reconstructedBlob, undefined, abortSignal);
        const actualSHA256 = bytesToHex(actualSHA256Bytes);
        group.reconstructedSHA256 = actualSHA256;
        group.isSHA256Match = actualSHA256.toLowerCase() === group.expectedSHA256.toLowerCase();

        if (group.isSHA256Match) {
          group.reconstructedBlob = reconstructedBlob;
          group.reconstructedUrl = URL.createObjectURL(reconstructedBlob);
        } else {
          group.errors.push(
            `Whole-file SHA-256 digest mismatch! (Expected: ${group.expectedSHA256}, Actual: ${actualSHA256})`
          );
        }
      }
    }

    results.push(group);
  }

  const finalElapsed = Math.max(0.01, (performance.now() - startTime) / 1000);
  notifyProgress({
    stage: 'completed',
    currentFile: total,
    totalFiles: total,
    currentFileName: '',
    progress: 100,
    message: `Decoding & verification complete!`,
    speedBytesPerSec: Math.round(totalProcessedBytes / finalElapsed),
    estimatedSecondsRemaining: 0,
    elapsedSeconds: Math.round(finalElapsed * 10) / 10,
  });

  return results;
}

/**
 * Revokes an array of Object URLs to free memory.
 */
export function revokeURLs(urls: (string | undefined)[]): void {
  for (const url of urls) {
    if (url && url.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore revocation errors
      }
    }
  }
}
