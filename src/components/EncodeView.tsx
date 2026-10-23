import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Upload,
  FileBox,
  Sliders,
  Download,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Check,
  RefreshCw,
  X,
  Archive,
  Image as ImageIcon,
  HardDriveDownload,
  Eye,
  Tag,
  Zap,
  Info,
  Activity,
  Clock,
  Timer,
  Loader2,
} from 'lucide-react';
import * as fflate from 'fflate';
import {
  encodeFileToPNGs,
  EncodeProgress,
  EncodeResult,
  EncodedPNGChunk,
  revokeURLs,
  formatPNGFilename,
} from '../lib/pipeline.ts';

interface ChunkPreset {
  label: string;
  bytes: number;
  description: string;
}

const CHUNK_PRESETS: ChunkPreset[] = [
  { label: '2 MB', bytes: 2 * 1024 * 1024, description: 'Low RAM / Mobile safe' },
  { label: '8 MB', bytes: 8 * 1024 * 1024, description: 'Balanced (Standard)' },
  { label: '32 MB', bytes: 32 * 1024 * 1024, description: 'Fast (~10 MP images)' },
  { label: '64 MB', bytes: 64 * 1024 * 1024, description: 'High density (~21 MP)' },
  { label: '128 MB', bytes: 128 * 1024 * 1024, description: 'Very large files (~42 MP)' },
  { label: '256 MB', bytes: 256 * 1024 * 1024, description: 'Ultra density (~85 MP)' },
  { label: '512 MB', bytes: 512 * 1024 * 1024, description: 'Max chunk (~170 MP)' },
];

