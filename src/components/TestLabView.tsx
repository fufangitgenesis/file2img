import React, { useState } from 'react';
import { Play, CheckCircle2, XCircle, Loader2, RefreshCw, Terminal, AlertTriangle, ShieldCheck } from 'lucide-react';
import { runPixelVaultTests, TestCaseResult } from '../lib/test-suite.ts';

export const TestLabView: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [testResults, setTestResults] = useState<TestCaseResult[]>([]);
  const [currentTestName, setCurrentTestName] = useState<string>('');

  const handleRunTests = async () => {
    if (isRunning) return;
    setIsRunning(true);
    setTestResults([]);

    try {
      await runPixelVaultTests((updatedTest) => {
        setCurrentTestName(updatedTest.name);
        setTestResults((prev) => {
          const index = prev.findIndex((t) => t.id === updatedTest.id);
          if (index !== -1) {
            const next = [...prev];
            next[index] = updatedTest;
            return next;
          } else {
            return [...prev, updatedTest];
          }
        });
      });
    } catch (err) {
      console.error('Test suite failed unexpectedly:', err);
    } finally {
      setIsRunning(false);
      setCurrentTestName('');
    }
  };

  const passedCount = testResults.filter((t) => t.status === 'passed').length;
  const failedCount = testResults.filter((t) => t.status === 'failed').length;
  const totalCount = testResults.length;

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Terminal className="w-4 h-4" />
              </div>
              <h1 className="text-xl font-bold text-white">Diagnostic & Verification Test Lab</h1>
            </div>
            <p className="text-xs text-slate-400 max-w-2xl">
              Execute the 13 automated test suites live in your browser environment.
              Tests exercise true RFC 2083 PNG generation, sub-pixel packaging, boundary alignments,
              batch renaming, direct ZIP bundle extraction, high-capacity streaming, and CRC-32 tamper detection.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleRunTests}
              disabled={isRunning}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all shadow-lg ${
                isRunning
                  ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20 active:scale-[0.98]'
              }`}
            >
              {isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                  <span>Running Suite...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>Run All Diagnostic Tests</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live Running Indicator */}
        {isRunning && (
          <div className="mt-4 pt-4 border-t border-slate-800 flex items-center gap-3 text-xs text-emerald-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Currently executing: <strong className="text-white">{currentTestName}</strong></span>
          </div>
        )}

        {/* Metrics Summary */}
        {totalCount > 0 && (
          <div className="mt-6 pt-6 border-t border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
              <span className="text-[11px] text-slate-500 uppercase font-mono tracking-wider">Total Tests</span>
              <p className="text-lg font-bold text-white mt-0.5">{totalCount} / 13</p>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
              <span className="text-[11px] text-emerald-500 uppercase font-mono tracking-wider">Passed</span>
              <p className="text-lg font-bold text-emerald-400 mt-0.5">{passedCount}</p>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
              <span className="text-[11px] text-rose-500 uppercase font-mono tracking-wider">Failed</span>
              <p className="text-lg font-bold text-rose-400 mt-0.5">{failedCount}</p>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
              <span className="text-[11px] text-indigo-400 uppercase font-mono tracking-wider">Environment</span>
              <p className="text-xs font-medium text-slate-300 mt-1 truncate">Lossless TS PNG Engine</p>
            </div>
          </div>
        )}
      </div>

      {/* Results List */}
      <div className="space-y-3">
        {testResults.length === 0 && !isRunning && (
          <div className="bg-slate-900/50 border border-dashed border-slate-800 rounded-2xl p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-xl bg-slate-800/50 flex items-center justify-center mx-auto text-slate-500">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-white">Automated Test Suite Ready</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Click &quot;Run All Diagnostic Tests&quot; to test binary packing, PNG scanline un-filtering,
              and tamper detection end-to-end.
            </p>
          </div>
        )}

        {testResults.map((test) => {
          const isPassed = test.status === 'passed';
          const isFailed = test.status === 'failed';
          const isPending = test.status === 'running';

          return (
            <div
              key={test.id}
              className={`rounded-xl border p-4 transition-all ${
                isPassed
                  ? 'bg-slate-900/80 border-emerald-500/20 hover:border-emerald-500/40'
                  : isFailed
                  ? 'bg-rose-950/20 border-rose-500/40'
                  : 'bg-slate-900/40 border-slate-800'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    {isPassed && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                    {isFailed && <XCircle className="w-4 h-4 text-rose-400" />}
                    {isPending && <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-white">{test.name}</h4>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                        {test.durationMs}ms
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">{test.description}</p>
                    {test.details && (
                      <p className="text-xs font-mono text-emerald-300/90 pt-1 bg-emerald-950/20 px-2.5 py-1 rounded border border-emerald-500/20">
                        {test.details}
                      </p>
                    )}
                    {test.error && (
                      <p className="text-xs font-mono text-rose-300/90 pt-1 bg-rose-950/30 px-2.5 py-1 rounded border border-rose-500/30">
                        Error: {test.error}
                      </p>
                    )}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                      isPassed
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : isFailed
                        ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {test.status}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
