# PixelVault — Lossless File-to-PNG Converter

PixelVault is a local-first, zero-backend web application that encapsulates arbitrary binary files into genuine, standards-compliant lossless PNG images and reconstructs the exact original files with bit-for-bit fidelity.

Every generated PNG embeds a versioned cryptographic container format in its RGB pixel stream, complete with Header CRC-32, Chunk Payload CRC-32, and Whole-File SHA-256 integrity verification.

Build with Google AI Studio
---

## Key Features

- **100% Client-Side & Local-First**: Zero backend, zero telemetry, zero analytics, zero external network requests.
- **Genuine RFC 2083 PNG Images**: Directly decodable by standard image software, desktop image viewers, and file explorers.
- **Bypasses Canvas Color Drift**: Uses a deterministic pure-TypeScript PNG encoder and decoder with DEFLATE (`fflate`), avoiding HTML Canvas gamma, sRGB color profile, and premultiplied-alpha alterations.
- **Self-Contained Container Metadata**: No external manifest file needed. The container embeds original filename, file size, File ID, whole-file SHA-256, chunk index, and total chunk count in the pixel stream.
- **Multi-Chunk Splitting & Reassembly**: Automatically splits files across multiple PNG images based on user-configurable chunk size presets from 2 MB up to 512 MB per image.
- **Batch Rename & Filename Customization**: Add custom prefixes and suffixes (e.g., `backup_`, `_2026`) or override base names before downloading, with real-time filename preview and ZIP bundle support. Renaming is 100% safe as the true filename is embedded in the binary container header.
- **High-Capacity Streaming Mode (>1 GB Files)**: Processes multi-gigabyte files (1 GB, 2 GB+) in low-memory 16 MB slices with an incremental FIPS 180-4 streaming SHA-256 hash engine, preventing browser tab memory crashes.
- **Direct ZIP Bundle Drag & Drop**: Drop raw `.zip` archives directly into the Decode tab. PixelVault unpacks the ZIP in-memory using `fflate` and immediately stages the embedded PNG chunks without requiring manual decompression on your filesystem.
- **Staged Upload & Non-Blocking Decode Pipeline**: Separates file ingestion from decoding. Files are staged in an interactive queue where items can be inspected, filtered, or added before launching. Decode execution yields to the browser event loop between chunks, keeping the UI responsive with real-time throughput (MB/s), live ETA countdown, and instant cancellation.
- **Out-of-Order & Duplicate Resilience**: The decoder ledger reassembles chunks regardless of drop order, identifies missing chunks, rejects duplicate uploads, and detects corrupted bytes.
- **Cryptographic Tamper Detection**: Distinguishes corruption detection from repair. Fails securely and refuses to return corrupted or incomplete files.
- **Interactive In-Browser Test Lab**: Live test runner in the web UI running 13 automated test suites.
- **CLI Test Suite**: Automated test suite executable with `npm test`.

---

## Getting Started

### Prerequisites
- Node.js (v18 or higher recommended; developed on Node v22)
- npm (v9 or higher)

### Installation
Clone or navigate to the repository directory and install dependencies:
```bash
npm install
```

### Running the Development Server
```bash
npm run dev
```
Open your browser and navigate to `http://localhost:3000`.

### Building for Production
```bash
npm run build
```

### Running Automated Tests
Run the comprehensive 10-suite automated test matrix via CLI:
```bash
npm test
```
Or open the **Test Lab** tab directly within the running web application to run the test suite inside your browser.

---

## Binary Container Format Specification (Version 1)

Every PixelVault PNG image stores an 86-byte fixed header followed by variable metadata, payload, and a payload CRC-32 directly inside the 8-bit RGB pixel stream.

### Byte Layout (Big-Endian)

