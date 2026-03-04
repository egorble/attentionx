import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import { createChart, ColorType, CandlestickSeries, IChartApi, ISeriesApi, LineData, Time } from 'lightweight-charts';
import { Timer, Trophy, Check, RefreshCw, Gift, TrendingUp, Search, BarChart2, CandlestickChart, List, X, ChevronDown } from 'lucide-react';
import { useWalletContext } from '../context/WalletContext';
import { useTheme } from '../context/ThemeContext';
import { useTokenLeagues, TOKENS } from '../hooks/useTokenLeagues';
import { useTokenLeaguesWS } from '../hooks/useTokenLeaguesWS';
import { currencySymbol } from '../lib/networks';
import { getTokenLeaguesContract } from '../lib/contracts';
import TokenLeaguesRightPanel from './TokenLeaguesRightPanel';
import { useOnboarding } from '../hooks/useOnboarding';
import OnboardingGuide, { OnboardingStep } from './OnboardingGuide';
import BoostPackModal from './BoostPackModal';

// ─── Token Leagues Guide ───

const TOKEN_LEAGUES_GUIDE: OnboardingStep[] = [
    {
        title: 'Pick 5 Tokens',
        description: 'Choose 5 tokens from 25 markets — crypto, stocks, or commodities. Tap a token to view its chart, tap the checkbox to select it for your lineup.',
        icon: '🎯',
    },
    {
        title: '10-Minute Cycles',
        description: 'Every cycle lasts 10 minutes. Once you enter, your tokens are locked in. Watch their prices move in real-time and climb the leaderboard.',
        icon: '⏱️',
    },
    {
        title: 'Score = Performance × 5',
        description: 'Your score is the average % price change of your 5 tokens, multiplied by 5× leverage. Pick tokens you think will pump!',
        icon: '📈',
    },
    {
        title: 'Win the Prize Pool',
        description: 'Entry fee is 0.001 ETH — 90% goes to the prize pool. Top performers split the pool proportionally. Claim your winnings anytime.',
        icon: '💰',
    },
];

// ─── Token Icon URLs ───

const ICON_BASE = 'https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/svg/color';
const COINGECKO = 'https://coin-images.coingecko.com/coins/images';
const STOCKS = 'https://raw.githubusercontent.com/davidepalazzo/ticker-logos/main/ticker_icons';

export const TOKEN_ICONS: Record<string, string> = {
    // Crypto — spothq SVGs
    BTC: `${ICON_BASE}/btc.svg`,
    ETH: `${ICON_BASE}/eth.svg`,
    BNB: `${ICON_BASE}/bnb.svg`,
    SOL: `${ICON_BASE}/sol.svg`,
    DOGE: `${ICON_BASE}/doge.svg`,
    XRP: `${ICON_BASE}/xrp.svg`,
    LINK: `${ICON_BASE}/link.svg`,
    ZEC: `${ICON_BASE}/zec.svg`,
    LTC: `${ICON_BASE}/ltc.svg`,
    AAVE: `${ICON_BASE}/aave.svg`,
    XMR: `${ICON_BASE}/xmr.svg`,
    // Crypto — CoinGecko
    TAO: `${COINGECKO}/28452/large/ARUsPeNQ_400x400.jpeg?1696527447`,
    PUMP: `${COINGECKO}/67164/large/pump.jpg?1751949376`,
    PENGU: `${COINGECKO}/52622/large/PUDGY_PENGUINS_PENGU_PFP.png?1733809110`,
    PEPE: `${COINGECKO}/29850/large/pepe-token.jpeg?1696528776`,
    HYPE: `${COINGECKO}/50882/large/hyperliquid.jpg?1729431300`,
    MNT: `${COINGECKO}/30980/large/MNT_Token_Logo.png?1765516974`,
    LIT: `${COINGECKO}/13825/large/logo_200x200.png?1696513568`,
    // Stocks — ticker-logos
    SPY: `${STOCKS}/SPY.png`,
    TSLA: `${STOCKS}/TSLA.png`,
    COIN: `${STOCKS}/COIN.png`,
    HOOD: `${STOCKS}/HOOD.png`,
    NVDA: `${STOCKS}/NVDA.png`,
    // Commodities — CoinGecko (gold/silver tokens)
    XAU: `${COINGECKO}/10481/large/Tether_Gold.png?1696510471`,
    XAG: `${COINGECKO}/29789/large/kag-currency-ticker.png?1696528719`,
};

