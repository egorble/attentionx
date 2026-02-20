import React from 'react';
import { NavSection } from '../types';
import { Flame, Store, Wallet, Swords, Newspaper, ShieldCheck } from 'lucide-react';
import { isAdmin } from '../hooks/useAdmin';
import { useWalletContext } from '../context/WalletContext';

interface BottomNavProps {
  activeSection: NavSection;
  onNavigate: (section: NavSection) => void;
}

const BottomNav: React.FC<BottomNavProps> = ({ activeSection, onNavigate }) => {
  const { address } = useWalletContext();
  const userIsAdmin = isAdmin(address);

  const tabs = [
    { id: NavSection.HOME, icon: Flame, label: 'Home' },
    { id: NavSection.MARKETPLACE, icon: Store, label: 'Market' },
    { id: NavSection.PORTFOLIO, icon: Wallet, label: 'Portfolio' },
    { id: NavSection.LEAGUES, icon: Swords, label: 'Leagues' },
    { id: NavSection.FEED, icon: Newspaper, label: 'Feed' },
    ...(userIsAdmin ? [{ id: NavSection.ADMIN, icon: ShieldCheck, label: 'Admin' }] : []),
  ];
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden flex justify-center" style={{ paddingBottom: 'env(safe-area-inset-bottom, 8px)' }}>
      <nav className="mx-4 mb-3 px-3 py-2 rounded-[28px] glass-nav">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => {
            const isActive = activeSection === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onNavigate(tab.id)}
                className={`flex flex-col items-center justify-center px-3 py-1.5 rounded-2xl transition-all duration-300 ${isActive
                    ? 'bg-yc-purple text-white shadow-lg shadow-yc-purple/30'
                    : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 active:scale-95'
                  }`}
              >
                <tab.icon className="w-5 h-5" strokeWidth={isActive ? 2.2 : 1.8} />
                <span className={`text-[9px] mt-0.5 leading-tight ${isActive ? 'font-bold' : 'font-medium'}`}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};

export default BottomNav;
