import React, { useState } from 'react';
import { UserPlus, Copy, Check } from 'lucide-react';
import { useWalletContext } from '../context/WalletContext';
import { useReferral } from '../hooks/useReferral';
import { currencySymbol } from '../lib/networks';
import ModelViewer3D from './ModelViewer3D';

import { useActiveTournament, useSharedTopStartups } from '../hooks/useSharedData';

interface RightPanelProps {
  onOpenPack: () => void;
}

const RightPanel: React.FC<RightPanelProps> = ({ onOpenPack }) => {
  const { isConnected } = useWalletContext();
  const { getReferralLink, referralStats } = useReferral();
  const [copied, setCopied] = useState(false);
  const packPrice = '0.01';

  const { data: tournament } = useActiveTournament();
  const { data: topStartups } = useSharedTopStartups(tournament?.id ?? null);

  const referralLink = getReferralLink();

  const handleCopy = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <aside className="w-64 h-screen fixed right-0 top-0 bg-white dark:bg-yc-dark-panel border-l border-gray-200 dark:border-yc-dark-border p-3 hidden xl:flex flex-col space-y-3 z-40 overflow-y-auto transition-colors duration-300">

      {/* Buy Pack CTA */}
      <div className="rounded-xl relative overflow-hidden shadow-lg shrink-0 glass-panel">
        {/* 3D model area */}
        <div className="relative h-40 bg-gradient-to-b from-gray-100 to-gray-50 dark:from-[#111] dark:to-[#0a0a0a]">
          <ModelViewer3D mode="gentle" cameraZ={2.8} modelScale={0.8} />
          {/* Subtle glow behind model */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-24 h-24 bg-yc-purple/10 rounded-full blur-2xl" />
          </div>
        </div>
        {/* Bottom bar */}
        <div className="p-3 border-t border-[#1a1a1a]">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-gray-500 dark:text-gray-500 text-[10px] font-medium">5 cards per pack</span>
            <span className="text-yc-text-primary dark:text-white font-mono font-black text-lg">{packPrice} <span className="text-gray-500 dark:text-gray-400 text-sm font-bold">{currencySymbol()}</span></span>
          </div>
          <button
            onClick={onOpenPack}
            className="w-full bg-yc-purple hover:bg-purple-600 text-white py-2.5 rounded-lg font-black text-sm uppercase tracking-wider transition-all flex items-center justify-center active:scale-95 shadow-md shadow-purple-500/20"
          >
            Buy Pack
          </button>
        </div>
      </div>

      {/* Top Startups by Points */}
      <div className="bg-gray-50 dark:bg-[#121212] border border-gray-200 dark:border-[#2A2A2A] rounded-lg p-3 shadow-sm dark:shadow-none">
        <div className="flex items-center justify-between mb-2">
             <h3 className="text-gray-900 dark:text-white font-bold text-[11px] uppercase tracking-wide">Top Startups</h3>
             <span className="text-[8px] text-gray-400 font-medium">base pts</span>
        </div>

        <div className="space-y-1">
            {topStartups && topStartups.length > 0 ? (
              topStartups.map((startup, i) => (
                <div key={startup.name} className="flex items-center justify-between group hover:bg-gray-100 dark:hover:bg-white/5 px-1 py-1 rounded transition-colors">
                    <div className="flex items-center min-w-0">
                        <span className={`text-[10px] font-black shrink-0 mr-2 w-4 text-center ${
                          i === 0 ? 'text-yc-purple' : 'text-gray-400'
                        }`}>
                            {i + 1}
                        </span>
                        <p className="text-[11px] font-semibold text-gray-900 dark:text-white group-hover:text-yc-purple transition-colors truncate">
                          {startup.name}
                        </p>
                    </div>
                    <span className="text-[10px] font-bold text-green-500 font-mono shrink-0 ml-1">
                      +{Math.round(startup.points)}
                    </span>
                </div>
              ))
            ) : (
              <p className="text-[10px] text-gray-400 text-center py-2">No scores yet</p>
            )}
        </div>
      </div>

      {/* Referral */}
      <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-gray-900 dark:to-black border border-purple-200 dark:border-gray-800 rounded-lg p-3">
        <div className="flex items-center justify-between mb-1.5">
            <h3 className="text-gray-900 dark:text-white font-bold text-xs">Referral Program</h3>
            <UserPlus className="w-3.5 h-3.5 text-yc-purple" />
        </div>
        <p className="text-gray-600 dark:text-gray-400 text-[10px] mb-2">
            Earn <span className="text-yc-purple font-bold">10%</span> from every pack your friends buy.
        </p>

        {isConnected && (
            <div className="flex gap-2 mb-2">
                <div className="flex-1 bg-white/80 dark:bg-black/50 rounded p-1.5 border border-purple-200/50 dark:border-gray-700 text-center">
                    <p className="text-[9px] text-gray-500 uppercase font-bold">Refs</p>
                    <p className="text-gray-900 dark:text-white font-bold font-mono text-xs">{referralStats.count}</p>
                </div>
                <div className="flex-1 bg-white/80 dark:bg-black/50 rounded p-1.5 border border-purple-200/50 dark:border-gray-700 text-center">
                    <p className="text-[9px] text-gray-500 uppercase font-bold">Earned</p>
                    <p className="text-yc-purple font-bold font-mono text-xs">{referralStats.totalEarned}</p>
                </div>
            </div>
        )}

        <div className="relative">
            <input
                type="text"
                value={isConnected ? referralLink : 'Connect wallet first'}
                readOnly
                className="w-full bg-white/80 dark:bg-black/50 border border-purple-200/50 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-[9px] px-2 py-1.5 pr-12 rounded font-mono focus:outline-none truncate"
            />
            <button
                onClick={handleCopy}
                disabled={!isConnected}
                className={`absolute right-0.5 top-1/2 -translate-y-1/2 text-white text-[9px] font-bold px-1.5 py-0.5 rounded transition-all flex items-center gap-0.5 ${
                    copied
                        ? 'bg-green-500'
                        : isConnected
                            ? 'bg-yc-purple hover:bg-purple-600'
                            : 'bg-gray-400 cursor-not-allowed'
                }`}
            >
                {copied ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                {copied ? 'OK' : 'Copy'}
            </button>
        </div>
      </div>

    </aside>
  );
};

export default RightPanel;
