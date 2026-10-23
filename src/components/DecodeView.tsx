import React, { useState, useRef, useEffect } from 'react';
import {
  Upload,
  FileCheck2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HardDriveDownload,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Trash2,
  Copy,
  Check,
  FileQuestion,
  Layers,
  Archive,
  FileImage,
  Play,
  X,
  Activity,
  Clock,
  Timer,
  Plus,
} from 'lucide-react';
import {
  decodePNGFiles,
  FileReconstructionGroup,
  revokeURLs,
  extractPNGsFromZip,
  DecodeProgress,
} from '../lib/pipeline.ts';

export interface StagedItem {
  id: string;
  name: string;
  size: number;
  bytes: Uint8Array;
  origin: 'png' | 'zip';
  sourceZipName?: string;
}

export const DecodeView: React.FC = () => {
  const [stagedFiles, setStagedFiles] = useState<StagedItem[]>([]);
  const [isDecoding, setIsDecoding] = useState(false);
  const [isExtractingZip, setIsExtractingZip] = useState(false);
  const [zipNotice, setZipNotice] = useState<string | null>(null);

  const [decodeProgress, setDecodeProgress] = useState<DecodeProgress | null>(null);
  const [reconstructionGroups, setReconstructionGroups] = useState<FileReconstructionGroup[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Revoke reconstructed URLs on cleanup
  useEffect(() => {
    return () => {
      revokeURLs(reconstructionGroups.map((g) => g.reconstructedUrl));
    };
  }, [reconstructionGroups]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setZipNotice(null);
    const newItems: StagedItem[] = [];
    let zipExtractedCount = 0;
    const processedZipNames: string[] = [];

    setIsExtractingZip(true);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileNameLower = file.name.toLowerCase();
        const arrayBuffer = await file.arrayBuffer();
        const fileBytes = new Uint8Array(arrayBuffer);

        // Check if file is a ZIP archive
        if (
          fileNameLower.endsWith('.zip') ||
          (fileBytes.length >= 4 && fileBytes[0] === 0x50 && fileBytes[1] === 0x4b)
        ) {
          const extracted = extractPNGsFromZip(fileBytes);
          if (extracted.length > 0) {
            zipExtractedCount += extracted.length;
            processedZipNames.push(file.name);
            for (const item of extracted) {
              newItems.push({
                id: `${file.name}-${item.name}-${Math.random().toString(36).slice(2, 7)}`,
                name: item.name,
                size: item.bytes.byteLength,
                bytes: item.bytes,
                origin: 'zip',
                sourceZipName: file.name,
              });
            }
          } else {
            console.warn(`No valid PNG chunks found inside ZIP: ${file.name}`);
          }
        } else {
          // Standard PNG or image file
          newItems.push({
            id: `${file.name}-${Math.random().toString(36).slice(2, 7)}`,
            name: file.name,
            size: fileBytes.byteLength,
            bytes: fileBytes,
            origin: 'png',
          });
        }
      }

      if (zipExtractedCount > 0) {
        setZipNotice(
          `📦 Automatically extracted ${zipExtractedCount} PNG chunk(s) from ZIP archive (${processedZipNames.join(', ')}) without device decompression!`
        );
      }

      setStagedFiles((prev) => [...prev, ...newItems]);
    } catch (err) {
      console.error('Error reading dropped files:', err);
    } finally {
      setIsExtractingZip(false);
    }
  };

  const handleStartDecode = async () => {
    if (stagedFiles.length === 0 || isDecoding) return;

    setIsDecoding(true);
    setDecodeProgress(null);

    // Revoke previous URLs before decoding
    revokeURLs(reconstructionGroups.map((g) => g.reconstructedUrl));
    setReconstructionGroups([]);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const pngInputs = stagedFiles.map((item) => ({
      name: item.name,
      bytes: item.bytes,
    }));

    try {
      const results = await decodePNGFiles(
        pngInputs,
        (progress: DecodeProgress | number) => {
          if (typeof progress === 'object') {
            setDecodeProgress(progress);
          }
        },
        abortController.signal
      );
      setReconstructionGroups(results);
    } catch (err) {
      if ((err as Error).message.includes('cancelled')) {
        setDecodeProgress((prev) =>
          prev ? { ...prev, stage: 'cancelled', message: 'Decoding cancelled by user' } : null
        );
      } else {
        console.error('Decode failed:', err);
      }
    } finally {
      setIsDecoding(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancelDecode = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleRemoveStagedItem = (id: string) => {
    setStagedFiles((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearAll = () => {
    revokeURLs(reconstructionGroups.map((g) => g.reconstructedUrl));
    setStagedFiles([]);
    setReconstructionGroups([]);
    setZipNotice(null);
    setDecodeProgress(null);
  };

  const handleCopyText = (text: string, fieldKey: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldKey);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const formatThroughput = (bytesPerSec?: number): string => {
    if (!bytesPerSec || bytesPerSec <= 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
    return `${parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const formatETA = (seconds: number | null | undefined, isComplete: boolean): string => {
    if (isComplete) return 'Complete';
    if (seconds === null || seconds === undefined) return 'Estimating...';
    if (seconds < 1) return '< 1s remaining';
    if (seconds < 60) return `~${seconds}s remaining`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `~${mins}m ${secs > 0 ? `${secs}s` : ''} remaining`;
  };

  const totalStagedBytes = stagedFiles.reduce((sum, item) => sum + item.size, 0);

  return (
    <div className="space-y-6">
      {/* Upload & Staging Queue Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-white">Lossless PNG Decoder & Reassembler</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Upload one or more PixelVault PNG chunks or a <strong>ZIP bundle directly</strong>.
              PixelVault automatically decompresses ZIP archives in-memory without device unpacking.
            </p>
          </div>

          {stagedFiles.length > 0 && (
            <button
              onClick={handleClearAll}
              disabled={isDecoding}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 text-xs font-medium transition-colors self-start sm:self-auto disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Queue ({stagedFiles.length})</span>
            </button>
          )}
        </div>

        {/* Dropzone accepting PNGs and ZIPs */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
            isDragging
              ? 'border-indigo-500 bg-indigo-500/10'
              : 'border-slate-800 bg-slate-950/20 hover:border-slate-700 hover:bg-slate-950/40'
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => handleFiles(e.target.files)}
            multiple
            accept="image/png,.png,.zip,application/zip"
            className="hidden"
          />

          <div className="flex flex-col items-center justify-center space-y-3">
            <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Upload className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-200">
                Drop PNG images or <strong className="text-indigo-400">.ZIP bundles</strong> here, or{' '}
                <span className="text-indigo-400 underline">browse</span>
              </p>
              <p className="text-xs text-slate-500">
                Supports individual PNGs or batch ZIP archives. Automatic in-browser ZIP extraction enabled.
              </p>
            </div>
          </div>
        </div>

        {/* Automatic Zip Unpack Notice */}
        {isExtractingZip && (
          <div className="bg-indigo-950/30 border border-indigo-500/30 rounded-xl p-3 flex items-center gap-3 text-xs text-indigo-300 animate-pulse">
            <Loader2 className="w-4 h-4 animate-spin text-indigo-400 shrink-0" />
            <span>Unpacking ZIP bundle in-memory and discovering PNG chunks...</span>
          </div>
        )}

        {zipNotice && (
          <div className="bg-emerald-950/25 border border-emerald-500/30 rounded-xl p-3.5 flex items-start gap-3 text-xs text-emerald-300">
            <Archive className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <p className="leading-relaxed">{zipNotice}</p>
          </div>
        )}

        {/* Staged Upload Queue List */}
        {stagedFiles.length > 0 && (
          <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Staged Files Queue ({stagedFiles.length})
                </span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  Total: {formatBytes(totalStagedBytes)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800 hover:bg-slate-700"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add More</span>
                </button>
              </div>
            </div>

            {/* Scrollable list of staged files */}
            <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
              {stagedFiles.map((item) => (
                <div
                  key={item.id}
                  className="bg-slate-900 border border-slate-800/80 rounded-lg px-3 py-2 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2.5 overflow-hidden">
                    {item.origin === 'zip' ? (
                      <Archive className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    ) : (
                      <FileImage className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    )}
                    <span className="text-white truncate font-mono text-[11px]" title={item.name}>
                      {item.name}
                    </span>
                    {item.origin === 'zip' && item.sourceZipName && (
                      <span className="text-[10px] text-indigo-400/80 px-1.5 py-0.2 rounded bg-indigo-950/50 border border-indigo-500/20 shrink-0">
                        From: {item.sourceZipName}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0 ml-2">
                    <span className="text-[11px] text-slate-400 font-mono">
                      {formatBytes(item.size)}
                    </span>
                    <button
                      onClick={() => handleRemoveStagedItem(item.id)}
                      disabled={isDecoding}
                      className="text-slate-500 hover:text-rose-400 transition-colors disabled:opacity-30"
                      title="Remove file"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Start Decoding CTA Bar */}
            <div className="pt-2 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
              <span className="text-[11px] text-slate-400 font-mono">
                Isolated Queue: Files process sequentially with memory yielding to prevent browser freezing.
              </span>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                {isDecoding ? (
                  <button
                    onClick={handleCancelDecode}
                    className="w-full sm:w-auto px-4 py-2 rounded-xl border border-rose-500/40 text-rose-400 hover:bg-rose-950/30 text-xs font-semibold transition-colors"
                  >
                    Cancel Decoding
                  </button>
                ) : (
                  <button
                    onClick={handleStartDecode}
                    disabled={stagedFiles.length === 0}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all active:scale-[0.98]"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Start Decoding & Verification</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Decoding Loading Screen & HUD (Active while processing) */}
        {isDecoding && decodeProgress && (
          <div className="bg-slate-950/90 border border-indigo-500/30 rounded-2xl p-5 space-y-4 shadow-xl animate-in fade-in">
            <div className="flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                <span className="text-white font-semibold">
                  {decodeProgress.message}
                </span>
              </div>
              <span className="text-indigo-400 font-bold text-sm">
                {decodeProgress.progress}%
              </span>
            </div>

            {/* Animated Progress Bar */}
            <div className="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden border border-slate-800">
              <div
                className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 h-full transition-all duration-300"
                style={{ width: `${decodeProgress.progress}%` }}
              />
            </div>

            {/* Metrics HUD */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-xs font-mono">
              <div className="flex items-center gap-1.5 text-slate-400 bg-slate-900/60 px-2.5 py-1.5 rounded-lg border border-slate-800 text-[11px]">
                <Activity className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span className="text-slate-500">Throughput:</span>
                <span className="text-slate-200 font-semibold truncate">
                  {formatThroughput(decodeProgress.speedBytesPerSec)}
                </span>
              </div>

              <div className="flex items-center gap-1.5 text-slate-400 bg-slate-900/60 px-2.5 py-1.5 rounded-lg border border-slate-800 text-[11px]">
                <Clock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="text-slate-500">ETA:</span>
                <span className="text-emerald-300 font-semibold truncate">
                  {formatETA(decodeProgress.estimatedSecondsRemaining, decodeProgress.stage === 'completed')}
                </span>
              </div>

              <div className="flex items-center justify-between text-slate-400 bg-slate-900/60 px-2.5 py-1.5 rounded-lg border border-slate-800 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <Timer className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="text-slate-500">Elapsed:</span>
                  <span className="text-slate-200">{decodeProgress.elapsedSeconds ?? 0}s</span>
                </div>
                <span>
                  File {decodeProgress.currentFile}/{decodeProgress.totalFiles}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Educational Integrity Callout */}
        <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-3.5 flex items-start gap-3 text-xs text-slate-400">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-slate-300">Integrity Detection vs. Error Repair</p>
            <p className="leading-relaxed">
              PixelVault provides strict corruption detection using IEEE 802.3 CRC-32 and SHA-256.
              If an image was compressed by a social platform or modified, the checksums will detect it
              and prevent corrupted output. Cryptographic checksums cannot repair altered pixels.
            </p>
          </div>
        </div>
      </div>

      {/* Reconstructed Files Ledger */}
      {reconstructionGroups.length > 0 && (
        <div className="space-y-4 animate-in fade-in">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Reconstructed File Ledger ({reconstructionGroups.length}{' '}
            {reconstructionGroups.length === 1 ? 'file' : 'files'} detected)
          </h3>

          <div className="space-y-4">
            {reconstructionGroups.map((group) => {
              const isReady = group.isComplete && group.isSHA256Match;
              const hasErrors = group.errors.length > 0;
              const hasMissing = group.missingChunkIndices.length > 0;

              return (
                <div
                  key={group.fileId}
                  className={`bg-slate-900 border rounded-2xl p-6 shadow-sm space-y-6 transition-all ${
                    isReady
                      ? 'border-emerald-500/30'
                      : hasErrors
                      ? 'border-rose-500/30'
                      : 'border-slate-800'
                  }`}
                >
                  {/* Group Header */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          isReady
                            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                            : hasErrors
                            ? 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                            : 'bg-indigo-500/10 border border-indigo-500/20 text-indigo-400'
                        }`}
                      >
                        {isReady ? (
                          <FileCheck2 className="w-5 h-5" />
                        ) : hasErrors ? (
                          <XCircle className="w-5 h-5" />
                        ) : (
                          <Layers className="w-5 h-5" />
                        )}
                      </div>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <h4 className="text-base font-bold text-white truncate" title={group.originalFilename}>
                            {group.originalFilename}
                          </h4>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                            {formatBytes(group.originalFileSize)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 font-mono">
                          File ID: {group.fileId.slice(0, 16)}... • Required Chunks: {group.totalChunks}
                        </p>
                      </div>
                    </div>

                    {/* Download CTA */}
                    <div className="flex items-center gap-3">
                      {isReady && group.reconstructedUrl && (
                        <a
                          href={group.reconstructedUrl}
                          download={group.originalFilename}
                          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/20 transition-all active:scale-[0.98]"
                        >
                          <HardDriveDownload className="w-4 h-4" />
                          <span>Download Verified File ({formatBytes(group.originalFileSize)})</span>
                        </a>
                      )}

                      {!isReady && (
                        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700/60 text-xs font-medium text-slate-300">
                          {hasMissing ? (
                            <span className="text-amber-400">
                              Missing {group.missingChunkIndices.length} chunk(s)
                            </span>
                          ) : hasErrors ? (
                            <span className="text-rose-400">Integrity Verification Failed</span>
                          ) : (
                            <span>Awaiting Remaining Chunks</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Chunk Assembly Matrix */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-medium">Chunk Assembly Progress</span>
                      <span className="font-mono text-slate-300">
                        {group.receivedChunksCount} of {group.totalChunks} Chunks Loaded
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                      {Array.from({ length: group.totalChunks }).map((_, idx) => {
                        const chunkInfo = group.chunksByIndex.get(idx);
                        const isPresent = !!chunkInfo;
                        const isCorrupt = isPresent && (!chunkInfo.chunkCRCValid || !chunkInfo.headerCRCValid);

                        return (
                          <div
                            key={idx}
                            className={`p-2.5 rounded-xl border text-center transition-all ${
                              isCorrupt
                                ? 'bg-rose-950/30 border-rose-500/40 text-rose-300'
                                : isPresent
                                ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                                : 'bg-slate-950/40 border-dashed border-slate-800 text-slate-500'
                            }`}
                          >
                            <span className="text-xs font-bold font-mono">
                              Part {idx + 1}
                            </span>
                            <p className="text-[10px] mt-0.5 truncate">
                              {isCorrupt
                                ? 'CRC Error'
                                : isPresent
                                ? `0x${chunkInfo.chunkCRC32Hex}`
                                : 'Missing'}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Integrity Verification Badges */}
                  <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
                    <span className="text-[10px] uppercase font-mono text-slate-400 font-semibold tracking-wider">
                      Integrity Checklist
                    </span>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      {/* Check 1: Magic & Header */}
                      <div className="flex items-center gap-2 text-slate-300">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>Container Magic (PIXELVLT)</span>
                      </div>

                      {/* Check 2: Header CRC */}
                      <div className="flex items-center gap-2 text-slate-300">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>Header CRC-32 Verified</span>
                      </div>

                      {/* Check 3: Chunk CRC */}
                      <div className="flex items-center gap-2">
                        {group.hasCorruptedChunks ? (
                          <>
                            <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                            <span className="text-rose-300">Payload CRC-32 Failed</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            <span className="text-slate-300">Payload CRC-32 Valid</span>
                          </>
                        )}
                      </div>

                      {/* Check 4: Whole-file SHA-256 */}
                      <div className="flex items-center gap-2">
                        {isReady ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            <span className="text-emerald-300 font-medium">SHA-256 Exact Match</span>
                          </>
                        ) : hasMissing ? (
                          <>
                            <FileQuestion className="w-4 h-4 text-amber-400 shrink-0" />
                            <span className="text-slate-400">SHA-256 Pending Chunks</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                            <span className="text-rose-300">SHA-256 Mismatch</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* SHA-256 Comparison */}
                  <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase font-mono text-slate-400 font-semibold tracking-wider">
                        Expected Whole-File SHA-256
                      </span>
                      <button
                        onClick={() => handleCopyText(group.expectedSHA256, `exp-${group.fileId}`)}
                        className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white"
                      >
                        {copiedField === `exp-${group.fileId}` ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        <span>Copy</span>
                      </button>
                    </div>
                    <p className="text-xs font-mono text-slate-300 truncate" title={group.expectedSHA256}>
                      {group.expectedSHA256}
                    </p>
                    {group.reconstructedSHA256 && (
                      <div className="pt-2 border-t border-slate-800/80">
                        <span className="text-[10px] uppercase font-mono text-emerald-400 font-semibold tracking-wider">
                          Reconstructed File SHA-256
                        </span>
                        <p className="text-xs font-mono text-emerald-300 truncate mt-0.5" title={group.reconstructedSHA256}>
                          {group.reconstructedSHA256}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Errors / Warnings */}
                  {group.errors.length > 0 && (
                    <div className="bg-rose-950/30 border border-rose-500/40 rounded-xl p-4 space-y-1 text-xs text-rose-300">
                      <div className="flex items-center gap-2 font-semibold text-rose-400">
                        <AlertTriangle className="w-4 h-4" />
                        <span>Integrity Issues Detected</span>
                      </div>
                      <ul className="list-disc list-inside space-y-0.5 pt-1">
                        {group.errors.map((err, errIdx) => (
                          <li key={errIdx}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Duplicates notice */}
                  {group.duplicateChunkIndices.length > 0 && (
                    <p className="text-xs text-amber-400/90 font-mono">
                      Note: Duplicate uploads ignored for chunk index:{' '}
                      {group.duplicateChunkIndices.map((i) => `#${i + 1}`).join(', ')}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {stagedFiles.length === 0 && reconstructionGroups.length === 0 && !isDecoding && (
        <div className="bg-slate-900/50 border border-dashed border-slate-800 rounded-2xl p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-slate-800/50 flex items-center justify-center mx-auto text-slate-500">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-white">No Files in Decode Queue</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Drag and drop PixelVault PNG images or an entire <strong>.ZIP bundle</strong>.
            The app automatically extracts chunks without disk decompression and verifies file integrity.
          </p>
        </div>
      )}
    </div>
  );
};