export function TokenIcon({ symbol, color, size = 24 }: { symbol: string; color: string; size?: number }) {
    const [failed, setFailed] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const src = TOKEN_ICONS[symbol];

    if (!src || failed) {
        return (
            <div
                className="rounded-full flex items-center justify-center font-black text-white shrink-0 shadow-lg"
                style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.36 }}
            >
                {symbol.slice(0, 2)}
            </div>
        );
    }

    return (
        <div className="relative shrink-0" style={{ width: size, height: size }}>
            {!loaded && (
                <div
                    className="absolute inset-0 rounded-full animate-pulse"
                    style={{ backgroundColor: color + '33' }}
                >
                    <div className="w-full h-full rounded-full bg-gradient-to-br from-white/20 to-transparent" />
                </div>
            )}
            <img
                src={src}
                alt={symbol}
                width={size}
                height={size}
                className={`rounded-full shadow-lg transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
                onLoad={() => setLoaded(true)}
                onError={() => setFailed(true)}
            />
        </div>
    );
}

// ─── Category Definitions ───

const CATEGORIES = {
    all: { label: 'All', ids: TOKENS.map(t => t.id) },
    crypto: { label: 'Crypto', ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17] },
    stocks: { label: 'Stocks', ids: [18, 19, 20, 21, 22, 23] },
    commodities: { label: 'Commodities', ids: [24, 25] },
} as const;

type CategoryKey = keyof typeof CATEGORIES;

// ─── Format Helpers ───

function formatPrice(p: number): string {
    if (p === 0) return '$—';
    if (p >= 10000) return `$${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    if (p >= 100) return `$${p.toFixed(2)}`;
    if (p >= 1) return `$${p.toFixed(3)}`;
    if (p >= 0.001) return `$${p.toFixed(5)}`;
    return `$${p.toFixed(8)}`;
}

function formatChange(c: number): string {
    return `${c >= 0 ? '+' : ''}${c.toFixed(2)}%`;
}

// ─── TradingView Chart Component ───

interface TradingChartProps {
    tokenId: number;
    symbol: string;
    color: string;
    currentPrice: number;
}

function TradingChart({ tokenId, symbol, color, currentPrice }: TradingChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
    const lastPointRef = useRef<number>(0);
    const { theme } = useTheme();

    const [timeframe, setTimeframe] = useState<number>(1); // 1m default
    const rawDataRef = useRef<{ time: number, price: number }[]>([]);

    useEffect(() => {
        if (!containerRef.current) return;

        const isDark = theme === 'dark';
        const chart = createChart(containerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: isDark ? '#6b7280' : '#9ca3af',
                fontSize: 11,
            },
            grid: {
                vertLines: { color: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.04)' },
                horzLines: { color: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.04)' },
            },
            crosshair: {
                mode: 1,
                vertLine: { color: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)', width: 1, style: 2 },
                horzLine: { color: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)', width: 1, style: 2 },
            },
            rightPriceScale: {
                borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)',
                scaleMargins: { top: 0.1, bottom: 0.1 },
            },
            timeScale: {
                borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)',
                timeVisible: true,
                secondsVisible: false,
            },
            handleScale: { axisPressedMouseMove: true },
            handleScroll: { mouseWheel: true, pressedMouseMove: true },
        });

        const series = chart.addSeries(CandlestickSeries, {
            upColor: color,
            downColor: 'transparent',
            borderVisible: true,
            wickUpColor: color,
            wickDownColor: color,
            borderUpColor: color,
            borderDownColor: color,
            priceFormat: {
                type: 'price',
                precision: currentPrice >= 100 ? 2 : currentPrice >= 1 ? 4 : 6,
                minMove: currentPrice >= 100 ? 0.01 : currentPrice >= 1 ? 0.0001 : 0.000001,
            },
        });

        chartRef.current = chart;
        seriesRef.current = series as any;

        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                chart.applyOptions({ width, height });
            }
        });
        ro.observe(containerRef.current);

        return () => {
            ro.disconnect();
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
        };
    }, [tokenId, theme]);

    useEffect(() => {
        let cancelled = false;
        async function fetchHistory() {
            try {
                const res = await fetch(`/api/token-leagues/chart/${tokenId}`);
                const json = await res.json();
                if (cancelled || !json.success) return;

                rawDataRef.current = json.data;
                console.log(`[Chart] Loaded ${json.data.length} points for token ${tokenId}`);
                // Retry until series is ready (chart effect might not have finished)
                const tryUpdate = () => {
                    if (seriesRef.current) {
                        updateChartData();
                    } else {
                        setTimeout(tryUpdate, 100);
                    }
                };
                tryUpdate();
            } catch (err) {
                console.error('[Chart] Fetch error:', err);
            }
        }
        fetchHistory();
        return () => { cancelled = true; };
    }, [tokenId]);

    const updateChartData = useCallback(() => {
        if (!seriesRef.current || rawDataRef.current.length === 0) return;

        const intervalSec = timeframe * 60;
        const candles = [];
        let currentCandle = null;

        for (const point of rawDataRef.current) {
            const candleTime = Math.floor(point.time / intervalSec) * intervalSec;
            if (!currentCandle || currentCandle.time !== candleTime) {
                if (currentCandle) candles.push(currentCandle);
                currentCandle = {
                    time: candleTime as Time,
                    open: point.price,
                    high: point.price,
                    low: point.price,
                    close: point.price,
                };
            } else {
                currentCandle.high = Math.max(currentCandle.high, point.price);
                currentCandle.low = Math.min(currentCandle.low, point.price);
                currentCandle.close = point.price;
            }
        }
        if (currentCandle) candles.push(currentCandle);

        seriesRef.current.setData(candles);
        if (candles.length > 0) {
            lastPointRef.current = candles[candles.length - 1].time as number;
            chartRef.current?.timeScale().fitContent();
        }
    }, [timeframe]);

    useEffect(() => {
        updateChartData();
    }, [timeframe, updateChartData]);

    useEffect(() => {
        if (!seriesRef.current || currentPrice === 0) return;
        const now = Math.floor(Date.now() / 1000);
        rawDataRef.current.push({ time: now, price: currentPrice });
        // Trim to last 10000 points
        if (rawDataRef.current.length > 10000) {
            rawDataRef.current = rawDataRef.current.slice(-8000);
        }
        updateChartData();
    }, [currentPrice]);

    useEffect(() => {
        if (!seriesRef.current) return;
        seriesRef.current.applyOptions({
            upColor: color,
            wickUpColor: color,
            borderUpColor: color,
            wickDownColor: color,
            borderDownColor: color,
        });
    }, [color]);

    return (
        <div className="relative w-full h-full" style={{ minHeight: 300 }}>
            <div className="absolute top-1 left-1 z-10 flex flex-col gap-0.5 bg-white/50 dark:bg-zinc-950/50 backdrop-blur-2xl border border-white/30 dark:border-white/[0.06] rounded-xl p-0.5 shadow-[0_4px_16px_rgba(0,0,0,0.06)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
                {[
                    { val: 1, label: '1M' },
                    { val: 3, label: '3M' },
                    { val: 5, label: '5M' },
                    { val: 10, label: '10M' },
                    { val: 15, label: '15M' },
                ].map((tf) => (
                    <button
                        key={tf.label}
                        onClick={() => setTimeframe(tf.val)}
                        className={`px-1.5 py-1 rounded-lg text-[9px] font-black tracking-wider transition-colors ${timeframe === tf.val
                            ? 'bg-[#9333ea] text-white shadow-sm'
                            : 'text-gray-400 dark:text-zinc-500 hover:text-gray-900 dark:hover:text-white hover:bg-white/20 dark:hover:bg-white/10'
                            }`}
                    >
                        {tf.label}
                    </button>
                ))}
            </div>
            <div ref={containerRef} className="absolute inset-0" />
        </div>
    );
}

// ─── Countdown Timer ───

