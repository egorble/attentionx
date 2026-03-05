import React, { useState } from 'react';
import { UserPlus, Copy, Check, ChevronLeft } from 'lucide-react';
import { useWalletContext } from '../context/WalletContext';
import { useReferral } from '../hooks/useReferral';
import { useTokenLeaguesWS } from '../hooks/useTokenLeaguesWS';
import { TOKENS } from '../hooks/useTokenLeagues';
import { TokenIcon } from './TokenLeagues';

interface RightPanelProps {
  onOpenPack?: () => void;
  isMobile?: boolean;
}

const TokenLeaguesRightPanel: React.FC<RightPanelProps> = ({ isMobile }) => {
  const { isConnected, address } = useWalletContext();
  const { getReferralLink, referralStats } = useReferral();
  const [copied, setCopied] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<{ address: string, tokens: number[] } | null>(null);

  const { leaderboard } = useTokenLeaguesWS();
  const referralLink = getReferralLink();

  const handleCopy = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <aside className={isMobile
      ? "w-full bg-transparent flex flex-col space-y-3 xl:hidden shrink-0 pb-6"
      : "w-64 h-screen fixed right-0 top-0 bg-white dark:bg-zinc-950 border-l border-gray-200 dark:border-zinc-900 p-3 hidden xl:flex flex-col space-y-3 z-40 overflow-y-auto"
    }>

      {/* Real-time Leaderboard */}
      <div className="bg-gray-50 dark:bg-zinc-900 rounded-[32px] p-4 flex-1 flex flex-col min-h-[300px] relative overflow-hidden">
        {selectedPlayer ? (
          <div className="flex flex-col h-full animate-in slide-in-from-right-8 duration-300">
            <div className="flex items-center mb-4">
              <button onClick={() => setSelectedPlayer(null)} className="p-1 -ml-1 hover:bg-gray-200 dark:hover:bg-zinc-800 rounded-full transition-colors mr-2">
                <ChevronLeft className="w-4 h-4 text-gray-500 dark:text-zinc-400" />
              </button>
              <h3 className="text-gray-900 dark:text-white font-bold text-xs uppercase tracking-wider truncate">
                {selectedPlayer.address.slice(0, 6)}...{selectedPlayer.address.slice(-4)}
              </h3>
            </div>

            <p className="text-[10px] text-gray-500 dark:text-zinc-400 font-bold uppercase mb-3 px-1">Selected Tokens</p>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {selectedPlayer.tokens.map(tokenId => {
                const t = TOKENS.find(tk => tk.id === tokenId);
                if (!t) return null;
                return (
                  <div key={t.id} className="flex items-center gap-2 p-2 rounded-2xl bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800">
                    <TokenIcon symbol={t.symbol} color={t.color} size={24} />
                    <span className="text-xs font-black text-gray-900 dark:text-white">{t.symbol}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full animate-in slide-in-from-left-8 duration-300">

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
              {leaderboard && leaderboard.length > 0 ? (
                leaderboard.slice(0, 50).map((entry, i) => {
                  const isYou = address && entry.address.toLowerCase() === address.toLowerCase();
                  return (
                    <div
                      key={entry.address}
                      onClick={() => entry.tokens?.length > 0 && setSelectedPlayer({ address: entry.address, tokens: entry.tokens })}
                      className={`flex items-center justify-between px-2 py-2 rounded-2xl transition-colors cursor-pointer ${isYou ? 'bg-gray-100 dark:bg-zinc-800 border border-[#9333ea]/30' : 'bg-white dark:bg-zinc-950 hover:bg-gray-100 dark:hover:bg-zinc-800'
                        }`}
                    >
                      <div className="flex items-center min-w-0 flex-1">
                        <span className={`text-[10px] font-black shrink-0 mr-2 w-4 text-center ${i === 0 ? 'text-[#9333ea]' : i < 3 ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-zinc-500'
                          }`}>
                          {i + 1}
                        </span>
                        <p className={`text-[11px] font-semibold truncate ${isYou ? 'text-[#9333ea]' : 'text-gray-600 dark:text-zinc-300'
                          }`}>
                          {isYou ? 'You' : `${entry.address.slice(0, 4)}...${entry.address.slice(-4)}`}
                        </p>
                      </div>
                      <span className={`text-[10px] font-bold font-mono shrink-0 ml-2 px-1.5 py-0.5 rounded-md ${entry.score >= 0
                        ? 'text-[#9333ea] bg-[#9333ea]/10'
                        : 'text-red-400 bg-red-400/10'
                        }`}>
                        {entry.score >= 0 ? '+' : ''}{entry.score.toFixed(2)}%
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-[10px] text-gray-400 dark:text-zinc-500 text-center">Waiting for selection phase to complete...</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Referral (desktop only) */}
      <div className={`bg-gray-50 dark:bg-zinc-900 rounded-[32px] p-4 shrink-0 ${isMobile ? 'hidden' : ''}`}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-gray-900 dark:text-white font-bold text-xs uppercase tracking-wider">Referral Program</h3>
          <UserPlus className="w-4 h-4 text-[#9333ea]" />
        </div>
        <p className="text-gray-500 dark:text-zinc-400 text-[10px] mb-3 leading-tight">
          Earn <span className="text-[#9333ea] font-bold">10%</span> from every pack your friends buy.
        </p>

        {isConnected && (
          <div className="flex gap-2 mb-3">
            <div className="flex-1 bg-white dark:bg-zinc-950 rounded-xl p-2 text-center">
              <p className="text-[9px] text-gray-400 dark:text-zinc-500 uppercase font-bold mb-0.5">Refs</p>
              <p className="text-gray-900 dark:text-white font-bold font-mono text-sm">{referralStats.count}</p>
            </div>
            <div className="flex-1 bg-white dark:bg-zinc-950 rounded-xl p-2 text-center">
              <p className="text-[9px] text-gray-400 dark:text-zinc-500 uppercase font-bold mb-0.5">Earned</p>
              <p className="text-[#9333ea] font-bold font-mono text-sm">{referralStats.totalEarned}</p>
            </div>
          </div>
        )}

        <div className="relative">
          <input
            type="text"
            value={isConnected ? referralLink : 'Connect wallet first'}
            readOnly
            className="w-full bg-white dark:bg-zinc-950 text-gray-500 dark:text-zinc-400 text-[10px] px-3 py-2.5 pr-14 rounded-full font-mono focus:outline-none truncate border border-gray-200 dark:border-transparent"
          />
          <button
            onClick={handleCopy}
            disabled={!isConnected}
            className={`absolute right-1 top-1/2 -translate-y-1/2 text-[10px] font-bold px-2.5 py-1.5 rounded-full transition-all flex items-center gap-1 ${copied
              ? 'bg-[#9333ea] text-black'
              : isConnected
                ? 'bg-gray-200 dark:bg-zinc-800 text-gray-900 dark:text-white hover:bg-gray-300 dark:hover:bg-zinc-700'
                : 'bg-gray-200 dark:bg-zinc-800 text-gray-400 dark:text-zinc-500 cursor-not-allowed'
              }`}
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? 'OK' : 'Copy'}
          </button>
        </div>
      </div>

    </aside>
  );
};

export default TokenLeaguesRightPanel;
