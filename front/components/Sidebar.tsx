import React from 'react';
import { NavSection, UserProfile } from '../types';
import { Flame, Store, Wallet, Swords, Newspaper, Settings, Sun, Moon, ShieldCheck } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { isAdmin } from '../hooks/useAdmin';
import { useWalletContext } from '../context/WalletContext';

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
  const { connect, isConnecting, isConnected } = useWalletContext();
  const userIsAdmin = isAdmin(user.address || null);

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

      {/* Footer */}
      <div className="p-6 border-t border-yc-light-border dark:border-[rgba(147,51,234,0.15)] space-y-4 bg-transparent">

        {isConnected ? (
          /* Connected: show profile card + theme toggle */
          <>
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

            {/* Theme Toggle */}
            <div className="flex justify-center">
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
          </>
        ) : (
          /* Not connected: show Connect button + theme toggle */
          <>
            <button
              onClick={connect}
              disabled={isConnecting}
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-yc-purple hover:bg-purple-600 text-white font-bold text-sm transition-all shadow-lg shadow-purple-500/20 active:scale-95 neon-glow"
            >
              <Wallet size={18} />
              {isConnecting ? 'Connecting...' : 'Connect Wallet'}
            </button>

            {/* Theme Toggle */}
            <div className="flex justify-center">
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
          </>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