function CycleTimer({ endTime }: { endTime: number }) {
    const [timeLeft, setTimeLeft] = useState(0);

    useEffect(() => {
        function tick() {
            const left = Math.max(0, endTime - Math.floor(Date.now() / 1000));
            setTimeLeft(left);
        }
        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [endTime]);

    const mins = Math.floor(timeLeft / 60);
    const secs = timeLeft % 60;
    const urgent = timeLeft < 60;

    return (
        <span className={`font-mono font-black tabular-nums tracking-tighter ${urgent ? 'text-red-400 animate-pulse drop-shadow-[0_0_8px_rgba(248,113,113,0.5)]' : 'text-gray-900 dark:text-white'}`}>
            {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
        </span>
    );
}

// ─── Token Card (mobile compact 2-col grid) ───

interface TokenCardProps {
    token: typeof TOKENS[number];
    price: number;
    change24h: number;
    selected: boolean;
    active: boolean;
    onSelect: () => void;
    onClick: () => void;
}

function TokenCard({ token, price, change24h, selected, active, onSelect, onClick }: TokenCardProps) {
    return (
        <div
            onClick={onClick}
            className={`group flex flex-col items-center gap-1 p-2 rounded-2xl cursor-pointer transition-all border ${active
                ? 'bg-white/70 dark:bg-white/15 backdrop-blur-2xl border-[#9333ea] shadow-[0_0_12px_rgba(147,51,234,0.15),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_0_12px_rgba(147,51,234,0.15),inset_0_1px_0_rgba(255,255,255,0.05)]'
                : selected
                    ? 'bg-white/60 dark:bg-white/10 backdrop-blur-2xl border-[#9333ea]/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                    : 'bg-white/40 dark:bg-white/[0.04] backdrop-blur-xl border-white/40 dark:border-white/[0.08] hover:bg-white/60 dark:hover:bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] active:scale-[0.97]'
                }`}
        >
            {/* Checkbox top-left */}
            <div className="flex items-center justify-between w-full">
                <button
                    onClick={(e) => { e.stopPropagation(); onSelect(); }}
                    className={`w-4 h-4 rounded flex items-center justify-center border-2 shrink-0 transition-colors ${selected
                        ? 'bg-[#9333ea] border-[#9333ea]'
                        : 'bg-transparent border-gray-300 dark:border-zinc-500 group-hover:border-[#9333ea]/50'
                        }`}
                >
                    {selected && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                </button>
                <TokenIcon symbol={token.symbol} color={token.color} size={24} />
                <div className="w-4" />
            </div>
            <span className="text-[10px] font-black text-gray-900 dark:text-white leading-none">{token.symbol}</span>
            <span className="text-[10px] font-mono font-bold text-gray-500 dark:text-zinc-400 leading-none">{formatPrice(price)}</span>
        </div>
    );
}

// ─── Desktop Watchlist Item (sidebar mode) ───

interface WatchlistItemProps {
    token: typeof TOKENS[number];
    price: number;
    change24h: number;
    selected: boolean;
    active: boolean;
    onSelect: () => void;
    onClick: () => void;
}

function WatchlistItem({ token, price, change24h, selected, active, onSelect, onClick }: WatchlistItemProps) {
    return (
        <div
            className={`group flex items-center justify-between gap-2 p-2 cursor-pointer transition-colors rounded-xl border ${active
                ? 'bg-white/70 dark:bg-white/15 backdrop-blur-2xl border-[#9333ea] shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                : 'bg-white/40 dark:bg-white/[0.04] backdrop-blur-xl border-white/40 dark:border-white/[0.08] hover:bg-white/60 dark:hover:bg-white/10'
                }`}
            onClick={onClick}
        >
            <div className="flex items-center gap-2 min-w-0 flex-1">
                <button
                    onClick={(e) => { e.stopPropagation(); onSelect(); }}
                    className={`rounded-md flex items-center justify-center transition-colors border-2 shrink-0 w-4 h-4 ${selected
                        ? 'bg-[#9333ea] border-[#9333ea]'
                        : 'bg-transparent border-gray-300 dark:border-zinc-500 group-hover:border-[#9333ea]/50'
                        }`}
                >
                    {selected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </button>
                <TokenIcon symbol={token.symbol} color={token.color} size={24} />
                <span className="text-xs font-black text-gray-900 dark:text-white leading-tight truncate">{token.symbol}</span>
            </div>
            <span className="font-mono font-black text-gray-900 dark:text-white text-[11px] shrink-0">{formatPrice(price)}</span>
        </div>
    );
}

// ─── Compact Token Chip (horizontal strip when chart is open on mobile) ───

function CompactTokenChip({ token, price, change24h, selected, active, onSelect, onClick }: TokenCardProps) {
    return (
        <div
            onClick={onClick}
            className={`flex items-center gap-2 px-3 py-2 rounded-2xl shrink-0 border cursor-pointer transition-colors ${active
                ? 'bg-gray-100 dark:bg-zinc-800 border-[#9333ea]'
                : selected
                    ? 'bg-gray-100/50 dark:bg-zinc-800/50 border-[#9333ea]/40'
                    : 'bg-gray-50 dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 active:bg-gray-100 dark:active:bg-zinc-800'
                }`}
        >
            <button
                onClick={(e) => { e.stopPropagation(); onSelect(); }}
                className={`w-3.5 h-3.5 rounded flex items-center justify-center border-2 shrink-0 ${selected
                    ? 'bg-[#9333ea] border-[#9333ea]'
                    : 'bg-white dark:bg-zinc-900 border-gray-300 dark:border-zinc-700'
                    }`}
            >
                {selected && <Check className="w-2.5 h-2.5 text-black" strokeWidth={3} />}
            </button>
            <TokenIcon symbol={token.symbol} color={token.color} size={20} />
            <div className="flex flex-col min-w-0">
                <span className="text-[11px] font-black text-gray-900 dark:text-white leading-none">{token.symbol}</span>
                <span className="text-[9px] font-mono font-bold leading-none mt-0.5 text-gray-500 dark:text-zinc-400">
                    {formatPrice(price)}
                </span>
            </div>
        </div>
    );
}

// ─── Main Component ───

type Phase = 'selection' | 'in-cycle' | 'results';

const TokenLeagues: React.FC = () => {
    const { isConnected, address, connect } = useWalletContext();
    const { theme } = useTheme();
    const { enterCycle, claimPrize, loading, error, getClaimableBalance, hasEnteredCycle, getEntryFee, getUserTokens } = useTokenLeagues();
    const { prices, cycle, leaderboard, tokenPerformance, cycleResult, connected: wsConnected } = useTokenLeaguesWS();
    const { isVisible: showGuide, currentStep: guideStep, nextStep: guideNext, dismiss: guideDismiss } = useOnboarding('token-leagues');

    const [selectedTokens, setSelectedTokens] = useState<number[]>([]);
    const [hasEntered, setHasEntered] = useState(false);
    const [enteredTokens, setEnteredTokens] = useState<number[]>([]);
    const [enteredCycleId, setEnteredCycleId] = useState<number | null>(null);
    const [entryFee, setEntryFee] = useState('0.001');
    const [claimable, setClaimable] = useState<bigint>(0n);
    const [claimLoading, setClaimLoading] = useState(false);

    // Splash screen state
    const [splashVisible, setSplashVisible] = useState(true);
    const [splashFading, setSplashFading] = useState(false);

    // Layout state
    const [showChart, setShowChart] = useState(true);
    const [showLeaderboard, setShowLeaderboard] = useState(false);
    const [showBoostModal, setShowBoostModal] = useState(false);
    const [activeTokenId, setActiveTokenId] = useState<number>(1);
    const [category, setCategory] = useState<CategoryKey>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);
    const [isScrolled, setIsScrolled] = useState(false);

    useEffect(() => {
        const el = scrollRef.current;
        const onScroll = () => {
            const y = (el ? el.scrollTop : 0) || window.scrollY || 0;
            setIsScrolled(y > 10);
        };
        el?.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            el?.removeEventListener('scroll', onScroll);
            window.removeEventListener('scroll', onScroll);
        };
    }, []);

    // Splash: dismiss when data loaded or after max 3s
    useEffect(() => {
        if (!splashVisible) return;
        const hasData = Object.keys(prices).length > 0 && cycle !== null;
        const minTime = 2000; // min splash duration for animation
        const maxTime = 3500; // max splash even if no data

        const start = Date.now();
        const check = () => {
            const elapsed = Date.now() - start;
            const dataReady = Object.keys(prices).length > 0 && cycle !== null;
            if ((dataReady && elapsed >= minTime) || elapsed >= maxTime) {
                setSplashFading(true);
                setTimeout(() => setSplashVisible(false), 500); // fade-out duration
            } else {
                requestAnimationFrame(check);
            }
        };
        if (hasData) {
            // data already loaded, wait min animation time
            const timer = setTimeout(() => {
                setSplashFading(true);
                setTimeout(() => setSplashVisible(false), 500);
            }, minTime);
            return () => clearTimeout(timer);
        }
        const raf = requestAnimationFrame(check);
        return () => cancelAnimationFrame(raf);
    }, [splashVisible, prices, cycle]);

    // Phase
    const phase: Phase = useMemo(() => {
        let p: Phase = 'selection';
        if (cycleResult && (!cycle || cycle.status === 'finalizing')) p = 'results';
        else if (hasEntered && cycle && cycle.status === 'active') p = 'in-cycle';
        console.log(`[TL Phase] phase=${p} | hasEntered=${hasEntered} | cycle.id=${cycle?.id} cycle.status=${cycle?.status} | cycleResult=${!!cycleResult}`);
        return p;
    }, [hasEntered, cycle, cycleResult]);

    const activeToken = useMemo(() => TOKENS.find(t => t.id === activeTokenId) || TOKENS[0], [activeTokenId]);
    const activePrice = prices[activeTokenId]?.price || 0;
    const activeChange = prices[activeTokenId]?.change24h || 0;

    const filteredTokens = useMemo(() => {
        const catIds = CATEGORIES[category].ids as readonly number[];
        let list = TOKENS.filter(t => catIds.includes(t.id));
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            list = list.filter(t =>
                t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
            );
        }
        return list;
    }, [category, searchQuery]);

    const yourScore = useMemo(() => {
        if (!address || !leaderboard.length) return null;
        return leaderboard.find(e => e.address.toLowerCase() === address?.toLowerCase());
    }, [address, leaderboard]);

    useEffect(() => {
        if (!isConnected) return;
        getEntryFee().then(fee => setEntryFee(ethers.formatEther(fee)));
        getClaimableBalance().then(b => setClaimable(b));
    }, [isConnected, getEntryFee, getClaimableBalance]);

    // Reset state when cycle changes (new round)
    const prevCycleId = useRef<number | null>(null);
    useEffect(() => {
        if (!cycle) return;
        if (prevCycleId.current !== null && prevCycleId.current !== cycle.id) {
            console.log(`[TL CycleChange] 🔄 cycle changed ${prevCycleId.current} → ${cycle.id} — resetting entry state`);
            setHasEntered(false);
            setEnteredTokens([]);
            setSelectedTokens([]);
            setEnteredCycleId(null);
        }
        prevCycleId.current = cycle.id;
    }, [cycle?.id]);

    useEffect(() => {
        if (!cycle || !isConnected || !address) return;
        let cancelled = false;

        async function recoverEntry() {
            const wsCycleId = cycle!.id;
            console.log(`[TL Recover] === checking entry — WS cycle #${wsCycleId}, addr=${address} ===`);

            // Determine which cycle IDs to check
            const cycleIdsToCheck = [wsCycleId];
            try {
                const contract = getTokenLeaguesContract();
                const onChainId = Number(await contract.currentCycleId());
                console.log(`[TL Recover] on-chain currentCycleId: ${onChainId}`);
                if (onChainId !== wsCycleId && !cycleIdsToCheck.includes(onChainId)) {
                    cycleIdsToCheck.push(onChainId);
                    console.log(`[TL Recover] ⚠️ WS/on-chain desync: will check both #${wsCycleId} and #${onChainId}`);
                }
            } catch (err: any) {
                console.warn('[TL Recover] Could not read on-chain cycleId:', err?.message);
            }

            let entered = false;
            let tokens: number[] = [];
            let foundCycleId = wsCycleId;

            // Check each candidate cycle
            for (const cid of cycleIdsToCheck) {
                if (entered) break;

                // 1) Try on-chain
                try {
                    const result = await hasEnteredCycle(cid);
                    console.log(`[TL Recover] on-chain hasEntered(${cid})=${result}`);
                    if (result) {
                        tokens = await getUserTokens(cid);
                        console.log(`[TL Recover] on-chain getUserTokens(${cid}):`, tokens);
                        entered = true;
                        foundCycleId = cid;
                        break;
                    }
                } catch (err: any) {
                    console.warn(`[TL Recover] RPC check failed for cycle #${cid}:`, err?.message);
                }

                // 2) REST fallback
                if (!entered) {
                    try {
                        const url = `/api/token-leagues/entry/${cid}/${address}`;
                        console.log(`[TL Recover] REST fallback: GET ${url}`);
                        const res = await fetch(url);
                        const json = await res.json();
                        console.log(`[TL Recover] REST response for #${cid}:`, json);
                        if (json.success && json.data?.entered) {
                            entered = true;
                            tokens = json.data.tokenIds || [];
                            foundCycleId = cid;
                            break;
                        }
                    } catch (err: any) {
                        console.warn(`[TL Recover] REST fallback failed for #${cid}:`, err?.message);
                    }
                }
            }

            if (cancelled) return;

            console.log(`[TL Recover] RESULT: entered=${entered} foundCycle=#${foundCycleId} tokens=${JSON.stringify(tokens)}`);
            if (entered) {
                setHasEntered(true);
                setEnteredCycleId(foundCycleId);
                if (tokens.length > 0) {
                    setEnteredTokens(tokens);
                    setSelectedTokens(tokens);
                }
            } else {
                setHasEntered(false);
            }
        }

        recoverEntry();
        getClaimableBalance().then(b => { if (!cancelled) setClaimable(b); });

        return () => { cancelled = true; };
    }, [cycle?.id, isConnected, address, hasEnteredCycle, getUserTokens]);

    const toggleToken = useCallback((id: number) => {
        if (phase !== 'selection') return;
        setSelectedTokens(prev => {
            if (prev.includes(id)) return prev.filter(t => t !== id);
            if (prev.length >= 5) return prev;
            return [...prev, id];
        });
    }, [phase]);

    const handleTokenClick = useCallback((id: number) => {
        if (activeTokenId === id && showChart) {
            // Second tap on same token → toggle selection
            toggleToken(id);
        } else {
            setActiveTokenId(id);
            setShowChart(true);
        }
    }, [activeTokenId, showChart]);

    const handleEnter = async () => {
        console.log(`[TL handleEnter] selectedTokens=${JSON.stringify(selectedTokens)} wsCycle.id=${cycle?.id} wsConnected=${wsConnected}`);
        if (selectedTokens.length !== 5) return;
        try {
            const result = await enterCycle(selectedTokens);
            const actualCycleId = result?.cycleId;
            console.log(`[TL handleEnter] ✅ entered on-chain cycle #${actualCycleId} (WS shows #${cycle?.id})`);
            setHasEntered(true);
            setEnteredTokens(selectedTokens);
            if (actualCycleId) setEnteredCycleId(actualCycleId);
        } catch (err: any) {
            console.error('[TL handleEnter] ❌ enterCycle failed:', err?.message);
        }
    };

    const handleClaim = async () => {
        setClaimLoading(true);
        try {
            await claimPrize();
            setClaimable(0n);
        } catch { } finally {
            setClaimLoading(false);
        }
    };

    const handleBoosted = useCallback((tokenIds: number[], cycleId: number) => {
        setSelectedTokens(tokenIds);
        setEnteredTokens(tokenIds);
        setHasEntered(true);
        setEnteredCycleId(cycleId);
        setShowBoostModal(false);
    }, []);

    const displayTokens = phase === 'in-cycle' ? enteredTokens : selectedTokens;

    return (
        <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-zinc-950 text-gray-900 dark:text-white relative font-sans">

            {/* ─── Splash Screen ─── */}
            {splashVisible && (
                <div className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-white dark:bg-zinc-950 transition-opacity duration-500 ${splashFading ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
                    <svg width="180" height="44" viewBox="0 0 114 28" fill="none">
                        <style>{`
                            .sl{fill:transparent;stroke-width:.5px;stroke-dasharray:400;stroke-dashoffset:400;animation:slD 1.2s cubic-bezier(.25,.1,.25,1) forwards,slF .8s ease forwards}
                            .sl-w{stroke:rgba(107,114,128,.5)}.dark .sl-w{stroke:rgba(255,255,255,.5)}
                            .sl-g{stroke:#03DE82}
                            @keyframes slD{0%{stroke-dashoffset:400}100%{stroke-dashoffset:0}}
                            @keyframes slF{0%{fill:transparent;stroke-width:.5px}100%{fill:var(--fc);stroke-width:0}}
                            .sl1{animation-delay:0s,.8s;--fc:#1f2937}.dark .sl1{--fc:white}
                            .sl2{animation-delay:.15s,.95s;--fc:#1f2937}.dark .sl2{--fc:white}
                            .sl3{animation-delay:.3s,1.1s;--fc:#1f2937}.dark .sl3{--fc:white}
                            .sl4{animation-delay:.45s,1.25s;--fc:#1f2937}.dark .sl4{--fc:white}
                            .sl5{animation-delay:.45s,1.25s;--fc:#1f2937}.dark .sl5{--fc:white}
                            .sl6{animation-delay:.6s,1.4s;--fc:#03DE82}
                            .sl7{animation-delay:.75s,1.55s;--fc:#03DE82}
                            .sl8{animation-delay:.75s,1.55s;--fc:#03DE82}
                        `}</style>
                        <path className="sl sl-w sl1" d="M16.3332 0.037323H0.116577V4.68719H16.3332C16.9485 4.68843 17.5382 4.93391 17.9726 5.36969C18.4069 5.80547 18.6505 6.39589 18.6498 7.01119V9.33332H7.20991C5.32855 9.33407 3.52448 10.0819 2.19433 11.4124C0.864175 12.7429 0.116824 14.5472 0.116577 16.4285V27.9365H4.74964V17.0016L16.4779 27.9365H23.2875L8.32431 13.9841H18.6526V9.35759H23.2866V7.01119C23.2866 3.15746 20.172 0.037323 16.3332 0.037323Z"/>
                        <path className="sl sl-w sl2" d="M31.3226 0.037323H26.668V27.9365H31.3226V0.037323Z"/>
                        <path className="sl sl-w sl3" d="M34.732 9.28292C34.732 13.1357 37.8456 16.2568 41.6854 16.2568H49.5319C50.1483 16.2598 50.7383 16.5071 51.1726 16.9445C51.6069 17.3819 51.8499 17.9737 51.8484 18.5901V20.9617C51.8491 21.2665 51.7896 21.5683 51.6735 21.8501C51.5574 22.1318 51.3869 22.3879 51.1718 22.6038C50.9566 22.8196 50.7011 22.9909 50.4197 23.1079C50.1383 23.2249 49.8366 23.2854 49.5319 23.2857H34.732V27.9356H49.5319C53.3716 27.9356 56.4852 24.8145 56.4852 20.9617V18.5911C56.4852 14.7373 53.3716 11.6163 49.5356 11.6163H41.6872C41.0709 11.6133 40.4808 11.366 40.0465 10.9285C39.6123 10.4911 39.3692 9.89931 39.3707 9.28292V7.01492C39.3701 6.71019 39.4295 6.40832 39.5457 6.12657C39.6618 5.84482 39.8323 5.58871 40.0474 5.37288C40.2625 5.15705 40.5181 4.98573 40.7995 4.86872C41.0808 4.75171 41.3825 4.69129 41.6872 4.69092H55.0684V0.037323H41.6872C37.8484 0.037323 34.7339 3.15746 34.7339 7.01119V9.27919L34.732 9.28292Z"/>
                        <path className="sl sl-w sl4" d="M59.0771 7.01119V9.35852H63.7102V7.01119C63.7096 6.70645 63.769 6.40458 63.8851 6.12283C64.0012 5.84108 64.1717 5.58497 64.3868 5.36915C64.602 5.15332 64.8575 4.982 65.1389 4.86499C65.4203 4.74797 65.722 4.68756 66.0267 4.68719H80.988V0.037323H66.0267C62.187 0.037323 59.0734 3.15746 59.0734 7.01119H59.0771Z"/>
                        <path className="sl sl-w sl5" d="M66.1891 11.6125H79.4107V16.2568L66.1882 16.2633C65.5729 16.2646 64.9833 16.51 64.5489 16.9458C64.1145 17.3816 63.8709 17.972 63.8716 18.5873V20.958C63.871 21.2627 63.9305 21.5646 64.0466 21.8463C64.1627 22.1281 64.3332 22.3842 64.5483 22.6C64.7635 22.8159 65.019 22.9872 65.3004 23.1042C65.5818 23.2212 65.8834 23.2816 66.1882 23.282H80.9899V27.9328H66.1872C62.3484 27.9328 59.2339 24.808 59.2339 20.9589V18.5873C59.2339 14.7345 62.3484 11.6135 66.1835 11.6135H66.1872L66.1891 11.6125Z"/>
                        <path className="sl sl-g sl6" d="M113.039 0.037323V8.43732H107.261C106.941 8.43732 106.625 8.47466 106.322 8.55026C105.439 8.75694 104.651 9.25619 104.087 9.96694C103.523 10.6777 103.216 11.5582 103.215 12.4656V18.144H97.4958C96.4177 18.1445 95.3839 18.573 94.6216 19.3353C93.8592 20.0977 93.4307 21.1315 93.4302 22.2096V27.9365H85.0302V19.5431H90.7562C91.8345 19.5426 92.8685 19.1139 93.6308 18.3514C94.3932 17.5889 94.8216 16.5548 94.8218 15.4765V9.75052H101.15C101.232 9.74026 101.315 9.72999 101.391 9.71319C103.243 9.33052 104.641 7.69439 104.641 5.73906V0.037323H113.042H113.039Z"/>
                        <path className="sl sl-g sl7" d="M85.0293 0.037323H93.4265V6.52959C93.4265 7.03456 93.2259 7.51885 92.8688 7.87592C92.5118 8.23299 92.0275 8.43359 91.5225 8.43359H85.0293V0.037323Z"/>
                        <path className="sl sl-g sl8" d="M106.545 19.5393H113.039V27.9365H104.641V21.4433C104.641 20.9384 104.842 20.4541 105.199 20.097C105.556 19.7399 106.04 19.5393 106.545 19.5393Z"/>
                    </svg>
                    <span className="mb-4 text-[10px] font-medium text-gray-400 dark:text-zinc-500 uppercase tracking-[0.2em] order-first">Powered by</span>
                </div>
            )}

            {/* ─── Floating Island (timer + chart toggle) ─── */}
            <div className={`fixed top-[22px] md:top-3 left-2 md:left-[calc(18rem+0.5rem)] z-30 pointer-events-none floating-island ${!isScrolled ? 'floating-island-docked' : ''}`}>
                <div className="pointer-events-auto bg-white/60 dark:bg-zinc-900/60 backdrop-blur-2xl border border-white/40 dark:border-white/[0.08] rounded-full px-2 py-1.5 md:px-2.5 md:py-2 shadow-[0_8px_32px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)] flex items-center gap-1.5">
                    {cycle && cycle.status === 'active' && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full">
                            <Timer className="w-3.5 h-3.5 text-[#9333ea]" />
                            <CycleTimer endTime={cycle.endTime} />
                        </div>
                    )}
                    <button
                        onClick={() => setShowChart(!showChart)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10px] md:text-xs font-black transition-colors ${showChart
                            ? 'bg-[#9333ea] text-white'
                            : 'text-gray-400 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white hover:bg-white/20 dark:hover:bg-white/10'
                            }`}
                    >
                        <CandlestickChart className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={() => setShowLeaderboard(true)}
                        className="xl:hidden flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10px] font-black transition-colors text-gray-400 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white hover:bg-white/20 dark:hover:bg-white/10"
                    >
                        <List className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* ─── Right Floating Island (desktop: claim / boost) ─── */}
            <div className="hidden md:flex md:items-center fixed top-3 right-2 xl:right-[calc(16rem+1rem)] z-30 pointer-events-none min-h-[44px]">
                {isConnected && claimable > 0n ? (
                    <button
                        onClick={handleClaim}
                        disabled={claimLoading}
                        className="pointer-events-auto bg-emerald-500 backdrop-blur-2xl border border-emerald-400/30 text-white rounded-full px-5 py-2.5 shadow-[0_8px_32px_rgba(16,185,129,0.3)] flex items-center gap-2 font-black text-xs uppercase tracking-wider hover:bg-emerald-400 active:scale-[0.97] transition-all disabled:opacity-50"
                    >
                        <Gift className="w-3.5 h-3.5" />
                        {claimLoading ? 'Claiming...' : `Claim ${parseFloat(ethers.formatEther(claimable)).toFixed(4)} ${currencySymbol()}`}
                    </button>
                ) : phase === 'selection' && displayTokens.length === 0 && isConnected ? (
                    <div
                        onClick={() => setShowBoostModal(true)}
                        className="pointer-events-auto boost-border-anim rounded-full px-5 py-2.5 cursor-pointer hover:scale-[1.03] active:scale-[0.97] transition-transform flex items-center gap-2"
                    >
                        <span className="text-xs font-black text-zinc-800 dark:text-white uppercase tracking-wider">Boost Pack</span>
                        <span className="text-[10px] text-[#9333ea] font-bold">+5%</span>
                    </div>
                ) : phase === 'in-cycle' && yourScore ? (
                    <div className="pointer-events-auto bg-white/60 dark:bg-zinc-900/60 backdrop-blur-2xl border border-white/40 dark:border-white/[0.08] rounded-full px-5 py-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)] flex items-center gap-2">
                        <span className="text-[10px] text-gray-500 dark:text-zinc-400 font-black">
                            #<span className="text-[#9333ea] text-sm">{yourScore.rank}</span>
                        </span>
                        <span className={`font-mono font-black text-sm ${yourScore.score >= 0 ? 'text-[#9333ea]' : 'text-red-500'}`}>
                            {formatChange(yourScore.score)}
                        </span>
                    </div>
                ) : null}
            </div>

            {/* ─── Main Content (scrollable) ─── */}
            <div ref={scrollRef} className="flex-1 flex flex-col overflow-y-auto p-2 md:p-4 pt-4 md:pt-14 gap-3 md:gap-4 relative z-10 pb-24 md:pb-16 custom-scrollbar">

                {/* Error */}
                {error && (
                    <div className="px-4 py-2.5 bg-red-500/10 border border-red-500/30 rounded-xl shrink-0">
                        <p className="text-xs text-red-400 font-medium text-center">{error}</p>
                    </div>
                )}

                {/* ── My Position (in-cycle) ── */}
                {phase === 'in-cycle' && (
                    <div className="bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-[20px] md:rounded-[28px] p-3 md:p-4 shrink-0">
                        <div className="flex items-center justify-between mb-2.5">
                            <div className="flex items-center gap-2">
                                {yourScore && (
                                    <span className="bg-[#9333ea]/10 border border-[#9333ea]/20 text-[#9333ea] font-black text-xs px-2.5 py-1 rounded-full">
                                        #{yourScore.rank}
                                    </span>
                                )}
                                <span className="text-[10px] font-black text-gray-500 dark:text-zinc-400 uppercase tracking-wider">My Position</span>
                            </div>
                            {yourScore && (
                                <span className={`font-mono font-black text-lg ${yourScore.score >= 0 ? 'text-[#9333ea]' : 'text-red-500'}`}>
                                    {formatChange(yourScore.score)}
                                </span>
                            )}
                        </div>
                        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                            {enteredTokens.map(tokenId => {
                                const token = TOKENS.find(t => t.id === tokenId);
                                if (!token) return null;
                                const perf = tokenPerformance.find(p => p.tokenId === tokenId);
                                const pct = perf?.pctChange || 0;
                                return (
                                    <div
                                        key={tokenId}
                                        onClick={() => { setActiveTokenId(tokenId); setShowChart(true); }}
                                        className={`flex-1 min-w-0 flex flex-col items-center gap-1 p-2 rounded-2xl border cursor-pointer transition-colors ${
                                            activeTokenId === tokenId && showChart
                                                ? 'bg-gray-100 dark:bg-zinc-800 border-[#9333ea]/40'
                                                : 'bg-white dark:bg-zinc-950 border-gray-200 dark:border-zinc-800 hover:bg-gray-100 dark:hover:bg-zinc-800'
                                        }`}
                                    >
                                        <TokenIcon symbol={token.symbol} color={token.color} size={24} />
                                        <span className="text-[9px] font-black text-gray-900 dark:text-white leading-none">{token.symbol}</span>
                                        <span className={`text-[10px] font-mono font-black leading-none ${pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* ── Full Token Grid (when chart is closed) ── */}
                {!showChart && (
                    <div className="flex-1 flex flex-col min-w-0 bg-white/60 dark:bg-zinc-900/60 backdrop-blur-2xl border border-white/40 dark:border-white/[0.08] rounded-[20px] md:rounded-[32px] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)]">
                        {/* Header: Tabs & Search */}
                        <div className="p-3 md:p-5 border-b border-white/30 dark:border-white/[0.06] shrink-0 space-y-3">
                            <div className="flex items-center flex-wrap gap-1.5 md:gap-2">
                                {(Object.keys(CATEGORIES) as CategoryKey[]).map(key => (
                                    <button
                                        key={key}
                                        onClick={() => setCategory(key)}
                                        className={`whitespace-nowrap px-4 md:px-5 py-1.5 md:py-2 rounded-full text-[10px] md:text-xs font-black uppercase tracking-widest transition-all active:scale-95 ${category === key
                                            ? 'bg-[#9333ea] text-white'
                                            : 'text-gray-500 dark:text-zinc-400 hover:bg-white/30 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white'
                                            }`}
                                    >
                                        {CATEGORIES[key].label}
                                    </button>
                                ))}
                            </div>

                            <div className="flex items-center gap-2 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-xl border border-white/30 dark:border-white/[0.06] rounded-full px-3 py-2.5 text-sm focus-within:border-[#9333ea]/50 transition-colors">
                                <Search className="w-4 h-4 text-gray-400 dark:text-zinc-500" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search tokens..."
                                    className="bg-transparent text-xs md:text-sm font-medium text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-zinc-600 outline-none flex-1"
                                />
                            </div>

                            {/* Selection Counter */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                    {[0, 1, 2, 3, 4].map(i => (
                                        <div key={i} className={`w-2 h-2 md:w-2.5 md:h-2.5 rounded-full transition-colors ${i < displayTokens.length ? 'bg-[#9333ea]' : 'bg-white/30 dark:bg-white/10'}`} />
                                    ))}
                                    <span className="text-[10px] font-black text-gray-500 dark:text-zinc-400 ml-1.5 bg-white/30 dark:bg-white/10 px-2.5 py-0.5 rounded-full">
                                        {displayTokens.length}/5 Selected
                                    </span>
                                </div>
                                {phase === 'in-cycle' && (
                                    <span className="text-[10px] text-[#9333ea] font-black px-2.5 py-0.5 bg-[#9333ea]/10 rounded-full animate-pulse border border-[#9333ea]/20">IN PLAY</span>
                                )}
                            </div>
                        </div>

                        {/* Token Grid */}
                        <div className="flex-1 overflow-y-auto p-2 md:p-4 custom-scrollbar">
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-1.5 md:gap-2">
                                {filteredTokens.map(token => {
                                    const priceData = prices[token.id];
                                    const isSelected = displayTokens.includes(token.id);
                                    return (
                                        <TokenCard
                                            key={token.id}
                                            token={token}
                                            price={priceData?.price || 0}
                                            change24h={priceData?.change24h || 0}
                                            selected={isSelected}
                                            active={token.id === activeTokenId}
                                            onSelect={() => toggleToken(token.id)}
                                            onClick={() => handleTokenClick(token.id)}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Chart Panel ── */}
                {showChart && (
                    <div className="flex flex-col bg-white/60 dark:bg-zinc-900/60 backdrop-blur-2xl border border-white/40 dark:border-white/[0.08] rounded-[20px] md:rounded-[32px] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)] relative min-w-0 animate-in fade-in zoom-in-95 duration-300">
                        {/* Token header */}
                        <div className="flex items-center justify-between p-3 md:p-4 border-b border-white/30 dark:border-white/[0.06] shrink-0 gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                                <TokenIcon symbol={activeToken.symbol} color={activeToken.color} size={32} />
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <h2 className="font-black text-sm md:text-lg text-gray-900 dark:text-white truncate">{activeToken.name}</h2>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <div className="flex items-center gap-1.5 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-xl border border-white/30 dark:border-white/[0.06] rounded-full px-3 py-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.3)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]">
                                    <span className="font-mono font-black text-sm md:text-base text-gray-900 dark:text-white leading-none tracking-tight">{formatPrice(activePrice)}</span>
                                    <span className={`font-mono font-bold text-[10px] md:text-xs px-1.5 py-0.5 rounded-full ${activeChange >= 0 ? 'text-green-600 dark:text-green-400 bg-green-500/10' : 'text-red-500 bg-red-500/10'
                                        }`}>{formatChange(activeChange)}</span>
                                </div>
                                <button
                                    onClick={() => setShowChart(false)}
                                    className="p-2 hover:bg-white/30 dark:hover:bg-white/10 rounded-full transition-colors text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white shrink-0"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Chart */}
                        <div className="relative p-2 md:p-3 h-[280px] md:h-[360px]">
                            <TradingChart
                                key={`${activeTokenId}-${theme}`}
                                tokenId={activeTokenId}
                                symbol={activeToken.symbol}
                                color={activeToken.color}
                                currentPrice={activePrice}
                            />
                        </div>
                    </div>
                )}

                {/* ── Token Grid (always visible below chart) ── */}
                {showChart && (
                    <div className="bg-white/60 dark:bg-zinc-900/60 backdrop-blur-2xl border border-white/40 dark:border-white/[0.08] rounded-[20px] md:rounded-[32px] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)]">
                        <div className="p-2 md:p-3 space-y-2">
                            <div className="flex items-center flex-wrap gap-1.5">
                                {(Object.keys(CATEGORIES) as CategoryKey[]).map(key => (
                                    <button
                                        key={key}
                                        onClick={() => setCategory(key)}
                                        className={`whitespace-nowrap px-3 py-1 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 ${category === key
                                            ? 'bg-[#9333ea] text-white'
                                            : 'text-gray-500 dark:text-zinc-400 hover:bg-white/30 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white'
                                            }`}
                                    >
                                        {CATEGORIES[key].label}
                                    </button>
                                ))}
                                <span className="text-[9px] font-black text-gray-400 dark:text-zinc-500 bg-gray-200 dark:bg-zinc-800 px-2 py-1 rounded-full ml-auto">{displayTokens.length}/5</span>
                            </div>
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-1.5 md:gap-2">
                                {filteredTokens.map(token => {
                                    const priceData = prices[token.id];
                                    const isSelected = displayTokens.includes(token.id);
                                    return (
                                        <TokenCard
                                            key={token.id}
                                            token={token}
                                            price={priceData?.price || 0}
                                            change24h={priceData?.change24h || 0}
                                            selected={isSelected}
                                            active={token.id === activeTokenId}
                                            onSelect={() => toggleToken(token.id)}
                                            onClick={() => handleTokenClick(token.id)}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {/* ─── Claim Section (bottom of content) ─── */}
                {isConnected && claimable > 0n && (
                    <button
                        onClick={handleClaim}
                        disabled={claimLoading}
                        className="w-full bg-emerald-500 text-white py-2.5 md:py-3 rounded-xl font-black text-[11px] md:text-xs uppercase tracking-wider hover:bg-emerald-400 active:scale-[0.98] transition-all shadow-[0_4px_20px_rgba(16,185,129,0.3)] disabled:opacity-50 flex items-center justify-center gap-1.5 shrink-0"
                    >
                        <Gift className="w-3.5 h-3.5" />
                        {claimLoading ? 'Claiming...' : `Claim ${parseFloat(ethers.formatEther(claimable)).toFixed(4)} ${currencySymbol()}`}
                    </button>
                )}

            </div>

            {/* ─── Floating Bottom: Two Islands ─── */}
            <div className="fixed bottom-[84px] md:bottom-4 left-0 md:left-72 right-0 xl:right-64 z-30 px-3 pointer-events-none flex items-end justify-between gap-2">
                {/* Island 1: Selected tokens OR Boost Pack promo */}
                {phase === 'selection' && displayTokens.length === 0 && isConnected ? (
                    <div
                        onClick={() => setShowBoostModal(true)}
                        className="pointer-events-auto boost-border-anim rounded-full px-4 py-2.5 md:px-6 md:py-3.5 cursor-pointer hover:scale-[1.03] active:scale-[0.97] transition-transform flex items-center gap-2 md:gap-3"
                    >
                        <span className="text-xs md:text-sm font-black text-zinc-800 dark:text-white uppercase tracking-wider">Boost Pack</span>
                        <span className="text-[10px] md:text-xs text-[#9333ea] font-bold">+5%</span>
                    </div>
                ) : (
                <div className="pointer-events-auto bg-white/60 dark:bg-zinc-900/60 backdrop-blur-2xl border border-white/40 dark:border-white/[0.08] rounded-full p-1 md:p-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)] flex items-center gap-0.5 md:gap-1.5">
                    {[0, 1, 2, 3, 4].map(i => {
                        const tokenId = displayTokens[i];
                        const token = tokenId ? TOKENS.find(t => t.id === tokenId) : null;
                        return (
                            <div
                                key={i}
                                onClick={() => token && phase === 'selection' && toggleToken(tokenId!)}
                                className={`w-9 h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center transition-all duration-300 ${token
                                    ? 'scale-100 cursor-pointer hover:opacity-70 active:scale-90'
                                    : 'bg-gray-100 dark:bg-zinc-800/60 border border-dashed border-gray-300 dark:border-zinc-700'
                                }`}
                            >
                                {token ? (
                                    <>
                                        <span className="md:hidden"><TokenIcon symbol={token.symbol} color={token.color} size={24} /></span>
                                        <span className="hidden md:flex"><TokenIcon symbol={token.symbol} color={token.color} size={36} /></span>
                                    </>
                                ) : (
                                    <span className="text-gray-400 dark:text-zinc-600 text-[9px] md:text-[10px] font-black">{i + 1}</span>
                                )}
                            </div>
                        );
                    })}
                </div>
                )}

                {/* Island 2: Action button */}
                <div className="pointer-events-auto shrink-0">
                    {!isConnected ? (
                        <button
                            onClick={connect}
                            className="bg-[#9333ea] text-white px-5 py-3 md:px-7 md:py-4 rounded-full font-black text-xs md:text-sm uppercase tracking-widest hover:bg-[#a855f7] active:scale-[0.97] transition-all shadow-[0_4px_30px_rgba(147,51,234,0.4)]"
                        >
                            Connect
                        </button>
                    ) : phase === 'selection' ? (
                        <button
                            onClick={handleEnter}
                            disabled={selectedTokens.length !== 5 || loading}
                            className="bg-[#9333ea] text-white px-5 py-3 md:px-7 md:py-4 rounded-full font-black text-[11px] md:text-sm uppercase tracking-widest disabled:opacity-40 flex items-center gap-1.5 md:gap-2 hover:bg-[#a855f7] active:scale-[0.97] transition-all shadow-[0_4px_30px_rgba(147,51,234,0.4)]"
                        >
                            {loading && <RefreshCw className="w-3.5 h-3.5 md:w-4 md:h-4 animate-spin" />}
                            {loading ? '...' : `Enter · ${entryFee}`}
                        </button>
                    ) : phase === 'in-cycle' && yourScore ? (
                        <div className="bg-white/60 dark:bg-zinc-900/60 backdrop-blur-2xl border border-white/40 dark:border-white/[0.08] rounded-full px-4 py-2.5 md:px-6 md:py-3.5 shadow-[0_8px_32px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)] flex items-center gap-3">
                            <span className="text-[10px] md:text-xs text-gray-500 dark:text-zinc-400 font-black">
                                #<span className="text-[#9333ea] text-sm md:text-lg">{yourScore.rank}</span>
                            </span>
                            <span className={`font-mono font-black text-base md:text-xl ${yourScore.score >= 0 ? 'text-[#9333ea]' : 'text-red-500'}`}>
                                {formatChange(yourScore.score)}
                            </span>
                        </div>
                    ) : phase === 'in-cycle' ? (
                        <div className="bg-white/60 dark:bg-zinc-900/60 backdrop-blur-2xl border border-[#9333ea]/20 rounded-full px-4 py-2.5 md:px-6 md:py-3.5 shadow-[0_8px_32px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)]">
                            <span className="text-xs md:text-sm text-[#9333ea] font-black uppercase tracking-widest animate-pulse">In Play</span>
                        </div>
                    ) : (
                        <div className="bg-white/60 dark:bg-zinc-900/60 backdrop-blur-2xl border border-white/40 dark:border-white/[0.08] rounded-full px-4 py-2.5 md:px-6 md:py-3.5 shadow-[0_8px_32px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)]">
                            <span className="text-xs md:text-sm text-gray-400 dark:text-zinc-500 font-bold">Waiting...</span>
                        </div>
                    )}
                </div>
            </div>

            {/* ─── Leaderboard Sheet (mobile) ─── */}
            {showLeaderboard && (
                <div className="fixed inset-0 z-50 xl:hidden animate-in fade-in duration-200" onClick={() => setShowLeaderboard(false)}>
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
                    <div
                        className="absolute bottom-0 left-0 right-0 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-2xl border-t border-white/40 dark:border-white/[0.08] rounded-t-[28px] max-h-[80vh] flex flex-col animate-in slide-in-from-bottom-8 duration-300 shadow-[0_-8px_32px_rgba(0,0,0,0.1)] dark:shadow-[0_-8px_32px_rgba(0,0,0,0.5)]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Handle */}
                        <div className="flex justify-center pt-3 pb-1 shrink-0">
                            <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-zinc-700" />
                        </div>
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 pb-3 shrink-0">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-[#9333ea] animate-pulse" />
                                <span className="text-sm font-black text-gray-900 dark:text-white">Live Ranks</span>
                            </div>
                            <button onClick={() => setShowLeaderboard(false)} className="p-1.5 bg-gray-200 dark:bg-zinc-800 rounded-full hover:bg-gray-300 dark:hover:bg-zinc-700 transition-colors">
                                <X className="w-4 h-4 text-gray-500 dark:text-zinc-400" />
                            </button>
                        </div>
                        {/* Content */}
                        <div className="flex-1 overflow-y-auto px-3 pb-24 custom-scrollbar">
                            <TokenLeaguesRightPanel isMobile />
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Results Overlay ─── */}
            {phase === 'results' && cycleResult && (
                <div className="fixed inset-0 bg-black/50 dark:bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-300">
                    <div className="bg-white/80 dark:bg-zinc-900/80 backdrop-blur-2xl border border-white/40 dark:border-white/[0.08] rounded-[32px] p-6 md:p-8 max-w-lg w-full shadow-[0_8px_40px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_8px_40px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.05)] overflow-hidden relative">
                        {/* Shimmer top border */}
                        <div className="absolute top-0 left-0 w-full h-1.5 bg-[#9333ea]" />

                        <div className="text-center mb-6">
                            <div className="flex items-center justify-center p-3 w-14 h-14 rounded-[24px] bg-[#9333ea]/10 border border-[#9333ea]/20 mx-auto mb-3">
                                <Trophy className="w-7 h-7 text-[#9333ea]" />
                            </div>
                            <h2 className="font-black text-2xl text-gray-900 dark:text-white mb-3">Cycle #{cycleResult.cycleId} Over</h2>
                            <p className="inline-block bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 px-4 py-1.5 rounded-full text-sm font-bold text-gray-600 dark:text-zinc-300">
                                Prize Pool: <span className="text-[#9333ea] font-mono tracking-tight">{cycleResult.prizePool} {currencySymbol()}</span>
                            </p>
                        </div>

                        <div className="space-y-2 mb-6 max-h-60 overflow-y-auto px-1 custom-scrollbar">
                            {cycleResult.leaderboard.slice(0, 10).map((entry: any, i: number) => {
                                const isYou = entry.playerAddress.toLowerCase() === address?.toLowerCase();
                                return (
                                    <div key={entry.playerAddress} className={`flex items-center justify-between px-3 py-2.5 rounded-2xl border transition-colors ${isYou ? 'bg-gray-100 dark:bg-zinc-800 border-[#9333ea]' : 'bg-gray-50 dark:bg-zinc-950 border-gray-200 dark:border-zinc-800'}`}>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-black w-7 text-center shrink-0">
                                                {i < 3 ? ['🥇', '🥈', '🥉'][i] : <span className="text-gray-400 dark:text-zinc-500 text-xs">{entry.rank}</span>}
                                            </span>
                                            <span className={`text-xs font-bold ${isYou ? 'text-[#9333ea]' : 'text-gray-900 dark:text-white'}`}>
                                                {isYou ? 'You' : `${entry.playerAddress.substring(0, 6)}...`}
                                            </span>
                                        </div>
                                        <div className="text-right">
                                            <span className={`font-mono text-xs font-black px-2 py-0.5 rounded-md ${entry.score >= 0
                                                ? 'text-[#9333ea] bg-[#9333ea]/10'
                                                : 'text-red-400 bg-red-400/10'
                                                }`}>
                                                {formatChange(entry.score)}
                                            </span>
                                            {parseFloat(entry.prizeAmount) > 0 && (
                                                <span className="block mt-1 text-[10px] text-[#9333ea] font-black">
                                                    +{ethers.formatEther(BigInt(entry.prizeAmount))} {currencySymbol()}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <button
                            onClick={() => {
                                setHasEntered(false);
                                setSelectedTokens([]);
                                setEnteredTokens([]);
                            }}
                            className="w-full bg-[#9333ea] text-black py-4 rounded-full font-black text-sm uppercase tracking-widest hover:bg-[#a855f7] transition-colors active:scale-[0.97]"
                        >
                            Draft Next Cycle
                        </button>
                    </div>
                </div>
            )}

            {/* Onboarding Guide */}
            {showGuide && (
                <OnboardingGuide
                    steps={TOKEN_LEAGUES_GUIDE}
                    currentStep={guideStep}
                    onNext={() => guideNext(TOKEN_LEAGUES_GUIDE.length)}
                    onDismiss={guideDismiss}
                />
            )}

            {/* Boost Pack Modal */}
            <BoostPackModal
                isOpen={showBoostModal}
                onClose={() => setShowBoostModal(false)}
                onBoosted={handleBoosted}
            />
        </div>
    );
};

export default TokenLeagues;
