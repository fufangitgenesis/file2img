/**
 * Lossless RFC 2083 PNG Encoder and Decoder
 * Operates purely on binary buffers with 100% deterministic pixel extraction.
 * Bypasses HTML Canvas color-space / gamma shifts.
 */

import * as fflate from 'fflate';
import { calculateCRC32 } from './crc32.ts';

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

export interface PNGImage {
  width: number;
  height: number;
  rgbData: Uint8Array; // Exactly width * height * 3 bytes of raw RGB data
}

/**
 * Creates a PNG chunk with length, type, data, and CRC-32.
 */
function createChunk(typeStr: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(typeStr);
  const chunkLength = data.length;
  const chunk = new Uint8Array(4 + 4 + chunkLength + 4);
  const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);

  // 1. Length (4 bytes)
  view.setUint32(0, chunkLength, false);

  // 2. Type (4 bytes)
  chunk.set(typeBytes, 4);

  // 3. Data
  chunk.set(data, 8);

  // 4. CRC-32 over Type + Data
  const typeAndData = chunk.subarray(4, 8 + chunkLength);
  const crc = calculateCRC32(typeAndData);
  view.setUint32(8 + chunkLength, crc, false);

  return chunk;
}

/**
 * Encodes an RGB buffer into a genuine, standards-compliant PNG file.
 * @param width Image width in pixels
 * @param height Image height in pixels
 * @param rgbData Raw RGB pixel data (length must equal width * height * 3)
 * @returns Complete binary PNG as Uint8Array
 */
export function encodePNG(width: number, height: number, rgbData: Uint8Array): Uint8Array {
  const expectedRGBSize = width * height * 3;
  if (rgbData.length !== expectedRGBSize) {
    throw new Error(
      `RGB data size (${rgbData.length}) does not match dimensions ${width}x${height}*3 (${expectedRGBSize})`
    );
  }

  // 1. Build IHDR (13 bytes)
  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer, ihdrData.byteOffset, 13);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdrData[8] = 8; // Bit depth: 8 bits per channel
  ihdrData[9] = 2; // Color type: 2 (Truecolor RGB, 3 bytes per pixel)
  ihdrData[10] = 0; // Compression: 0 (deflate)
  ihdrData[11] = 0; // Filter method: 0 (standard adaptive filter)
  ihdrData[12] = 0; // Interlace: 0 (no interlace)

  const ihdrChunk = createChunk('IHDR', ihdrData);

  // 2. Prepare uncompressed scanlines
  // Each scanline has 1 filter byte (0 = None) followed by width * 3 bytes of RGB
  const bytesPerRow = width * 3;
  const scanlines = new Uint8Array(height * (1 + bytesPerRow));

  for (let y = 0; y < height; y++) {
    const scanlineOffset = y * (1 + bytesPerRow);
    scanlines[scanlineOffset] = 0; // Filter: 0 (None)
    const srcOffset = y * bytesPerRow;
    scanlines.set(rgbData.subarray(srcOffset, srcOffset + bytesPerRow), scanlineOffset + 1);
  }

  // 3. Compress scanlines using DEFLATE (level 6 balances speed and compression)
  const compressed = fflate.deflateSync(scanlines, { level: 6 });
  const idatChunk = createChunk('IDAT', compressed);

  // 4. Build IEND
  const iendChunk = createChunk('IEND', new Uint8Array(0));

  // 5. Combine PNG Signature + IHDR + IDAT + IEND
  const totalLength = PNG_SIGNATURE.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const pngBytes = new Uint8Array(totalLength);

  let offset = 0;
  pngBytes.set(PNG_SIGNATURE, offset);
  offset += PNG_SIGNATURE.length;

  pngBytes.set(ihdrChunk, offset);
  offset += ihdrChunk.length;

  pngBytes.set(idatChunk, offset);
  offset += idatChunk.length;

  pngBytes.set(iendChunk, offset);

  return pngBytes;
}

/**
 * Decodes a PNG byte array and extracts exact raw RGB pixels.
 * Supports Color Type 2 (RGB) and Color Type 6 (RGBA), with full scanline un-filtering.
 */
