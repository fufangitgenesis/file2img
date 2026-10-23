import React from 'react';
import { X, CheckCircle, Database, Lock, Layers } from 'lucide-react';
import { FIXED_HEADER_SIZE, CURRENT_VERSION } from '../lib/format.ts';

interface FormatSpecModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FormatSpecModal: React.FC<FormatSpecModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">PixelVault Container Specification</h2>
              <p className="text-xs text-slate-400">
                Binary Layout Specification v{CURRENT_VERSION} (RFC 2083 Standard Compliant)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 text-slate-300 text-sm">
          {/* Summary */}
          <div className="bg-slate-950/50 rounded-xl p-4 border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 text-indigo-400 font-semibold text-sm">
              <Database className="w-4 h-4" />
              <span>Container Philosophy</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              PixelVault encapsulates arbitrary files directly into lossless PNG RGB pixel buffers.
              Bytes are represented as 8-bit RGB channels with fully opaque alpha (A=255).
              The format is self-contained: any RFC 2083-compliant PNG decoder can extract the raw pixel stream
              and reconstruct the original file without an external manifest.
            </p>
          </div>

          {/* Byte Layout Table */}
          <div>
            <h3 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
              <span>Fixed Header Layout ({FIXED_HEADER_SIZE} Bytes, Big-Endian)</span>
            </h3>
            <div className="overflow-x-auto border border-slate-800 rounded-xl">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-800/80 text-slate-300 uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3">Offset</th>
                    <th className="py-2.5 px-3">Length</th>
                    <th className="py-2.5 px-3">Field</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-400">
                  <tr className="hover:bg-slate-800/30">
                    <td className="py-2 px-3 text-indigo-400">0x00..0x07</td>
                    <td className="py-2 px-3">8 B</td>
                    <td className="py-2 px-3 font-semibold text-slate-200">Magic Signature</td>
                    <td className="py-2 px-3">ASCII</td>
                    <td className="py-2 px-3">`PIXELVLT` (0x50 0x49 0x58 0x45 0x4C 0x56 0x4C 0x54)</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30">
                    <td className="py-2 px-3 text-indigo-400">0x08</td>
                    <td className="py-2 px-3">1 B</td>
                    <td className="py-2 px-3 font-semibold text-slate-200">Version</td>
                    <td className="py-2 px-3">uint8</td>
                    <td className="py-2 px-3">Format specification version (0x01)</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30">
                    <td className="py-2 px-3 text-indigo-400">0x09..0x0B</td>
                    <td className="py-2 px-3">3 B</td>
                    <td className="py-2 px-3 font-semibold text-slate-200">Reserved / Flags</td>
                    <td className="py-2 px-3">uint8[3]</td>
                    <td className="py-2 px-3">Reserved for future flags (zeroed)</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30">
                    <td className="py-2 px-3 text-indigo-400">0x0C..0x1B</td>
                    <td className="py-2 px-3">16 B</td>
                    <td className="py-2 px-3 font-semibold text-slate-200">File Identifier</td>
                    <td className="py-2 px-3">uint8[16]</td>
                    <td className="py-2 px-3">128-bit UUID linking multi-chunk PNGs</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30">
                    <td className="py-2 px-3 text-indigo-400">0x1C..0x23</td>
                    <td className="py-2 px-3">8 B</td>
                    <td className="py-2 px-3 font-semibold text-slate-200">Original File Size</td>
                    <td className="py-2 px-3">uint64 BE</td>
                    <td className="py-2 px-3">Total byte size of the reconstructed file</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30">
                    <td className="py-2 px-3 text-indigo-400">0x24..0x43</td>
                    <td className="py-2 px-3">32 B</td>
                    <td className="py-2 px-3 font-semibold text-slate-200">Whole-File SHA-256</td>
                    <td className="py-2 px-3">uint8[32]</td>
                    <td className="py-2 px-3">Cryptographic hash of the complete original file</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30">
                    <td className="py-2 px-3 text-indigo-400">0x44..0x47</td>
                    <td className="py-2 px-3">4 B</td>
                    <td className="py-2 px-3 font-semibold text-slate-200">Chunk Index</td>
                    <td className="py-2 px-3">uint32 BE</td>
                    <td className="py-2 px-3">0-indexed position (0 .. Total Chunks - 1)</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30">
                    <td className="py-2 px-3 text-indigo-400">0x48..0x4B</td>
                    <td className="py-2 px-3">4 B</td>
                    <td className="py-2 px-3 font-semibold text-slate-200">Total Chunks</td>
                    <td className="py-2 px-3">uint32 BE</td>
                    <td className="py-2 px-3">Total PNG image count for this file</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30">
                    <td className="py-2 px-3 text-indigo-400">0x4C..0x4D</td>
                    <td className="py-2 px-3">2 B</td>
                    <td className="py-2 px-3 font-semibold text-slate-200">Filename Length (Ln)</td>
                    <td className="py-2 px-3">uint16 BE</td>
                    <td className="py-2 px-3">UTF-8 filename byte count (max 1024 B)</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30">
                    <td className="py-2 px-3 text-indigo-400">0x4E..0x51</td>
                    <td className="py-2 px-3">4 B</td>
                    <td className="py-2 px-3 font-semibold text-slate-200">Payload Length (Lp)</td>
                    <td className="py-2 px-3">uint32 BE</td>
                    <td className="py-2 px-3">Byte count of this chunk's payload slice (up to 512 MB)</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30 bg-indigo-950/20">
                    <td className="py-2 px-3 text-indigo-400 font-bold">0x52..0x55</td>
                    <td className="py-2 px-3">4 B</td>
                    <td className="py-2 px-3 font-semibold text-indigo-300">Header CRC-32</td>
                    <td className="py-2 px-3">uint32 BE</td>
                    <td className="py-2 px-3">CRC-32 of bytes 0x00..0x51 (verifies header before allocation)</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30">
                    <td className="py-2 px-3 text-emerald-400">0x56..</td>
                    <td className="py-2 px-3">Ln B</td>
                    <td className="py-2 px-3 font-semibold text-slate-200">Filename Data</td>
                    <td className="py-2 px-3">UTF-8 string</td>
                    <td className="py-2 px-3">Original sanitized filename</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30">
                    <td className="py-2 px-3 text-emerald-400">0x56+Ln..</td>
                    <td className="py-2 px-3">Lp B</td>
                    <td className="py-2 px-3 font-semibold text-slate-200">Payload Data</td>
                    <td className="py-2 px-3">Binary bytes</td>
                    <td className="py-2 px-3">Raw slice of original file data</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30 bg-emerald-950/20">
                    <td className="py-2 px-3 text-emerald-400 font-bold">0x56+Ln+Lp..</td>
                    <td className="py-2 px-3">4 B</td>
                    <td className="py-2 px-3 font-semibold text-emerald-300">Payload CRC-32</td>
                    <td className="py-2 px-3">uint32 BE</td>
                    <td className="py-2 px-3">CRC-32 checksum computed exclusively over Payload Data</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Integrity and Alignment rules */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-white font-medium text-xs">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <span>Pixel Alignment & Padding</span>
              </div>
              <ul className="text-xs text-slate-400 space-y-1.5 list-disc list-inside">
                <li>Byte stream is mapped 3 bytes per RGB pixel (`R, G, B`).</li>
                <li>Padded with 0x00 to complete the final pixel if length % 3 != 0.</li>
                <li>Dimensions `W x H` form a square or near-square grid.</li>
                <li>Geometric excess pixels are filled with black opaque `[0, 0, 0, 255]`.</li>
              </ul>
            </div>

            <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-white font-medium text-xs">
                <Lock className="w-4 h-4 text-amber-400" />
                <span>Corruption vs. Correction</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                PixelVault enforces strict cryptographic verification. If an image has modified pixels or compression artifacts (e.g. from social media recompression), CRC-32 and SHA-256 will detect corruption and prevent download. Checksums verify integrity but cannot reconstruct altered data.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-medium transition-colors"
          >
            Close Specification
          </button>
        </div>
      </div>
    </div>
  );
};
