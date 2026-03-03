import React, { useState, useRef, useEffect } from 'react';
import { NavSection } from '../types';
import { Flame, Store, Wallet, Swords, Newspaper, ShieldCheck, Coins } from 'lucide-react';
import { isAdmin } from '../hooks/useAdmin';
import { useWalletContext } from '../context/WalletContext';

interface BottomNavProps {
  activeSection: NavSection;
  onNavigate: (section: NavSection) => void;
}

const BottomNav: React.FC<BottomNavProps> = ({ activeSection, onNavigate }) => {
  const { address } = useWalletContext();
  const userIsAdmin = isAdmin(address);
  const [showLeagueMenu, setShowLeagueMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isLeagueActive = activeSection === NavSection.LEAGUES || activeSection === NavSection.TOKEN_LEAGUES;

  // Close menu on outside click
  useEffect(() => {
    if (!showLeagueMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowLeagueMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showLeagueMenu]);

  const tabs = [
    { id: NavSection.HOME, icon: Flame, label: 'Home' },
    { id: NavSection.MARKETPLACE, icon: Store, label: 'Market' },
    { id: NavSection.PORTFOLIO, icon: Wallet, label: 'Portfolio' },
    { id: 'leagues-group' as const, icon: Swords, label: 'Leagues' },
    { id: NavSection.FEED, icon: Newspaper, label: 'Feed' },
    ...(userIsAdmin ? [{ id: NavSection.ADMIN, icon: ShieldCheck, label: 'Admin' }] : []),
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden flex justify-center" style={{ paddingBottom: 'env(safe-area-inset-bottom, 8px)' }}>
      <nav className="mx-4 mb-3 px-3 py-2 rounded-[28px] glass-nav border border-gray-200 dark:border-white/[0.08] relative">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => {
            const isLeaguesBtn = tab.id === 'leagues-group';
            const isActive = isLeaguesBtn ? isLeagueActive : activeSection === tab.id;

            return (
              <div key={tab.id} className="relative" ref={isLeaguesBtn ? menuRef : undefined}>
                <button
                  onClick={() => {
                    if (isLeaguesBtn) {
                      setShowLeagueMenu(!showLeagueMenu);
                    } else {
                      setShowLeagueMenu(false);
                      onNavigate(tab.id as NavSection);
                    }
                  }}
                  className={`flex flex-col items-center justify-center px-3 py-1.5 rounded-2xl transition-all duration-300 ${isActive
                      ? 'bg-yc-purple/10 dark:bg-yc-purple/[0.15] text-yc-purple shadow-sm'
                      : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 active:scale-95'
                    }`}
                >
                  <tab.icon className="w-5 h-5" strokeWidth={isActive ? 2.2 : 1.8} />
                  <span className={`text-[9px] mt-0.5 leading-tight ${isActive ? 'font-bold' : 'font-medium'}`}>
                    {tab.label}
                  </span>
                </button>

                {/* Sub-menu for Leagues */}
                {isLeaguesBtn && showLeagueMenu && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 flex gap-3 animate-in fade-in slide-in-from-bottom-4 duration-200">
                    <button
                      onClick={() => { onNavigate(NavSection.LEAGUES); setShowLeagueMenu(false); }}
                      className={`flex items-center justify-center flex-col gap-1 w-16 h-16 rounded-full text-[9px] font-black uppercase tracking-wider transition-all active:scale-90 backdrop-blur-xl border shadow-[0_4px_20px_rgba(0,0,0,0.5)] ${
                        activeSection === NavSection.LEAGUES
                          ? 'bg-[#9333ea] text-black border-[#9333ea] shadow-[0_4px_20px_rgba(147,51,234,0.4)]'
                          : 'bg-zinc-900/95 text-zinc-300 border-zinc-700 hover:bg-zinc-800 hover:border-zinc-600'
                      }`}
                    >
                      <Swords className="w-5 h-5" />
                      <span className="leading-none">Cards</span>
                    </button>
                    <button
                      onClick={() => { onNavigate(NavSection.TOKEN_LEAGUES); setShowLeagueMenu(false); }}
                      className={`flex items-center justify-center flex-col gap-1 w-16 h-16 rounded-full text-[9px] font-black uppercase tracking-wider transition-all active:scale-90 backdrop-blur-xl border shadow-[0_4px_20px_rgba(0,0,0,0.5)] ${
                        activeSection === NavSection.TOKEN_LEAGUES
                          ? 'bg-[#9333ea] text-black border-[#9333ea] shadow-[0_4px_20px_rgba(147,51,234,0.4)]'
                          : 'bg-zinc-900/95 text-zinc-300 border-zinc-700 hover:bg-zinc-800 hover:border-zinc-600'
                      }`}
                    >
                      <Coins className="w-5 h-5" />
                      <span className="leading-none">Tokens</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </nav>
    </div>
  );
};

export default BottomNav;