export function decodePNG(pngBytes: Uint8Array): PNGImage {
  if (pngBytes.length < 8) {
    throw new Error('File too small to be a PNG');
  }

  // 1. Verify PNG Signature
  for (let i = 0; i < 8; i++) {
    if (pngBytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error('Invalid PNG signature. Input is not a valid PNG file');
    }
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let compressionMethod = 0;
  let filterMethod = 0;
  let interlaceMethod = 0;

  const idatChunks: Uint8Array[] = [];
  let totalIdatLength = 0;
  const view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);

  while (offset < pngBytes.length) {
    if (offset + 8 > pngBytes.length) {
      throw new Error('Truncated PNG chunk header');
    }

    const chunkLength = view.getUint32(offset, false);
    offset += 4;

    const typeStr = String.fromCharCode(
      pngBytes[offset],
      pngBytes[offset + 1],
      pngBytes[offset + 2],
      pngBytes[offset + 3]
    );
    offset += 4;

    if (offset + chunkLength + 4 > pngBytes.length) {
      throw new Error(`Truncated PNG chunk ${typeStr}`);
    }

    const chunkData = pngBytes.subarray(offset, offset + chunkLength);
    offset += chunkLength;

    // Verify Chunk CRC
    const expectedCRC = view.getUint32(offset, false);
    offset += 4;

    const typeAndData = pngBytes.subarray(offset - 4 - chunkLength - 4, offset - 4);
    const computedCRC = calculateCRC32(typeAndData);
    if (expectedCRC !== computedCRC) {
      throw new Error(`PNG CRC-32 error in chunk ${typeStr}`);
    }

    if (typeStr === 'IHDR') {
      const ihdrView = new DataView(chunkData.buffer, chunkData.byteOffset, chunkData.byteLength);
      width = ihdrView.getUint32(0, false);
      height = ihdrView.getUint32(4, false);
      bitDepth = chunkData[8];
      colorType = chunkData[9];
      compressionMethod = chunkData[10];
      filterMethod = chunkData[11];
      interlaceMethod = chunkData[12];

      if (bitDepth !== 8) {
        throw new Error(`Unsupported PNG bit depth: ${bitDepth}. Expected 8-bit.`);
      }
      if (colorType !== 2 && colorType !== 6) {
        throw new Error(`Unsupported PNG color type: ${colorType}. Expected RGB (2) or RGBA (6).`);
      }
      if (interlaceMethod !== 0) {
        throw new Error('Interlaced PNGs are not supported.');
      }
    } else if (typeStr === 'IDAT') {
      idatChunks.push(chunkData);
      totalIdatLength += chunkData.length;
    } else if (typeStr === 'IEND') {
      break;
    }
  }

  if (width === 0 || height === 0) {
    throw new Error('Missing or invalid IHDR chunk in PNG');
  }
  if (idatChunks.length === 0) {
    throw new Error('Missing IDAT image data in PNG');
  }

  // Concatenate all IDAT chunks
  let allIdat: Uint8Array;
  if (idatChunks.length === 1) {
    allIdat = idatChunks[0];
  } else {
    allIdat = new Uint8Array(totalIdatLength);
    let cur = 0;
    for (const chunk of idatChunks) {
      allIdat.set(chunk, cur);
      cur += chunk.length;
    }
  }

  // Decompress scanlines
  let inflated: Uint8Array;
  try {
    inflated = fflate.inflateSync(allIdat);
  } catch (err) {
    throw new Error(`Corrupted PNG compressed stream: ${(err as Error).message}`);
  }

  const bpp = colorType === 6 ? 4 : 3; // Bytes per pixel in uncompressed scanline
  const rowBytes = width * bpp;
  const expectedScanlinesLength = height * (1 + rowBytes);

  if (inflated.length < expectedScanlinesLength) {
    throw new Error(`Incomplete scanlines: got ${inflated.length}, expected ${expectedScanlinesLength}`);
  }

  // Unfilter scanlines according to RFC 2083
  const rawPixelData = new Uint8Array(height * rowBytes);
  let prevRow: Uint8Array | null = null;

  for (let y = 0; y < height; y++) {
    const scanlineOffset = y * (1 + rowBytes);
    const filterType = inflated[scanlineOffset];
    const currentRow = rawPixelData.subarray(y * rowBytes, (y + 1) * rowBytes);

    for (let x = 0; x < rowBytes; x++) {
      const rawByte = inflated[scanlineOffset + 1 + x];
      const a = x >= bpp ? currentRow[x - bpp] : 0;
      const b = prevRow ? prevRow[x] : 0;
      const c = (prevRow && x >= bpp) ? prevRow[x - bpp] : 0;

      let val = 0;
      switch (filterType) {
        case 0: // None
          val = rawByte;
          break;
        case 1: // Sub
          val = (rawByte + a) & 0xff;
          break;
        case 2: // Up
          val = (rawByte + b) & 0xff;
          break;
        case 3: // Average
          val = (rawByte + Math.floor((a + b) / 2)) & 0xff;
          break;
        case 4: { // Paeth
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          let pr = 0;
          if (pa <= pb && pa <= pc) pr = a;
          else if (pb <= pc) pr = b;
          else pr = c;
          val = (rawByte + pr) & 0xff;
          break;
        }
        default:
          throw new Error(`Invalid PNG filter type ${filterType} at row ${y}`);
      }

      currentRow[x] = val;
    }

    prevRow = currentRow;
  }

  // If already Color Type 2 (RGB), return directly
  if (colorType === 2) {
    return {
      width,
      height,
      rgbData: rawPixelData,
    };
  }

  // If Color Type 6 (RGBA), strip the alpha channel to obtain raw RGB
  const rgbData = new Uint8Array(width * height * 3);
  const totalPixels = width * height;
  for (let i = 0; i < totalPixels; i++) {
    rgbData[i * 3] = rawPixelData[i * 4];
    rgbData[i * 3 + 1] = rawPixelData[i * 4 + 1];
    rgbData[i * 3 + 2] = rawPixelData[i * 4 + 2];
  }

  return {
    width,
    height,
    rgbData,
  };
}
