/**
 * Standard IEEE 802.3 CRC-32 implementation
 * Polynomial: 0xEDB88320 (reversed representation of 0x04C11DB7)
 */

// Precomputed CRC-32 lookup table for performance
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i >>> 0;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

/**
 * Calculates the standard IEEE 802.3 CRC-32 checksum of a byte buffer.
 * @param buffer Uint8Array or ArrayBufferView
 * @param previousCRC Optional previous CRC for incremental chunked calculation
 * @returns 32-bit unsigned integer
 */
export function calculateCRC32(
  buffer: Uint8Array,
  previousCRC: number = 0
): number {
  let crc = (previousCRC ^ -1) >>> 0;
  const len = buffer.length;
  for (let i = 0; i < len; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

/**
 * Formats a 32-bit unsigned CRC as an 8-character uppercase hex string (e.g. "A1B2C3D4").
 */
export function formatCRC32Hex(crc: number): string {
  return (crc >>> 0).toString(16).padStart(8, '0').toUpperCase();
}