| Byte Offset | Length | Field Name | Data Type | Description |
|---|---|---|---|---|
| `0x00..0x07` | 8 bytes | **Magic Signature** | `uint8[8]` | ASCII `"PIXELVLT"` (`0x50 0x49 0x58 0x45 0x4C 0x56 0x4C 0x54`) |
| `0x08` | 1 byte | **Format Version** | `uint8` | Container version (`0x01`) |
| `0x09..0x0B` | 3 bytes | **Reserved / Flags** | `uint8[3]` | Reserved for future extensions (all zeroes: `0x00 0x00 0x00`) |
| `0x0C..0x1B` | 16 bytes | **File ID** | `uint8[16]` | 128-bit unique identifier linking chunks of the same file |
| `0x1C..0x23` | 8 bytes | **Total File Size** | `uint64 BE` | Total size of the original unchunked file in bytes |
| `0x24..0x43` | 32 bytes | **Whole-File SHA-256** | `uint8[32]` | SHA-256 cryptographic digest of the complete original file |
| `0x44..0x47` | 4 bytes | **Chunk Index** | `uint32 BE` | 0-indexed position of this chunk (`0` to `Total Chunks - 1`) |
| `0x48..0x4B` | 4 bytes | **Total Chunks** | `uint32 BE` | Total number of chunks required to reconstruct the file |
| `0x4C..0x4D` | 2 bytes | **Filename Length ($L_n$)** | `uint16 BE` | Byte length of the UTF-8 encoded original filename |
| `0x4E..0x51` | 4 bytes | **Payload Length ($L_p$)** | `uint32 BE` | Byte length of the raw file slice in this chunk |
| `0x52..0x55` | 4 bytes | **Header CRC-32** | `uint32 BE` | IEEE 802.3 CRC-32 computed over bytes `0x00..0x51` |
| `0x56..(0x56+Ln-1)` | $L_n$ bytes | **Original Filename** | UTF-8 String | Sanitized filename of the original file |
| `(0x56+Ln)..(0x56+Ln+Lp-1)` | $L_p$ bytes | **Chunk Payload** | Binary | Raw data slice of the original file |
| `(0x56+Ln+Lp)..(0x56+Ln+Lp+3)` | 4 bytes | **Payload CRC-32** | `uint32 BE` | IEEE 802.3 CRC-32 computed exclusively over the Chunk Payload |

### Pixel Mapping & Alignment Rules
1. **Total Container Bytes**: $L_{\text{container}} = 86 + L_n + L_p + 4$.
2. **RGB Mapping**: Bytes are mapped into pixel components sequentially:
   - `Pixel[0] = { R: Byte[0], G: Byte[1], B: Byte[2], A: 255 }`
   - `Pixel[1] = { R: Byte[3], G: Byte[4], B: Byte[5], A: 255 }`
3. **Byte Padding**: If $L_{\text{container}} \pmod 3 \neq 0$, 1 or 2 zero bytes (`0x00`) are appended so every pixel has complete RGB channels.
4. **Image Geometry**:
   $$P = \lceil L_{\text{container}} / 3 \rceil, \quad W = \lceil \sqrt{P} \rceil, \quad H = \lceil P / W \rceil$$
5. **Geometric Padding**: Any remaining pixels in the $W \times H$ rectangle are filled with black opaque pixels (`[0, 0, 0, 255]`).
6. **Decoder Truncation Safety**: Decoders read only the exact $L_p$ payload bytes designated in the validated header; all alignment and geometric padding is strictly ignored.

---

## Defensive Security & Integrity Model

- **Untrusted Input**: All uploaded PNG files are treated as hostile, untrusted binary data.
- **Double CRC-32 Verification**:
  1. *Header CRC-32*: Verified before parsing variable-length filenames or allocating memory buffers. Corrupted headers or manipulated length fields fail immediately without allocating large buffers.
  2. *Chunk Payload CRC-32*: Verified against the extracted slice to detect any altered or missing pixels.
