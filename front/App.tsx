import React, { useState, useMemo, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import RightPanel from './components/RightPanel';
import HeroBanner from './components/HeroBanner';
import LiveFeed from './components/LiveFeed';
import PackOpeningModal from './components/PackOpeningModal';
import Marketplace from './components/Marketplace';
import Portfolio from './components/Portfolio';
import Leagues from './components/Leagues';
import Analytics from './components/Analytics';
import Feed from './components/Feed';
import AdminPanel from './components/AdminPanel';
import CardDetailModal, { CardDetailData } from './components/CardDetailModal';
import ProfileSetupModal from './components/ProfileSetupModal';
import ProfileEditModal from './components/ProfileEditModal';
import BottomNav from './components/BottomNav';
import TournamentCTA from './components/TournamentCTA';
import DashboardLeaderboard from './components/DashboardLeaderboard';
import MobileWidgets from './components/MobileWidgets';
import SplashScreen from './components/SplashScreen';
import { NavSection, UserProfile, Rarity, CardData } from './types';
import { Filter, Search, Wallet, Loader2, Sun, Moon, LogOut, User } from 'lucide-react';
import { useTheme } from './context/ThemeContext';
import { ThemeProvider } from './context/ThemeContext';
import { WalletProvider, useWalletContext } from './context/WalletContext';
import { NetworkProvider, useNetwork } from './context/NetworkContext';
import { formatXTZ, CHAIN_NAME } from './lib/contracts';
import { currencySymbol } from './lib/networks';
import { isAdmin } from './hooks/useAdmin';
import { useUser } from './hooks/useUser';
import { generatePixelAvatar } from './lib/pixelAvatar';
import { ethers } from 'ethers';
import { useMarketplaceV2, Listing } from './hooks/useMarketplaceV2';
import { useNFT } from './hooks/useNFT';

// Inner component that uses wallet context
const AppContent: React.FC = () => {
    const [activeSection, setActiveSection] = useState<NavSection>(NavSection.HOME);
    const [isPackModalOpen, setIsPackModalOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [dashboardSelectedStartup, setDashboardSelectedStartup] = useState<CardDetailData | null>(null);
    const [dashboardSelectedCard, setDashboardSelectedCard] = useState<CardData | null>(null);

    // Dashboard filters and sort
    const [activeFilter, setActiveFilter] = useState<string>('all');
    const [sortBy, setSortBy] = useState<'price' | 'rarity' | 'recent'>('recent');

    // Marketplace & NFT listings for dashboard
    const [dashboardListings, setDashboardListings] = useState<Array<{ listing: Listing; card: CardData }>>([]);
    const [isLoadingDashboard, setIsLoadingDashboard] = useState(true);

    // Network hook (multi-chain)
    const { activeNetwork, networkId, allNetworks, switchNetwork } = useNetwork();

    // Wallet hook
    const {
        isConnected,
        address,
        balance,
        balanceLoading,
        isCorrectChain,
        connect,
        disconnect,
        switchChain,
        refreshBalance,
        formatAddress,
        isConnecting
    } = useWalletContext();

    const handleNetworkSwitch = (id: string) => {
        if (id === networkId) return;
        switchNetwork(id);
        if (isConnected) { switchChain().catch(() => { }); refreshBalance(); }
    };

    // User profile hook
    const { profile, needsRegistration, isNewUser, registerUser, updateProfile } = useUser();

    // Profile edit modal state
    const [isProfileEditOpen, setIsProfileEditOpen] = useState(false);

    // Mobile menu state
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const { theme, toggleTheme } = useTheme();

    // Marketplace hook
    const { getActiveListings, buyCard } = useMarketplaceV2();
    const [buyingId, setBuyingId] = useState<number | null>(null);

    // NFT hook
    const { getCardInfo, getCards, updateServerCache, clearCache } = useNFT();

    // Dynamic user from wallet + profile
    const user: UserProfile = {
        name: isConnected
            ? (profile?.username || formatAddress(address!))
            : 'Not Connected',
        handle: isConnected ? `@${address?.slice(2, 8)}` : '@connect',
        balanceXTZ: isConnected ? Number(ethers.formatEther(balance)) : 0,
        avatar: isConnected
            ? (profile?.avatar || generatePixelAvatar(address || ''))
            : generatePixelAvatar(''),
        address: address || undefined,
    };

    // Pre-fetch user's NFT cards as soon as wallet connects or network changes
    // Cards get cached in blockchainCache + localStorage → Portfolio loads instantly
    useEffect(() => {
        if (isConnected && address) {
            getCards(address).catch(() => { }); // fire-and-forget
        }
    }, [isConnected, address, getCards, networkId]);

    // Load dashboard listings with NFT metadata (refetch on network switch)
    useEffect(() => {
        const loadDashboardData = async () => {
            setIsLoadingDashboard(true);
            try {
                const listings = await getActiveListings();

                // Fetch metadata for each listing
                const listingsWithCards = await Promise.all(
                    listings.map(async (listing) => {
                        const card = await getCardInfo(Number(listing.tokenId));
                        return card ? { listing, card } : null;
                    })
                );

                // Filter out null values (failed metadata fetches)
                const validListings = listingsWithCards.filter((item): item is { listing: Listing; card: CardData } => item !== null);
                setDashboardListings(validListings);
            } catch (err) {
            } finally {
                setIsLoadingDashboard(false);
            }
        };

        loadDashboardData();
    }, [getActiveListings, getCardInfo, networkId]);

    // Filter and sort dashboard listings
    const filteredAndSortedListings = useMemo(() => {
        let filtered = dashboardListings;

        // Apply search filter
        if (searchQuery) {
            filtered = filtered.filter(({ card }) =>
                card.name.toLowerCase().includes(searchQuery.toLowerCase())
            );
        }

        // Apply category filter
        if (activeFilter !== 'all') {
            filtered = filtered.filter(({ card }) => {
                switch (activeFilter) {
                    case 'legendary':
                        return card.rarity === Rarity.LEGENDARY;
                    case 'epic':
                        return card.rarity === Rarity.EPIC || card.rarity === Rarity.EPIC_RARE;
                    case 'rare':
                        return card.rarity === Rarity.RARE;
                    case 'common':
                        return card.rarity === Rarity.COMMON;
                    default:
                        return true;
                }
            });
        }

        // Apply sorting
        const sorted = [...filtered].sort((a, b) => {
            switch (sortBy) {
                case 'price':
                    return Number(b.listing.price - a.listing.price);
                case 'rarity': {
                    const rarityOrder = {
                        [Rarity.LEGENDARY]: 5,
                        [Rarity.EPIC_RARE]: 4,
                        [Rarity.EPIC]: 3,
                        [Rarity.RARE]: 2,
                        [Rarity.COMMON]: 1,
                    };
                    return rarityOrder[b.card.rarity] - rarityOrder[a.card.rarity];
                }
                case 'recent':
                default:
                    return Number(b.listing.listedAt - a.listing.listedAt);
            }
        });

        return sorted;
    }, [dashboardListings, searchQuery, activeFilter, sortBy]);

    const handleSectionChange = (section: NavSection) => {
        setActiveSection(section);
    };

    const handleWalletClick = async () => {
        if (!isConnected) {
            await connect();
        } else if (!isCorrectChain) {
            await switchChain();
        }
    };

    const renderContent = () => {
        switch (activeSection) {
            case NavSection.MARKETPLACE:
                return <Marketplace />;
            case NavSection.PORTFOLIO:
                return <Portfolio onBuyPack={() => setIsPackModalOpen(true)} />;
            case NavSection.LEAGUES:
                return <Leagues />;
            case NavSection.FEED:
                return <Feed />;
            case NavSection.ADMIN:
                return <AdminPanel />;
            case NavSection.HOME:
            default:
                return (
                    <div>
                        {/* 1. Hero Banner */}
                        <div className="mb-6 md:mb-10">
                            <HeroBanner />
                        </div>

                        {/* 2. Live Feed Marquee */}
                        <LiveFeed />

                        {/* 3. Tournament CTA */}
                        <TournamentCTA onNavigate={handleSectionChange} />

                        {/* 3.5 Top Startups + Referral (visible below xl where RightPanel is hidden) */}
                        <MobileWidgets onOpenPack={() => setIsPackModalOpen(true)} />

                        {/* 4. Leaderboard */}
                        <DashboardLeaderboard onNavigate={handleSectionChange} />

                        {/* 5. NFT Marketplace */}
                        <div className="mt-8">
                            <h3 className="font-bold text-lg text-gray-900 dark:text-white mb-4 flex items-center">
                                <span className="w-1.5 h-5 bg-yc-purple rounded-full mr-2"></span>
                                NFT Marketplace
                            </h3>

                            <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6 gap-4 md:gap-6">
                                <div className="w-full md:w-auto">
                                    <div className="flex items-center flex-wrap gap-2">
                                        {['all', 'legendary', 'epic', 'rare', 'common'].map((filter) => (
                                            <button
                                                key={filter}
                                                onClick={() => setActiveFilter(filter)}
                                                className={`px-5 py-1.5 rounded-full text-xs font-bold transition-all duration-300 transform active:scale-95 ${activeFilter === filter
                                                    ? 'bg-yc-purple text-white shadow-lg shadow-yc-purple/30 scale-105'
                                                    : 'bg-gray-100 dark:bg-[#1A1A1A] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white'
                                                    }`}
                                            >
                                                {filter.charAt(0).toUpperCase() + filter.slice(1)}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex items-center space-x-3 self-end md:self-auto">
                                    <span className="text-xs font-bold text-gray-400 uppercase">Sort by:</span>
                                    <div className="relative group">
                                        <button className="flex items-center text-sm font-bold text-yc-text-primary dark:text-white hover:text-yc-purple transition-colors">
                                            {sortBy === 'price' ? 'Price' : sortBy === 'rarity' ? 'Rarity' : 'Recent'}
                                            <Filter className="w-3 h-3 ml-1 text-gray-400 group-hover:text-yc-purple transition-colors" />
                                        </button>
                                        <div className="absolute right-0 top-full mt-2 bg-white dark:bg-[#09090b] border border-gray-200 dark:border-[#27272a] rounded-lg shadow-lg py-2 min-w-[120px] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                                            <button
                                                onClick={() => setSortBy('recent')}
                                                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-[#18181b] text-gray-900 dark:text-white"
                                            >
                                                Recent
                                            </button>
                                            <button
                                                onClick={() => setSortBy('price')}
                                                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-[#18181b] text-gray-900 dark:text-white"
                                            >
                                                Price
                                            </button>
                                            <button
                                                onClick={() => setSortBy('rarity')}
                                                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-[#18181b] text-gray-900 dark:text-white"
                                            >
                                                Rarity
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {isLoadingDashboard ? (
                                <div className="flex items-center justify-center py-20">
                                    <Loader2 className="w-8 h-8 animate-spin text-yc-purple" />
                                    <span className="ml-3 text-lg font-bold text-gray-400">Loading marketplace...</span>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1.5 md:gap-4">
                                    {filteredAndSortedListings.length > 0 ? (
                                        filteredAndSortedListings.map(({ listing, card }) => (
                                            <div
                                                key={`${listing.listingId}-${card.tokenId}`}
                                                className="bg-white dark:bg-[#121212] border border-gray-200 dark:border-[#2A2A2A] rounded-xl overflow-hidden hover:border-yc-purple/50 transition-all duration-300 group cursor-pointer"
                                                onClick={() => {
                                                    setDashboardSelectedCard(card);
                                                    setDashboardSelectedStartup({
                                                        id: card.tokenId.toString(),
                                                        image: card.image,
                                                        name: card.name,
                                                        value: Number(ethers.formatEther(listing.price)),
                                                        rarity: card.rarity,
                                                        multiplier: `${card.multiplier}x`,
                                                        batch: `Edition ${card.edition}`,
                                                        stage: card.rarity
                                                    });
                                                }}
                                            >
                                                <div className="overflow-hidden" style={{ aspectRatio: '591/1004' }}>
                                                    <img src={card.image} alt={card.name} className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105" />
                                                </div>
                                                <div className="p-1.5 md:p-3">
                                                    <p className="text-gray-900 dark:text-white font-bold text-[11px] md:text-sm leading-tight truncate">{card.name}</p>
                                                    <p className="text-yc-purple font-bold text-[11px] md:text-base mt-0.5">{formatXTZ(listing.price)} {currencySymbol()}</p>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (!isConnected) { alert('Please connect your wallet first'); return; }
                                                            if (listing.seller.toLowerCase() === address?.toLowerCase()) { alert("You can't buy your own listing"); return; }
                                                            setBuyingId(Number(listing.listingId));
                                                            buyCard(listing.listingId, listing.price)
                                                                .then(() => { alert('Purchase successful!'); window.location.reload(); })
                                                                .catch((err: any) => alert(`Error: ${err.message}`))
                                                                .finally(() => setBuyingId(null));
                                                        }}
                                                        disabled={buyingId === Number(listing.listingId)}
                                                        className="w-full mt-1.5 md:mt-2 px-2 py-1 md:px-4 md:py-2 rounded-lg font-bold text-[10px] md:text-sm bg-yc-purple hover:bg-purple-600 text-white transition-all active:scale-95 disabled:opacity-50"
                                                    >
                                                        {buyingId === Number(listing.listingId) ? 'Buying...' : 'Buy Now'}
                                                    </button>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="col-span-2 sm:col-span-3 lg:col-span-4 xl:col-span-5 text-center py-20">
                                            <p className="text-xl font-bold text-gray-400">
                                                {searchQuery ? `No NFTs found matching "${searchQuery}"` : 'No NFTs listed on marketplace'}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                );
        }
    };

    return (
        <div className="bg-white dark:bg-[#050505] text-yc-text-primary dark:text-white font-sans">

            {/* Sidebar Navigation (desktop only) */}
            <Sidebar
                activeSection={activeSection}
                setActiveSection={handleSectionChange}
                user={user}
                onSettingsClick={() => isConnected && profile && setIsProfileEditOpen(true)}
            />

            {/* Main Content Area */}
            <main className="w-full md:pl-72 xl:pr-64 min-h-screen pb-24 md:pb-6 overflow-x-hidden">
                <div className="w-full mx-auto p-4 md:p-6 max-w-full overflow-hidden">

                    {/* Top Bar */}
                    <div className="flex items-center justify-between mb-4 md:mb-8 py-2 md:py-4">

                        <div className="relative flex-1 max-w-md">
                            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4 md:w-5 md:h-5" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search..."
                                className="w-full bg-gray-100 dark:bg-[#121212] border-none rounded-2xl pl-10 md:pl-12 pr-4 py-2.5 md:py-3.5 text-sm font-medium text-yc-text-primary dark:text-white focus:outline-none focus:ring-2 focus:ring-yc-purple/20 transition-all placeholder-gray-400"
                            />
                        </div>

                        <div className="flex items-center space-x-2 md:space-x-6 ml-2 md:ml-6">
                            {/* Balance Display - desktop */}
                            {isConnected && (
                                <>
                                    <div className="text-right hidden lg:block">
                                        <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Balance</p>
                                        {balanceLoading ? (
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-yc-purple text-sm">◈</span>
                                                <div className="h-5 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                                            </div>
                                        ) : (
                                            <p className="text-lg font-black font-mono flex items-center">
                                                <span className="text-yc-purple text-sm mr-2">◈</span>
                                                {Number(ethers.formatEther(balance)).toFixed(2)} {activeNetwork.nativeCurrency.symbol}
                                            </p>
                                        )}
                                    </div>

                                    <div className="text-right hidden lg:block border-l border-gray-200 dark:border-gray-800 pl-6">
                                        <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Network</p>
                                        <p className={`text-sm font-bold ${isCorrectChain ? 'text-yc-green' : 'text-yc-purple'}`}>
                                            {isCorrectChain ? activeNetwork.shortName : 'Wrong Chain'}
                                        </p>
                                    </div>
                                </>
                            )}

                            {/* Wallet Button - desktop */}
                            <button
                                onClick={handleWalletClick}
                                disabled={isConnecting}
                                className={`
                                    hidden md:flex items-center px-6 py-3 rounded-xl font-bold text-sm transition-all shadow-lg active:scale-95
                                    ${isConnected
                                        ? isCorrectChain
                                            ? 'bg-yc-green/20 text-yc-green border border-yc-green/30 hover:bg-yc-green/30'
                                            : 'bg-yc-purple hover:bg-purple-600 text-white shadow-purple-500/20'
                                        : 'bg-yc-purple hover:bg-purple-600 text-white shadow-purple-500/20'
                                    }
                                `}
                            >
                                <Wallet className="w-4 h-4 mr-2" />
                                {isConnecting ? 'Connecting...' :
                                    isConnected ? (isCorrectChain ? formatAddress(address!) : 'Switch Network') :
                                        'Connect'}
                            </button>

                            {/* Mobile: Profile avatar button */}
                            <div className="relative md:hidden">
                                <button
                                    onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                                    className="w-9 h-9 rounded-full overflow-hidden border-2 border-gray-200 dark:border-gray-700 active:scale-95 transition-transform"
                                >
                                    {isConnected ? (
                                        <img
                                            src={user.avatar}
                                            alt="Profile"
                                            className="w-full h-full object-cover"
                                            style={{ imageRendering: user.avatar?.startsWith('data:') ? 'pixelated' : 'auto' }}
                                        />
                                    ) : (
                                        <div className="w-full h-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                                            <User className="w-4 h-4 text-gray-400" />
                                        </div>
                                    )}
                                </button>

                                {/* Mobile dropdown */}
                                {isMobileMenuOpen && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => setIsMobileMenuOpen(false)} />
                                        <div className="absolute right-0 top-12 z-50 w-64 glass-nav rounded-2xl shadow-2xl p-4 space-y-3">

                                            {/* User info */}
                                            {isConnected && (
                                                <div
                                                    className="flex items-center gap-3 p-2 rounded-xl bg-gray-50 dark:bg-[#121212] cursor-pointer active:scale-[0.98] transition-transform"
                                                    onClick={() => { setIsMobileMenuOpen(false); if (profile) setIsProfileEditOpen(true); }}
                                                >
                                                    <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-gray-200 dark:border-gray-700">
                                                        <img
                                                            src={user.avatar}
                                                            alt="Avatar"
                                                            className="w-full h-full object-cover"
                                                            style={{ imageRendering: user.avatar?.startsWith('data:') ? 'pixelated' : 'auto' }}
                                                        />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{user.name}</p>
                                                        <p className="text-[10px] text-gray-400 font-mono">{formatAddress(address!)}</p>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Balance */}
                                            {isConnected && (
                                                <div className="flex items-center justify-between p-2 rounded-xl bg-gray-50 dark:bg-[#121212]">
                                                    <span className="text-xs font-bold text-gray-400">Balance</span>
                                                    {balanceLoading ? (
                                                        <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                                                    ) : (
                                                        <span className="text-sm font-black font-mono text-gray-900 dark:text-white">
                                                            <span className="text-yc-purple mr-1">◈</span>
                                                            {Number(ethers.formatEther(balance)).toFixed(2)} {activeNetwork.nativeCurrency.symbol}
                                                        </span>
                                                    )}
                                                </div>
                                            )}

                                            {/* Connect / Switch */}
                                            {!isConnected ? (
                                                <button
                                                    onClick={() => { setIsMobileMenuOpen(false); connect(); }}
                                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-yc-purple text-white font-bold text-sm active:scale-95 transition-transform"
                                                >
                                                    <Wallet className="w-4 h-4" />
                                                    Connect Wallet
                                                </button>
                                            ) : !isCorrectChain ? (
                                                <button
                                                    onClick={() => { setIsMobileMenuOpen(false); switchChain(); }}
                                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-yc-purple text-white font-bold text-sm active:scale-95 transition-transform"
                                                >
                                                    <Wallet className="w-4 h-4" />
                                                    Switch Network
                                                </button>
                                            ) : null}

                                            {/* Network toggle */}
                                            <div className="flex items-center justify-between p-2">
                                                <span className="text-xs font-bold text-gray-400 uppercase">Network</span>
                                                <div className="flex bg-gray-200 dark:bg-[#121212] rounded-full p-0.5 gap-0.5">
                                                    {allNetworks.map((net) => (
                                                        <button
                                                            key={net.id}
                                                            onClick={() => { setIsMobileMenuOpen(false); handleNetworkSwitch(net.id); }}
                                                            className={`flex items-center gap-1 px-2 py-1.5 rounded-full text-xs font-bold transition-all ${networkId === net.id
                                                                    ? 'bg-yc-purple text-white shadow'
                                                                    : 'text-gray-400'
                                                                }`}
                                                        >
                                                            <span>{net.shortName}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Theme toggle */}
                                            <div className="flex items-center justify-between p-2">
                                                <span className="text-xs font-bold text-gray-400 uppercase">Theme</span>
                                                <div className="flex bg-gray-200 dark:bg-[#121212] rounded-full p-0.5">
                                                    <button
                                                        onClick={() => theme === 'dark' && toggleTheme()}
                                                        className={`p-1.5 rounded-full transition-all ${theme === 'light' ? 'bg-white shadow text-purple-500' : 'text-gray-400'}`}
                                                    >
                                                        <Sun size={14} />
                                                    </button>
                                                    <button
                                                        onClick={() => theme === 'light' && toggleTheme()}
                                                        className={`p-1.5 rounded-full transition-all ${theme === 'dark' ? 'bg-gray-700 text-white shadow' : 'text-gray-400'}`}
                                                    >
                                                        <Moon size={14} />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Disconnect */}
                                            {isConnected && (
                                                <button
                                                    onClick={() => { setIsMobileMenuOpen(false); disconnect(); }}
                                                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/10 text-red-500 font-bold text-sm active:scale-95 transition-transform"
                                                >
                                                    <LogOut size={14} />
                                                    Disconnect
                                                </button>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Dynamic Content */}
                    {renderContent()}

                </div>
            </main>

            {/* Right Widget Panel */}
            <RightPanel onOpenPack={() => setIsPackModalOpen(true)} />

            {/* Pack Opening Modal */}
            <PackOpeningModal
                isOpen={isPackModalOpen}
                onClose={() => setIsPackModalOpen(false)}
                onCardsAcquired={(cards) => {
                    if (address) {
                        updateServerCache(address, cards);
                    }
                }}
            />

            {/* Card Details Modal */}
            <CardDetailModal
                data={dashboardSelectedStartup}
                cardData={dashboardSelectedCard}
                onClose={() => {
                    setDashboardSelectedStartup(null);
                    setDashboardSelectedCard(null);
                }}
            />

            {/* Profile Setup Modal - shown on first wallet connection */}
            <ProfileSetupModal
                isOpen={isConnected && needsRegistration}
                address={address || ''}
                onComplete={registerUser}
            />

            {/* Profile Edit Modal - shown when clicking gear icon */}
            <ProfileEditModal
                isOpen={isProfileEditOpen}
                onClose={() => setIsProfileEditOpen(false)}
                address={address || ''}
                currentUsername={profile?.username || ''}
                currentAvatar={profile?.avatar || null}
                onSave={updateProfile}
            />

            {/* Bottom Navigation (mobile only) */}
            <BottomNav activeSection={activeSection} onNavigate={handleSectionChange} />

        </div>
    );
};

// No key={networkId} — data is shared across networks, components stay alive
// Network-specific UI (pack visual, price, currency) re-renders via useNetwork context

// Main App with providers + splash screen
const App: React.FC = () => {
    const [showSplash, setShowSplash] = useState(true);

    const handleSplashReady = useCallback(() => {
        setShowSplash(false);
    }, []);

    return (
        <ThemeProvider>
            <NetworkProvider>
                <WalletProvider>
                    {showSplash && <SplashScreen onReady={handleSplashReady} />}
                    <AppContent />
                </WalletProvider>
            </NetworkProvider>
        </ThemeProvider>
    );
};

export default App;