import React from 'react';
import { NavSection, UserProfile } from '../types';
import { Flame, Store, Wallet, Swords, Newspaper, Settings, Sun, Moon, ShieldCheck, LogOut } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { isAdmin } from '../hooks/useAdmin';
import { useWalletContext } from '../context/WalletContext';
import { useNetwork } from '../context/NetworkContext';
import { ethers } from 'ethers';

interface SidebarProps {
  activeSection: NavSection;
  setActiveSection: (section: NavSection) => void;
  user: UserProfile;
  isOpen?: boolean;
  onClose?: () => void;
  onSettingsClick?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeSection, setActiveSection, user, isOpen = false, onClose, onSettingsClick }) => {
  const { theme, toggleTheme } = useTheme();
  const { connect, isConnecting, disconnect, isConnected, switchChain, refreshBalance, balance, balanceLoading } = useWalletContext();
  const { networkId, allNetworks, switchNetwork, activeNetwork } = useNetwork();
  const userIsAdmin = isAdmin(user.address || null);

  const handleNetworkSwitch = (id: string) => {
    if (id === networkId) return;
    switchNetwork(id);
    if (isConnected) { switchChain().catch(() => { }); refreshBalance(); }
  };

  const navItems = [
    { id: NavSection.HOME, icon: Flame, label: 'Dashboard' },
    { id: NavSection.MARKETPLACE, icon: Store, label: 'Marketplace' },
    { id: NavSection.PORTFOLIO, icon: Wallet, label: 'My Portfolio' },
    { id: NavSection.LEAGUES, icon: Swords, label: 'Leagues' },
    { id: NavSection.FEED, icon: Newspaper, label: 'Feed' },
    ...(userIsAdmin ? [{ id: NavSection.ADMIN, icon: ShieldCheck, label: 'Admin' }] : []),
  ];

  return (
    <aside
      className="w-72 h-screen fixed top-0 left-0 glass-nav border-r border-[rgba(147,51,234,0.15)] hidden md:flex flex-col z-50"
    >
      {/* Logo Area */}
      <div className="px-8 py-10 flex items-center justify-between">
        <div className="flex items-center gap-3 text-yc-text-primary dark:text-white">
          <img src="/unicornx.png" alt="AttentionX" className="h-9 w-auto" />
          <h1 className="text-2xl font-black tracking-tighter">
            AttentionX
          </h1>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-6 space-y-3 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={`w-full flex items-center px-5 py-4 rounded-2xl transition-all duration-300 group font-bold text-base
                ${isActive
                  ? 'glass-panel text-yc-text-primary dark:text-white shadow-lg shadow-purple-500/10'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-yc-text-primary dark:hover:text-white'}
              `}
            >
              <item.icon
                className={`w-6 h-6 mr-4 transition-colors duration-300 
                  ${isActive ? 'text-yc-purple' : 'text-gray-400 group-hover:text-yc-purple'}`}
                strokeWidth={isActive ? 2.5 : 2}
              />
              <span className="tracking-tight">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer Controls */}
      <div className="p-6 border-t border-yc-light-border dark:border-yc-dark-border space-y-6 bg-transparent">

        {/* User Profile - Large Card Style */}
        <div
          className="flex items-center p-3 rounded-xl glass-panel shadow-sm cursor-pointer hover:border-yc-purple transition-colors group"
          onClick={onSettingsClick}
        >
          <div className="w-10 h-10 rounded-lg bg-gray-200 dark:bg-[#333] overflow-hidden shrink-0">
            <img
              src={user.avatar}
              alt="User"
              className="w-full h-full object-cover"
              style={{ imageRendering: user.avatar?.startsWith('data:') ? 'pixelated' : 'auto' }}
            />
          </div>
          <div className="ml-3 flex-1 min-w-0">
            <p className="text-sm font-bold text-yc-text-primary dark:text-white truncate group-hover:text-yc-purple transition-colors">{user.name}</p>
            <p className="text-xs text-gray-400 font-mono font-medium">Pro League</p>
          </div>
          <Settings className="w-5 h-5 text-gray-300 group-hover:text-yc-purple transition-colors shrink-0" />
        </div>

        {/* Balance Display */}
        {isConnected && (
          <div className="flex items-center justify-between px-2">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Balance</span>
            {balanceLoading ? (
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-yc-purple text-sm">◈</span>
                <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              </div>
            ) : (
              <p className="text-sm font-black font-mono flex items-center text-gray-900 dark:text-white">
                <span className="text-yc-purple text-xs mr-1">◈</span>
                {Number(ethers.formatEther(balance)).toFixed(2)} {activeNetwork?.nativeCurrency.symbol}
              </p>
            )}
          </div>
        )}

        {/* Network Toggle */}
        <div className="flex bg-gray-200 dark:bg-white/5 rounded-full p-1 gap-0.5">
          {allNetworks.map((net) => (
            <button
              key={net.id}
              onClick={() => handleNetworkSwitch(net.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-full text-xs font-bold transition-all ${networkId === net.id
                ? 'bg-yc-purple text-white shadow'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'
                }`}
            >
              <span>{net.shortName}</span>
            </button>
          ))}
        </div>

        {/* Theme Toggle - Minimal */}
        <div className="flex items-center justify-between px-2">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Mode</span>
          <div className="flex bg-gray-200 dark:bg-white/5 rounded-full p-1">
            <button
              onClick={() => theme === 'dark' && toggleTheme()}
              className={`p-2 rounded-full transition-all ${theme === 'light' ? 'bg-white dark:bg-white/10 shadow text-purple-500 dark:text-purple-400' : 'text-gray-400'}`}
            >
              <Sun size={16} />
            </button>
            <button
              onClick={() => theme === 'light' && toggleTheme()}
              className={`p-2 rounded-full transition-all ${theme === 'dark' ? 'bg-purple-500/20 text-white shadow' : 'text-gray-400'}`}
            >
              <Moon size={16} />
            </button>
          </div>
        </div>

        {/* Wallet Connection */}
        {!isConnected ? (
          <button
            onClick={connect}
            disabled={isConnecting}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-yc-purple hover:bg-purple-600 text-white font-bold text-sm transition-all shadow-purple-500/20 active:scale-95"
          >
            <Wallet size={16} />
            {isConnecting ? 'Connecting...' : 'Connect Wallet'}
          </button>
        ) : (
          <button
            onClick={disconnect}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white font-bold text-sm transition-all"
          >
            <LogOut size={16} />
            Disconnect Wallet
          </button>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;