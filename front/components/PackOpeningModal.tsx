import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { CardData, sortByRarity } from '../types';
import { Layers, Package, Minus, Plus, ChevronDown } from 'lucide-react';
import { usePacks } from '../hooks/usePacks';
import { useWalletContext } from '../context/WalletContext';
import { formatXTZ } from '../lib/contracts';
import { currencySymbol, getActiveNetwork } from '../lib/networks';
import ModelViewer3D from './ModelViewer3D';
import gsap from 'gsap';

interface PackOpeningModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCardsAcquired?: (cards: CardData[]) => void;
}

const PackOpeningModal: React.FC<PackOpeningModalProps> = ({ isOpen, onClose, onCardsAcquired }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const packRef = useRef<HTMLDivElement>(null);
    const flashRef = useRef<HTMLDivElement>(null);
    const cardsContainerRef = useRef<HTMLDivElement>(null);
    const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
    const ctx = useRef<gsap.Context | null>(null);

    // Stages: select → buying → tearing → exploding → dealing → finished
    const [stage, setStage] = useState<'select' | 'buying' | 'tearing' | 'exploding' | 'dealing' | 'finished'>('select');
    const [packCount, setPackCount] = useState(1);
    const [cardsDealtCount, setCardsDealtCount] = useState(0);
    const [mintedCards, setMintedCards] = useState<CardData[]>([]);
    const packPrice = getActiveNetwork().packPrice;
    const [txError, setTxError] = useState<string | null>(null);
    const [pendingCards, setPendingCards] = useState<CardData[] | null>(null);
    const [cuts, setCuts] = useState<string[]>([]);
    const maxTaps = 5;

    const isMultiPack = packCount > 1;

    // Hooks
    const { isConnected, getSigner, connect, isCorrectChain, switchChain, refreshBalance } = useWalletContext();
    const { buyAndOpenPack, buyAndOpenMultiplePacks, isLoading } = usePacks();

    // Helper: Generate jagged tear path
    const generateTearPath = (seed: number) => {
        const isHorizontal = Math.random() > 0.5;
        const start = isHorizontal
            ? { x: 0, y: 10 + Math.random() * 80 }
            : { x: 10 + Math.random() * 80, y: 0 };
        const end = isHorizontal
            ? { x: 100, y: 10 + Math.random() * 80 }
            : { x: 10 + Math.random() * 80, y: 100 };

        let d = `M ${start.x} ${start.y}`;
        const steps = 8;
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            const lx = start.x + (end.x - start.x) * t;
            const ly = start.y + (end.y - start.y) * t;
            const noise = (Math.random() - 0.5) * 15;
            d += ` L ${lx + noise} ${ly + noise}`;
        }
        d += ` L ${end.x} ${end.y}`;
        return d;
    };

    // Initialize GSAP Context
    useLayoutEffect(() => {
        if (isOpen && stage !== 'select') {
            ctx.current = gsap.context(() => { }, containerRef);
        }
        return () => {
            ctx.current?.revert();
        };
    }, [isOpen, stage]);

    // Reset on close
    useEffect(() => {
        if (!isOpen) {
            ctx.current?.revert();
            setStage('select');
            setPackCount(1);
            setCardsDealtCount(0);
            setMintedCards([]);
            setPendingCards(null);
            setCuts([]);
            cardRefs.current = [];
            setTxError(null);
        }
    }, [isOpen]);

    // Handle "Dealing" Logic (single pack only)
    useLayoutEffect(() => {
        if (stage === 'dealing' && !isMultiPack && ctx.current) {
            ctx.current.add(() => {
                setTimeout(() => prepareStack(), 100);
            });
        }
    }, [stage]);

    // Clean up GSAP when entering finished stage — prevent residual 3D transforms
    useLayoutEffect(() => {
        if (stage === 'finished') {
            cardRefs.current.forEach(card => {
                if (card) {
                    gsap.killTweensOf(card);
                    gsap.set(card, { clearProps: 'all' });
                    const inner = card.querySelector('.card-inner');
                    if (inner) {
                        gsap.killTweensOf(inner);
                        gsap.set(inner, { clearProps: 'all' });
                    }
                }
            });
            cardRefs.current = [];
        }
    }, [stage]);

    // When pendingCards is set, transition
    useLayoutEffect(() => {
        if (pendingCards && stage === 'buying') {
            setMintedCards(sortByRarity(pendingCards));
            setPendingCards(null);
            setStage('exploding');
        }
    }, [pendingCards, stage]);

    // Exploding stage animation — burst effect
    useLayoutEffect(() => {
        if (stage !== 'exploding' || !ctx.current) return;

        ctx.current.add(() => {
            const tl = gsap.timeline({
                onComplete: () => setStage(isMultiPack ? 'finished' : 'dealing'),
            });
            if (flashRef.current) {
                tl.to(flashRef.current, { opacity: 0.8, duration: 0.15, ease: 'power4.in' })
                  .to(flashRef.current, { opacity: 0, duration: 0.5, ease: 'power2.out' });
            } else {
                setStage(isMultiPack ? 'finished' : 'dealing');
            }
        });
    }, [stage]);

    // Handle Pack Taps (Tearing) — single pack only
    const handleTapPack = () => {
        if (stage !== 'tearing') return;
        const newCount = cuts.length + 1;
        setCuts(prev => [...prev, generateTearPath(newCount)]);

        if (packRef.current && ctx.current) {
            ctx.current.add(() => {
                gsap.killTweensOf(packRef.current);
                const tl = gsap.timeline();
                tl.to(packRef.current, {
                    x: () => (Math.random() - 0.5) * 20,
                    y: () => (Math.random() - 0.5) * 20,
                    rotation: () => (Math.random() - 0.5) * 10,
                    duration: 0.05, repeat: 3, yoyo: true, ease: "rough"
                }).to(packRef.current, { x: 0, y: 0, rotation: 0, duration: 0.2 });
            });
        }

        if (newCount >= maxTaps) setStage('exploding');
    };

    // Buy and open packs
    const handleBuyAndOpen = async () => {
        if (stage !== 'select') return;

        if (!isConnected) { await connect(); return; }
        if (!isCorrectChain) { await switchChain(); return; }

        setStage('buying');
        setTxError(null);

        try {
            const signer = await getSigner();
            if (!signer) { setTxError('Failed to get signer'); setStage('select'); return; }

            const result = packCount > 1
                ? await buyAndOpenMultiplePacks(signer, packCount)
                : await buyAndOpenPack(signer);

            if (result.success && result.cards) {
                setPendingCards(result.cards);
                onCardsAcquired?.(result.cards);
                refreshBalance();
            } else {
                setTxError(result.error || 'Failed to buy pack');
                setStage('select');
            }
        } catch (e: any) {
            setTxError(e.message);
            setStage('select');
        }
    };

    const prepareStack = () => {
        const cards = cardRefs.current;
        if (!cards || cards.length === 0) return;
        const stackX = window.innerWidth / 2;
        const isMobile = window.innerWidth < 640;
        const stackY = window.innerHeight - (isMobile ? 100 : 150);

        cards.forEach((card, i) => {
            if (!card) return;
            const rect = card.getBoundingClientRect();
            const cardCenterX = rect.width ? rect.left + rect.width / 2 : stackX;
            const cardCenterY = rect.height ? rect.top + rect.height / 2 : stackY;
            gsap.set(card, {
                x: stackX - cardCenterX, y: stackY - cardCenterY, z: 0,
                zIndex: 50 - i, rotation: (Math.random() - 0.5) * 10, scale: 0.8, autoAlpha: 1
            });
            const inner = card.querySelector('.card-inner');
            if (inner) gsap.set(inner, { rotationY: 180 });
        });
    };

    const dealNextCard = () => {
        if (cardsDealtCount >= mintedCards.length) return;
        const card = cardRefs.current[cardsDealtCount];
        if (card && ctx.current) {
            ctx.current.add(() => {
                gsap.to(card, {
                    x: 0, y: 0, rotation: 0, scale: 1, zIndex: 100,
                    duration: 0.5, ease: "back.out(1.2)",
                    onComplete: () => gsap.set(card, { zIndex: 1 })
                });
                const inner = card.querySelector('.card-inner');
                if (inner) gsap.to(inner, { rotationY: 0, duration: 0.4, delay: 0.1, ease: "power2.out" });
            });
        }
        const nextCount = cardsDealtCount + 1;
        setCardsDealtCount(nextCount);
        if (nextCount === mintedCards.length) setTimeout(() => setStage('finished'), 800);
    };

    const totalPrice = packPrice * BigInt(packCount);

    return (
        <div ref={containerRef} className={`fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md overflow-hidden ${isOpen ? '' : 'invisible pointer-events-none'}`}>
            {/* Flash Overlay */}
            <div ref={flashRef} className="absolute inset-0 bg-white pointer-events-none opacity-0 z-[60]" />

            {/* --- STAGE: PACK SELECTION --- */}
            {stage === 'select' && (
                <div className="flex flex-col items-center w-full h-full px-4 py-4 sm:py-0 sm:justify-center">
                    {/* 3D pack — takes upper space */}
                    <div className="relative w-full flex-1 min-h-0 max-h-[65%] shrink mb-2">
                        <ModelViewer3D mode="interactive" cameraZ={4.5} modelScale={1} paused={!isOpen} />
                        {packCount > 1 && (
                            <div className="absolute top-2 right-2 w-9 h-9 bg-yc-orange rounded-full flex items-center justify-center text-white font-black text-base shadow-lg shadow-orange-500/30 z-10">
                                {packCount}x
                            </div>
                        )}
                    </div>

                    {/* Pack count selector */}
                    <div className="flex items-center gap-3 sm:gap-4 mb-3 shrink-0">
                        <button
                            onClick={() => setPackCount(Math.max(1, packCount - 1))}
                            className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors active:scale-90"
                        >
                            <Minus className="w-4 h-4 sm:w-5 sm:h-5" />
                        </button>
                        <div className="text-center min-w-[80px] sm:min-w-[100px]">
                            <p className="text-2xl sm:text-3xl font-black text-white">{packCount}</p>
                            <p className="text-gray-500 text-[10px] sm:text-xs uppercase tracking-wider">{packCount === 1 ? 'Pack' : 'Packs'} ({packCount * 5} cards)</p>
                        </div>
                        <button
                            onClick={() => setPackCount(Math.min(10, packCount + 1))}
                            className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors active:scale-90"
                        >
                            <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
                        </button>
                    </div>

                    {/* Price */}
                    <div className="text-center mb-3 shrink-0">
                        <p className="text-yc-orange font-mono font-bold text-xl sm:text-2xl">{formatXTZ(totalPrice)} {currencySymbol()}</p>
                        {packCount > 1 && (
                            <p className="text-gray-500 text-xs mt-1">{formatXTZ(packPrice)} per pack</p>
                        )}
                    </div>

                    {/* Error */}
                    {txError && (
                        <div className="bg-red-500/20 border border-red-500 rounded-lg px-4 py-2 text-red-400 text-sm max-w-xs text-center mb-3 shrink-0">
                            {txError}
                        </div>
                    )}

                    {/* Buy button */}
                    <button
                        onClick={handleBuyAndOpen}
                        className="bg-yc-orange hover:bg-orange-600 text-white px-8 sm:px-10 py-3 sm:py-3.5 rounded-xl font-black text-sm sm:text-base uppercase tracking-wider transition-all shadow-lg shadow-orange-500/20 active:scale-95 mb-3 shrink-0"
                    >
                        <Package className="w-4 h-4 sm:w-5 sm:h-5 inline-block mr-2 -mt-0.5" />
                        {packCount === 1 ? 'Buy & Open Pack' : `Buy & Open ${packCount} Packs`}
                    </button>

                    <button onClick={onClose} className="text-gray-500 hover:text-white text-sm font-medium transition-colors shrink-0">
                        Cancel
                    </button>
                </div>
            )}

            {/* --- STAGE: BUYING (waiting for tx) --- */}
            {stage === 'buying' && (
                <div key="stage-buying" className="flex flex-col items-center justify-center w-full h-full relative">
                    <div className="w-24 h-24 mb-8 border-4 border-yc-orange/30 border-t-yc-orange rounded-full animate-spin" />
                    <h2 className="text-2xl font-bold text-white mb-2">Confirm in Wallet</h2>
                    <p className="text-gray-400 text-sm mb-4">
                        {packCount === 1
                            ? 'Buying & opening 1 pack (5 cards)'
                            : `Buying & opening ${packCount} packs (${packCount * 5} cards)`
                        }
                    </p>
                    <div className="text-yc-orange font-mono font-bold text-lg mb-6">{formatXTZ(totalPrice)} {currencySymbol()}</div>
                    <button onClick={onClose} className="text-gray-500 hover:text-white text-sm font-medium transition-colors">Cancel</button>
                </div>
            )}

            {/* --- STAGE: BURST EFFECT --- */}
            {stage === 'exploding' && (
                <div key="stage-exploding-mega" className="flex flex-col items-center justify-center w-full h-full relative">
                    <div className="relative w-40 h-40">
                        <div className="absolute inset-0 rounded-full border-2 border-yc-orange/60 animate-ping" />
                        <div className="absolute inset-4 rounded-full border-2 border-yc-orange/40 animate-ping" style={{ animationDelay: '0.1s' }} />
                        <div className="absolute inset-8 rounded-full border-2 border-yc-orange/20 animate-ping" style={{ animationDelay: '0.2s' }} />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-5xl">⚡</span>
                        </div>
                    </div>
                    <h2 className="text-2xl font-black text-white mt-6 uppercase tracking-tighter animate-pulse">
                        Pack Opened!
                    </h2>
                </div>
            )}

            {/* --- STAGE: TEARING (legacy, kept for compatibility) --- */}
            {stage === 'tearing' && (
                <div key="stage-tearing" className="flex flex-col items-center justify-center w-full h-full relative cursor-pointer" onClick={handleTapPack}>
                    <h2 className="absolute top-[15%] sm:top-1/4 text-2xl sm:text-3xl font-black text-white italic uppercase tracking-tighter drop-shadow-glow pointer-events-none select-none animate-pulse">
                        {cuts.length === 0 ? "TAP TO BREACH" :
                            cuts.length < maxTaps - 1 ? "TEAR IT OPEN" : "CRITICAL OVERLOAD"}
                    </h2>

                    <div className="absolute top-[22%] sm:top-[32%] w-40 sm:w-48 h-1 bg-gray-800 rounded-full overflow-hidden pointer-events-none">
                        <div className="h-full bg-yc-orange transition-all duration-100" style={{ width: `${(cuts.length / maxTaps) * 100}%` }} />
                    </div>

                    <div ref={packRef} className="relative w-52 h-[300px] sm:w-72 sm:h-[420px] shadow-2xl z-10 transition-transform">
                        <div className="absolute inset-0 rounded-xl overflow-hidden border bg-[#151515] border-white/20">
                            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20 mix-blend-overlay" />
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                                <div className="w-16 h-16 sm:w-24 sm:h-24 border-2 border-yc-orange rounded-full flex items-center justify-center mb-3 sm:mb-4 backdrop-blur-sm bg-black/50">
                                    <span className="text-white font-black text-2xl sm:text-3xl">YC</span>
                                </div>
                                <div className="px-3 py-1 bg-yc-orange text-white text-[10px] font-black uppercase tracking-[0.2em]">Season 4</div>
                            </div>
                            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent pointer-events-none" />
                        </div>
                        <svg className="absolute inset-0 w-full h-full pointer-events-none filter drop-shadow-[0_0_5px_rgba(255,200,0,0.8)]" viewBox="0 0 100 100" preserveAspectRatio="none">
                            {cuts.map((d, i) => (
                                <path key={i} d={d} stroke="#F26522" strokeWidth={0.5 + (i * 0.3)} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                            ))}
                        </svg>
                    </div>
                </div>
            )}

            {/* --- STAGE: DEALING (single pack - tap to reveal) --- */}
            {stage === 'dealing' && !isMultiPack && (
                <div key="stage-dealing" className="w-full h-full flex flex-col items-center relative z-40 pt-10 sm:pt-20">
                    <div ref={cardsContainerRef} className="flex flex-wrap justify-center gap-3 sm:gap-4 md:gap-8 perspective-1000 w-full max-w-6xl px-4 mt-4 sm:mt-10">
                        {mintedCards.map((card, index) => (
                            <div
                                key={card.tokenId}
                                ref={(el) => { cardRefs.current[index] = el }}
                                className="relative w-36 h-52 sm:w-48 sm:h-72 md:w-56 md:h-80 group cursor-pointer opacity-0"
                            >
                                <div className="card-inner w-full h-full relative transform-style-3d">
                                    <div className="absolute inset-0 backface-hidden rounded-xl overflow-hidden shadow-2xl">
                                        <img src={card.image} className="w-full h-full object-contain" loading="eager" />
                                    </div>
                                    <div className="absolute inset-0 backface-hidden rotate-y-180 rounded-xl bg-[#0a0a0a] border border-gray-800 overflow-hidden shadow-2xl flex items-center justify-center">
                                        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20" />
                                        <div className="w-full h-full border-4 border-[#1a1a1a] m-1 rounded-lg flex items-center justify-center">
                                            <div className="text-center">
                                                <div className="w-12 h-12 bg-yc-orange rounded flex items-center justify-center mx-auto mb-2 shadow-[0_0_15px_#F26522]">
                                                    <span className="text-white font-black text-xl">Y</span>
                                                </div>
                                                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">ATTENTIONX</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div
                        className="fixed bottom-0 left-0 w-full h-[25vh] sm:h-[40vh] z-50 flex items-end justify-center pb-8 sm:pb-12 cursor-pointer touch-manipulation group"
                        onClick={dealNextCard}
                    >
                        <div className="flex flex-col items-center animate-pulse group-active:scale-95 transition-transform">
                            <p className="text-white/50 text-sm font-bold uppercase tracking-widest mb-2">Tap to Reveal</p>
                            <Layers className="text-yc-orange opacity-80 w-8 h-8" />
                        </div>
                    </div>
                </div>
            )}

            {/* --- STAGE: FINISHED --- */}
            {stage === 'finished' && (
                <div key="stage-finished" className="w-full h-full flex flex-col relative z-40">
                    {/* Header */}
                    <div className="flex-shrink-0 pt-4 sm:pt-8 pb-2 sm:pb-4 text-center">
                        <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter animate-[fadeInUp_0.5s_ease-out]">
                            {isMultiPack ? `${packCount} Packs Opened!` : 'Pack Opened!'}
                        </h2>
                        <p className="text-gray-400 text-xs sm:text-sm mt-1">{mintedCards.length} cards acquired</p>
                        {/* Scroll hint for multi-pack */}
                        {isMultiPack && mintedCards.length > 10 && (
                            <div className="flex items-center justify-center gap-1 mt-2 text-gray-500 text-xs animate-bounce">
                                <ChevronDown className="w-4 h-4" />
                                Scroll to see all cards
                            </div>
                        )}
                    </div>

                    {/* Scrollable card grid */}
                    <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-4 pb-28 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
                        <div className={`grid gap-2 sm:gap-3 md:gap-4 max-w-6xl mx-auto ${isMultiPack
                            ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6'
                            : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-5'
                            }`}>
                            {mintedCards.map((card, index) => (
                                <div
                                    key={card.tokenId}
                                    className="relative bg-[#121212] border border-[#2A2A2A] rounded-xl overflow-hidden transition-transform hover:scale-[1.03]"
                                    style={{
                                        animation: `fadeInUp 0.3s ease-out ${isMultiPack ? index * 30 : 0}ms both`,
                                    }}
                                >
                                    <img
                                        src={card.image}
                                        className="block w-full"
                                        loading={index < 20 ? 'eager' : 'lazy'}
                                        alt={card.name}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Fixed bottom button */}
                    <div className="fixed bottom-0 left-0 right-0 flex justify-center pb-4 sm:pb-6 pt-3 sm:pt-4 bg-gradient-to-t from-black via-black/80 to-transparent z-50" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
                        <button
                            onClick={onClose}
                            className="px-8 sm:px-10 py-3 bg-yc-orange hover:bg-orange-600 text-white rounded-xl font-black text-sm sm:text-base uppercase tracking-wider transition-all shadow-lg shadow-orange-500/30 active:scale-95"
                        >
                            Collect All
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PackOpeningModal;
