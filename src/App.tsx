/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Header, ActiveTab } from './components/Header.tsx';
import { EncodeView } from './components/EncodeView.tsx';
import { DecodeView } from './components/DecodeView.tsx';
import { TestLabView } from './components/TestLabView.tsx';
import { FormatSpecModal } from './components/FormatSpecModal.tsx';
import { ShieldCheck, Cpu, HardDrive, Terminal } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('encode');
  const [isSpecModalOpen, setIsSpecModalOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Header */}
      <Header
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenSpec={() => setIsSpecModalOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Info Banner */}
        <div className="mb-6 bg-slate-900/60 border border-slate-800/80 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span>
              <strong className="text-slate-200">Local-First Sandbox:</strong> Files are processed
              100% on your device. Zero telemetry, zero uploads, zero server dependencies.
            </span>
          </div>
          <div className="flex items-center gap-4 text-[11px] font-mono text-slate-500">
            <span>RFC 2083 PNG</span>
            <span>•</span>
            <span>IEEE 802.3 CRC-32</span>
            <span>•</span>
            <span>SHA-256</span>
          </div>
        </div>

        {/* Dynamic Views */}
        {activeTab === 'encode' && <EncodeView />}
        {activeTab === 'decode' && <DecodeView />}
        {activeTab === 'testlab' && <TestLabView />}
      </main>

      {/* Format Specification Modal */}
      <FormatSpecModal
        isOpen={isSpecModalOpen}
        onClose={() => setIsSpecModalOpen(false)}
      />

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-indigo-400" />
            <span className="font-semibold text-slate-400">PixelVault</span>
            <span>—</span>
            <span>Deterministic lossless file encapsulation</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <button
              onClick={() => setActiveTab('testlab')}
              className="hover:text-indigo-400 transition-colors"
            >
              Diagnostic Test Suite
            </button>
            <span>•</span>
            <button
              onClick={() => setIsSpecModalOpen(true)}
              className="hover:text-indigo-400 transition-colors"
            >
              Binary Format v1
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