- **Whole-File SHA-256 Verification**: Before offering a reconstructed file for download, PixelVault verifies that the full reassembled byte stream exactly matches the 256-bit SHA-256 digest embedded in the header.
- **Safe Filename Sanitization**: Filenames are sanitized to prevent directory traversal (`../`, `\`, `/`), null byte injection, and dangerous control characters.
- **No In-Browser Execution**: Embedded files are never executed, evaluated, or rendered as active scripts/HTML.
- **Object URL Lifecycle Management**: URLs created via `URL.createObjectURL` are automatically revoked upon file changes, downloads, and unmounts to prevent browser memory leaks.
- **No False Claims**: SHA-256 and CRC-32 detect corruption; they do **not** repair or error-correct corrupted pixels. Lossy recompression (e.g. uploading to social media platforms that recompress images to JPEG/WebP) will permanently alter RGB values and cause integrity checks to fail.

---

## Automated Test Coverage

The automated test suite (`npm test` and the in-app Test Lab) covers 13 critical scenarios:
1. **Empty File Test (0 bytes)**: Tests 0-byte file serialization, 1-chunk PNG wrapping, and reconstruction with matching empty SHA-256.
2. **Very Small Files (1 to 2 bytes)**: Tests sub-pixel payloads that do not fill a single 3-byte RGB pixel.
3. **RGB Pixel Boundary Alignment (1, 2, 3, 4, 5, 6, 7 bytes)**: Tests payloads crossing 3-byte pixel boundaries.
4. **All Byte Values (0x00 to 0xFF)**: Verifies that all 256 possible 8-bit byte values round-trip losslessly.
5. **High-Entropy Random Binary (100 KB)**: Verifies dense, incompressible binary streams through DEFLATE scanlines.
6. **Multi-Chunk Splitting & Reassembly**: Splits 60 KB across 4 chunks and verifies bitwise reassembly.
7. **Shuffled Chunks**: Verifies that chunks supplied in reverse or random order are assembled accurately.
8. **Missing & Duplicate Chunks**: Detects missing chunk indices and ignores duplicates without errors.
9. **Tamper & Corruption Detection**: Verifies that modified header bytes, modified payload pixels, and hash mismatches are cleanly caught.
10. **Real-World File Signatures**: Verifies round-trip integrity on ZIP archives, PDF documents, and JPEG images.
11. **Batch Rename & Filename Formatting**: Verifies custom prefix, suffix, and sanitized base name generation across single and multi-chunk outputs.
12. **High-Capacity Streaming SHA-256 Parity**: Verifies that FIPS 180-4 streaming block hash produces bit-exact match with Web Crypto across irregular byte slices.
13. **Direct ZIP Bundle In-Memory Extraction**: Verifies in-memory unpacking of ZIP archives containing PixelVault PNG chunks and exact byte-for-byte file reconstruction.

---

## Known Limitations & Best Practices

1. **Social Media & Lossy Platforms**: Do not upload PixelVault PNGs to platforms that strip metadata or re-encode images to lossy formats (JPEG/WebP/AVIF). Lossy recompression alters pixel values, permanently destroying the embedded data.
2. **Chunk Size Selection**:
   - **2 MB - 32 MB**: Ideal for fast processing, lower-memory devices, and mobile browsers.
   - **64 MB - 128 MB**: Recommended for desktop browsers to minimize total PNG count on large files (e.g. 500 MB = ~4-8 images).
   - **256 MB - 512 MB**: Generates extreme-density images (>9,000 x 9,000 pixels). Requires desktop system with 8 GB+ RAM.
3. **Handling Files > 1 GB**: PixelVault includes an automatic **High-Capacity Stream Mode** that processes files via 16 MB chunk slicing and incremental streaming SHA-256. This avoids loading the entire multi-gigabyte file into memory at once, enabling successful encoding and decoding on standard modern browsers.
4. **Incompressible Files**: Files that are already compressed (ZIP, MP4, MP3, 7z) cannot be compressed further by PNG DEFLATE, resulting in PNG files slightly larger than the raw bytes due to container headers and RGB pixel alignment.

---

## License

Apache-2.0