export const EncodeView: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedChunkSize, setSelectedChunkSize] = useState<number>(32 * 1024 * 1024);
  const [isCustomSize, setIsCustomSize] = useState(false);
  const [customSizeMB, setCustomSizeMB] = useState(32);

  // Batch rename states
  const [renamePrefix, setRenamePrefix] = useState<string>('');
  const [renameSuffix, setRenameSuffix] = useState<string>('');
  const [customBaseName, setCustomBaseName] = useState<string>('');
  const [isRenameExpanded, setIsRenameExpanded] = useState<boolean>(true);

  // Large file stream mode
  const [forceStreamMode, setForceStreamMode] = useState<boolean>(true);

  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState<EncodeProgress | null>(null);
  const [encodeResult, setEncodeResult] = useState<EncodeResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [previewModalChunk, setPreviewModalChunk] = useState<EncodedPNGChunk | null>(null);
  const [isZipping, setIsZipping] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Clean up object URLs when encodeResult changes or component unmounts
  useEffect(() => {
    return () => {
      if (encodeResult) {
        revokeURLs(encodeResult.chunks.map((c) => c.url));
      }
    };
  }, [encodeResult]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      selectFile(e.target.files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      selectFile(e.dataTransfer.files[0]);
    }
  };

  const selectFile = (file: File) => {
    if (encodeResult) {
      revokeURLs(encodeResult.chunks.map((c) => c.url));
      setEncodeResult(null);
    }
    setSelectedFile(file);
    setErrorMessage(null);
    setProgress(null);

    // Initialize custom base name from file
    const dotIdx = file.name.lastIndexOf('.');
    const initialBase = dotIdx !== -1 ? file.name.slice(0, dotIdx) : file.name;
    setCustomBaseName(initialBase);
  };

  const effectiveChunkBytes = isCustomSize ? customSizeMB * 1024 * 1024 : selectedChunkSize;

  const isLargeFile = selectedFile ? selectedFile.size >= 500 * 1024 * 1024 : false;
  const isOver1GB = selectedFile ? selectedFile.size >= 1024 * 1024 * 1024 : false;

  const handleStartEncode = async () => {
    if (!selectedFile) return;

    if (encodeResult) {
      revokeURLs(encodeResult.chunks.map((c) => c.url));
      setEncodeResult(null);
    }

    setErrorMessage(null);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const result = await encodeFileToPNGs(
        selectedFile,
        effectiveChunkBytes,
        (p) => setProgress(p),
        abortController.signal,
        {
          prefix: renamePrefix,
          suffix: renameSuffix,
          customBaseName: customBaseName.trim() || undefined,
        }
      );
      setEncodeResult(result);
    } catch (err) {
      if ((err as Error).message.includes('cancelled')) {
        setProgress({
          stage: 'cancelled',
          progress: 0,
          currentChunk: 0,
          totalChunks: 0,
          message: 'Encoding cancelled',
        });
      } else {
        setErrorMessage((err as Error).message || 'Failed to encode file into PNG.');
      }
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleCopyText = (text: string, fieldKey: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldKey);
    setTimeout(() => setCopiedField(null), 2000);
  };

  /**
   * Dynamically compute current customized download filename for a chunk
   */
  const getChunkDownloadFilename = (chunkIndex: number, totalChunks: number): string => {
    if (!encodeResult) return '';
    return formatPNGFilename(
      encodeResult.originalFilename,
      chunkIndex,
      totalChunks,
      renamePrefix,
      renameSuffix,
      customBaseName.trim() || undefined
    );
  };

  // Sample preview of the filename
  const sampleFilenamePreview = useMemo(() => {
    const orig = selectedFile?.name || encodeResult?.originalFilename || 'document.pdf';
    const estChunks = selectedFile
      ? Math.max(1, Math.ceil(selectedFile.size / effectiveChunkBytes))
      : encodeResult?.chunks.length || 1;
    return formatPNGFilename(orig, 0, estChunks, renamePrefix, renameSuffix, customBaseName.trim() || undefined);
  }, [selectedFile, encodeResult, renamePrefix, renameSuffix, customBaseName, effectiveChunkBytes]);

  const handleDownloadAllAsZip = async () => {
    if (!encodeResult || encodeResult.chunks.length === 0) return;
    setIsZipping(true);

    try {
      // Build in-memory zip using fflate with dynamic renamed filenames
      const zipFiles: Record<string, Uint8Array> = {};
      for (const chunk of encodeResult.chunks) {
        const arrayBuffer = await chunk.blob.arrayBuffer();
        const activeName = getChunkDownloadFilename(chunk.chunkIndex, chunk.totalChunks);
        zipFiles[activeName] = new Uint8Array(arrayBuffer);
      }

      const zipped = fflate.zipSync(zipFiles);
      const zipBlob = new Blob([zipped], { type: 'application/zip' });
      const zipUrl = URL.createObjectURL(zipBlob);

      const a = document.createElement('a');
      a.href = zipUrl;
      const baseZipName = customBaseName.trim() || encodeResult.originalFilename;
      a.download = `${renamePrefix}${baseZipName}${renameSuffix}.pixelvault-bundle.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => URL.revokeObjectURL(zipUrl), 10000);
    } catch (err) {
      console.error('Failed to create ZIP bundle:', err);
      // Fallback: trigger sequential individual downloads
      for (const chunk of encodeResult.chunks) {
        const a = document.createElement('a');
        a.href = chunk.url;
        a.download = getChunkDownloadFilename(chunk.chunkIndex, chunk.totalChunks);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } finally {
      setIsZipping(false);
    }
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
    if (isComplete) return 'Finished';
    if (seconds === null || seconds === undefined) return 'Calculating ETA...';
    if (seconds < 1) return '< 1s remaining';
    if (seconds < 60) return `~${seconds}s remaining`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) {
      return `~${mins}m ${secs > 0 ? `${secs}s` : ''} remaining`;
    }
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `~${hours}h ${remMins}m remaining`;
  };

  const totalOutputBytes = encodeResult
    ? encodeResult.chunks.reduce((sum, c) => sum + c.pngByteLength, 0)
    : 0;

  const isEncoding = Boolean(
    progress &&
      (progress.stage === 'hashing' ||
        progress.stage === 'chunking' ||
        progress.stage === 'encoding')
  );

  return (
    <div className="space-y-6">
      {/* Configuration & Input Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
        <div>
          <h2 className="text-lg font-bold text-white">Lossless File-to-PNG Encoder</h2>
          <p className="text-xs text-slate-400 mt-1">
            Convert any arbitrary file into one or more authentic, standards-compliant PNG images.
            Bytes are mapped 1:1 into RGB pixels with embedded SHA-256 and CRC-32 integrity containers.
          </p>
        </div>

        {/* Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
            isDragging
              ? 'border-indigo-500 bg-indigo-500/10'
              : selectedFile
              ? 'border-indigo-500/40 bg-slate-950/40 hover:border-indigo-500/60'
              : 'border-slate-800 bg-slate-950/20 hover:border-slate-700 hover:bg-slate-950/40'
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
          />

          <div className="flex flex-col items-center justify-center space-y-3">
            <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Upload className="w-6 h-6" />
            </div>
            {selectedFile ? (
              <div className="space-y-1">
                <p className="text-sm font-semibold text-white">{selectedFile.name}</p>
                <p className="text-xs text-slate-400 font-mono">
                  {formatBytes(selectedFile.size)} • {selectedFile.type || 'Binary Stream'}
                </p>
                <p className="text-[11px] text-indigo-400 pt-1">Click or drag another file to replace</p>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-200">
                  Drop any file here, or <span className="text-indigo-400 underline">browse</span>
                </p>
                <p className="text-xs text-slate-500">
                  Supports any file type: documents, archives, videos, executables, or datasets
                </p>
              </div>
            )}
          </div>
        </div>

        {/* High-Capacity (>1GB) Stream Mode Banner */}
        {(isLargeFile || forceStreamMode) && (
          <div className="bg-indigo-950/30 border border-indigo-500/30 rounded-xl p-3.5 flex items-start gap-3 text-xs">
            <Zap className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-indigo-300">
                  {isOver1GB ? 'High-Capacity Stream Mode (>1 GB File Detected)' : 'High-Capacity Stream Mode Active'}
                </span>
                <span className="px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-mono text-[10px]">
                  Zero-OOM Engine
                </span>
              </div>
              <p className="text-slate-400 leading-relaxed">
                Processes files via low-memory 16 MB chunk slicing and incremental FIPS 180-4 streaming SHA-256.
                Allows handling multi-gigabyte files (1 GB, 2 GB+) without browser tab memory crashes.
              </p>
            </div>
          </div>
        )}

        {/* Chunk Sizing Options */}
        <div className="space-y-3 pt-2 border-t border-slate-800/80">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-indigo-400" />
              <span>Target Chunk Size Per PNG (Up to 512 MB)</span>
            </label>
            <span className="text-xs text-slate-400 font-mono">
              {isCustomSize ? `${customSizeMB} MB` : formatBytes(selectedChunkSize)}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {CHUNK_PRESETS.map((preset) => {
              const active = !isCustomSize && selectedChunkSize === preset.bytes;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setSelectedChunkSize(preset.bytes);
                    setIsCustomSize(false);
                  }}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    active
                      ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-sm'
                      : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <p className="text-xs font-semibold">{preset.label}</p>
                  <p className="text-[10px] text-slate-500 truncate mt-0.5">{preset.description}</p>
                </button>
              );
            })}
          </div>

          {/* Custom Size Slider */}
          <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-300 w-full sm:w-auto">
              <span className="text-slate-400">Custom Chunk Size:</span>
              <input
                type="range"
                min="1"
                max="512"
                step="1"
                value={customSizeMB}
                onChange={(e) => {
                  setCustomSizeMB(Number(e.target.value));
                  setIsCustomSize(true);
                }}
                className="w-36 accent-indigo-500 cursor-pointer"
              />
              <span className="font-mono text-white font-bold">{customSizeMB} MB</span>
            </div>

            <div className="text-[11px] text-slate-500 font-mono">
              Larger chunks = fewer total PNG files (1 x 128MB chunk vs 16 x 8MB chunks)
            </div>
          </div>

          {/* Chunk Size Warning Badges */}
          {effectiveChunkBytes >= 256 * 1024 * 1024 ? (
            <div className="bg-rose-950/30 border border-rose-500/40 rounded-xl p-3 flex items-start gap-2.5 text-rose-300 text-xs">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-semibold text-rose-300">Extreme Chunk Density Warning (&ge; 256 MB)</p>
                <p className="text-rose-400/90 leading-relaxed">
                  Generates very large images exceeding 9,200 &times; 9,200 pixels and requires ~800 MB RAM during DEFLATE scanline compression. If your browser runs out of memory, lower chunk size to 64 MB or 128 MB.
                </p>
              </div>
            </div>
          ) : effectiveChunkBytes >= 128 * 1024 * 1024 ? (
            <div className="bg-amber-950/30 border border-amber-500/40 rounded-xl p-3 flex items-start gap-2.5 text-amber-300 text-xs">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-semibold text-amber-300">High Memory Notice (&ge; 128 MB per Chunk)</p>
                <p className="text-amber-400/90 leading-relaxed">
                  Requires ~400 MB RAM per chunk during PNG generation. Recommended for desktop browsers.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {/* Batch Rename & Output Filename Customization */}
        <div className="space-y-3 pt-2 border-t border-slate-800/80">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-indigo-400" />
              <span>Batch Rename & Output Filenames</span>
            </label>
            <span className="text-[11px] text-emerald-400 font-mono">
              Safe to Rename (Metadata is embedded inside pixels)
            </span>
          </div>

          <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Prefix */}
              <div>
                <label className="text-[11px] font-medium text-slate-400 block mb-1">Prefix</label>
                <input
                  type="text"
                  placeholder="e.g. backup_ or vault_"
                  value={renamePrefix}
                  onChange={(e) => setRenamePrefix(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none"
                />
              </div>

              {/* Base Name */}
              <div>
                <label className="text-[11px] font-medium text-slate-400 block mb-1">Base Name</label>
                <input
                  type="text"
                  placeholder="Base filename"
                  value={customBaseName}
                  onChange={(e) => setCustomBaseName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none"
                />
              </div>

              {/* Suffix */}
              <div>
                <label className="text-[11px] font-medium text-slate-400 block mb-1">Suffix</label>
                <input
                  type="text"
                  placeholder="e.g. _2026 or _pv"
                  value={renameSuffix}
                  onChange={(e) => setRenameSuffix(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none"
                />
              </div>
            </div>

            {/* Live Filename Preview */}
            <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-slate-400 overflow-hidden">
                <span className="font-semibold text-slate-300 shrink-0">Sample Output Name:</span>
                <span className="font-mono text-indigo-300 truncate" title={sampleFilenamePreview}>
                  {sampleFilenamePreview}
                </span>
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const today = new Date().toISOString().slice(0, 10);
                    setRenamePrefix(`${today}_`);
                  }}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300"
                >
                  + Date Prefix
                </button>
                <button
                  type="button"
                  onClick={() => setRenameSuffix('_backup')}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300"
                >
                  + &quot;_backup&quot;
                </button>
                {(renamePrefix || renameSuffix) && (
                  <button
                    type="button"
                    onClick={() => {
                      setRenamePrefix('');
                      setRenameSuffix('');
                    }}
                    className="px-2 py-1 rounded bg-slate-850 hover:bg-slate-800 text-[10px] text-slate-400"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Action Button & Progress */}
        <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="w-full sm:w-auto">
            {selectedFile && (
              <span className="text-xs text-slate-400 font-mono">
                Estimated Output:{' '}
                <strong className="text-white">
                  {selectedFile.size === 0
                    ? '1 PNG image'
                    : `~${Math.max(
                        1,
                        Math.ceil(selectedFile.size / effectiveChunkBytes)
                      )} PNG ${
                        Math.ceil(selectedFile.size / effectiveChunkBytes) === 1
                          ? 'image'
                          : 'images'
                      }`}
                </strong>
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            {isEncoding && (
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-2.5 rounded-xl border border-rose-500/30 text-rose-400 hover:bg-rose-950/30 text-xs font-medium transition-colors"
              >
                Cancel
              </button>
            )}

            <button
              type="button"
              onClick={handleStartEncode}
              disabled={!selectedFile || isEncoding}
              className={`flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-lg w-full sm:w-auto ${
                !selectedFile || isEncoding
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/25 active:scale-[0.98]'
              }`}
            >
              <FileBox className="w-4 h-4" />
              <span>{isEncoding ? 'Processing...' : 'Encode to PNG'}</span>
            </button>
          </div>
        </div>

        {/* Progress Bar & Dynamic Speed/ETA Indicator */}
        {progress && (
          <div className="space-y-3 pt-3 border-t border-slate-800/80 animate-in fade-in">
            {/* Top row: Message & Percentage */}
            <div className="flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-2">
                {isEncoding && <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />}
                {progress.stage === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                <span className={progress.stage === 'completed' ? 'text-emerald-400 font-semibold' : 'text-indigo-400'}>
                  {progress.message}
                </span>
              </div>
              <span className="text-white font-bold text-sm">{progress.progress}%</span>
            </div>

            {/* Glowing Gradient Progress Bar */}
            <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-slate-800 p-0.5">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  progress.stage === 'completed'
                    ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50'
                    : 'bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 shadow-sm shadow-indigo-500/50'
                }`}
                style={{ width: `${progress.progress}%` }}
              />
            </div>

            {/* Bottom row: Dynamic Throughput, ETA, and Elapsed Time */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-xs">
              {/* Throughput */}
              <div className="flex items-center gap-1.5 text-slate-400 bg-slate-950/40 px-2.5 py-1.5 rounded-lg border border-slate-800/60 font-mono text-[11px]">
                <Activity className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span className="text-slate-500">Speed:</span>
                <span className="text-slate-200 font-semibold truncate">
                  {formatThroughput(progress.speedBytesPerSec)}
                </span>
              </div>

              {/* Estimated Time Remaining */}
              <div className="flex items-center gap-1.5 text-slate-400 bg-slate-950/40 px-2.5 py-1.5 rounded-lg border border-slate-800/60 font-mono text-[11px]">
                <Clock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="text-slate-500">ETA:</span>
                <span
                  className={`font-semibold truncate ${
                    progress.stage === 'completed'
                      ? 'text-emerald-400'
                      : progress.estimatedSecondsRemaining !== null &&
                        progress.estimatedSecondsRemaining !== undefined
                      ? 'text-emerald-300'
                      : 'text-amber-400'
                  }`}
                >
                  {formatETA(progress.estimatedSecondsRemaining, progress.stage === 'completed')}
                </span>
              </div>

              {/* Elapsed Time & Chunks */}
              <div className="flex items-center justify-between text-slate-400 bg-slate-950/40 px-2.5 py-1.5 rounded-lg border border-slate-800/60 font-mono text-[11px]">
                <div className="flex items-center gap-1.5">
                  <Timer className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="text-slate-500">Elapsed:</span>
                  <span className="text-slate-200">{progress.elapsedSeconds ?? 0}s</span>
                </div>
                {progress.totalChunks > 0 && (
                  <span className="text-[10px] text-slate-400">
                    Chunk {progress.currentChunk}/{progress.totalChunks}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="bg-rose-950/30 border border-rose-500/40 rounded-xl p-4 text-xs text-rose-300 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
            <div>
              <p className="font-semibold">Encoding Error</p>
              <p className="mt-0.5">{errorMessage}</p>
            </div>
          </div>
        )}
      </div>

      {/* Results View */}
      {encodeResult && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-6 animate-in fade-in">
          {/* Header & Metrics */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <h3 className="text-lg font-bold text-white">Lossless PNG Generation Complete</h3>
              </div>
              <p className="text-xs text-slate-400">
                Generated {encodeResult.chunks.length}{' '}
                {encodeResult.chunks.length === 1 ? 'PNG image' : 'PNG images'} containing the
                complete byte payload.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleDownloadAllAsZip}
                disabled={isZipping}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all"
              >
                <Archive className="w-4 h-4" />
                <span>{isZipping ? 'Bundling ZIP...' : 'Download Bundle (ZIP)'}</span>
              </button>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
              <span className="text-[10px] text-slate-500 uppercase font-mono">Original File Size</span>
              <p className="text-sm font-bold text-white mt-0.5 font-mono">
                {formatBytes(encodeResult.originalFileSize)}
              </p>
            </div>
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
              <span className="text-[10px] text-slate-500 uppercase font-mono">Total PNG Output</span>
              <p className="text-sm font-bold text-indigo-400 mt-0.5 font-mono">
                {formatBytes(totalOutputBytes)}
              </p>
            </div>
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
              <span className="text-[10px] text-slate-500 uppercase font-mono">Images Created</span>
              <p className="text-sm font-bold text-white mt-0.5 font-mono">
                {encodeResult.chunks.length} {encodeResult.chunks.length === 1 ? 'Chunk' : 'Chunks'}
              </p>
            </div>
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
              <span className="text-[10px] text-slate-500 uppercase font-mono">File ID</span>
              <p className="text-xs font-bold text-slate-300 mt-1 font-mono truncate" title={encodeResult.fileId}>
                {encodeResult.fileId.slice(0, 12)}...
              </p>
            </div>
          </div>

          {/* SHA-256 Digest Box */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1 overflow-hidden">
              <span className="text-[10px] uppercase font-mono text-emerald-400 font-semibold tracking-wider">
                Whole-File SHA-256 Digest (Embedded in all chunks)
              </span>
              <p className="text-xs font-mono text-slate-300 truncate" title={encodeResult.wholeFileSHA256}>
                {encodeResult.wholeFileSHA256}
              </p>
            </div>
            <button
              onClick={() => handleCopyText(encodeResult.wholeFileSHA256, 'sha')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors shrink-0"
            >
              {copiedField === 'sha' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Hash</span>
                </>
              )}
            </button>
          </div>

          {/* Generated Chunks Grid */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Generated Lossless PNG Chunks
              </h4>
              <span className="text-[11px] text-slate-400 font-mono">
                Click download or save bundle above
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {encodeResult.chunks.map((chunk) => {
                const dynamicFilename = getChunkDownloadFilename(chunk.chunkIndex, chunk.totalChunks);

                return (
                  <div
                    key={chunk.chunkIndex}
                    className="bg-slate-950/60 border border-slate-800 hover:border-slate-700 rounded-xl overflow-hidden flex flex-col transition-all group"
                  >
                    {/* Thumbnail Preview */}
                    <div className="relative aspect-video bg-slate-900 border-b border-slate-800/80 overflow-hidden flex items-center justify-center">
                      <img
                        src={chunk.url}
                        alt={dynamicFilename}
                        className="w-full h-full object-contain p-2 image-pixelated"
                      />
                      <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          onClick={() => setPreviewModalChunk(chunk)}
                          className="p-2 rounded-lg bg-slate-800/90 text-white hover:bg-slate-700 text-xs flex items-center gap-1.5 shadow-md"
                        >
                          <Eye className="w-4 h-4" />
                          <span>Inspect</span>
                        </button>
                      </div>
                      <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-slate-950/80 text-[10px] font-mono text-slate-300 border border-slate-800">
                        Chunk {chunk.chunkIndex + 1}/{chunk.totalChunks}
                      </span>
                    </div>

                    {/* Chunk Metadata */}
                    <div className="p-3.5 flex-1 flex flex-col justify-between space-y-3">
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-white truncate" title={dynamicFilename}>
                          {dynamicFilename}
                        </p>
                        <div className="grid grid-cols-2 gap-1 text-[11px] font-mono text-slate-400">
                          <span>Dimensions:</span>
                          <span className="text-right text-slate-200">
                            {chunk.width}x{chunk.height}
                          </span>
                          <span>PNG Size:</span>
                          <span className="text-right text-slate-200">{formatBytes(chunk.pngByteLength)}</span>
                          <span>CRC-32:</span>
                          <span className="text-right text-emerald-400">0x{chunk.chunkCRC32Hex}</span>
                        </div>
                      </div>

                      <a
                        href={chunk.url}
                        download={dynamicFilename}
                        className="flex items-center justify-center gap-2 w-full py-2 bg-slate-800 hover:bg-indigo-600 text-white rounded-lg text-xs font-semibold transition-colors"
                      >
                        <HardDriveDownload className="w-3.5 h-3.5" />
                        <span>Download PNG</span>
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Inspect Modal */}
      {previewModalChunk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">
                  {getChunkDownloadFilename(previewModalChunk.chunkIndex, previewModalChunk.totalChunks)}
                </h3>
                <p className="text-xs text-slate-400 font-mono">
                  {previewModalChunk.width} x {previewModalChunk.height} px •{' '}
                  {formatBytes(previewModalChunk.pngByteLength)}
                </p>
              </div>
              <button
                onClick={() => setPreviewModalChunk(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="border border-slate-800 rounded-xl bg-slate-950 p-2 flex items-center justify-center max-h-[50vh] overflow-auto">
              <img
                src={previewModalChunk.url}
                alt="Chunk visual representation"
                className="max-h-[46vh] object-contain image-pixelated"
              />
            </div>

            <div className="text-xs text-slate-400 space-y-1">
              <p>
                <strong>RGB Pixel Layout:</strong> Each pixel encodes 3 bytes of the container stream
                (R, G, B) with 100% opaque alpha.
              </p>
              <p className="font-mono text-[11px] text-emerald-400">
                Chunk Payload CRC-32: 0x{previewModalChunk.chunkCRC32Hex}
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <a
                href={previewModalChunk.url}
                download={getChunkDownloadFilename(
                  previewModalChunk.chunkIndex,
                  previewModalChunk.totalChunks
                )}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>Save PNG</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
