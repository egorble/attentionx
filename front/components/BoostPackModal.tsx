import React, { useState, useEffect, useRef } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { ethers } from 'ethers';
import gsap from 'gsap';
import { useWalletContext } from '../context/WalletContext';
import { useTokenLeagues, TOKENS } from '../hooks/useTokenLeagues';
import { currencySymbol } from '../lib/networks';
import { TokenIcon } from './TokenLeagues';
import ModelViewer3D from './ModelViewer3D';

const BOOST_GLB = '/boost-pack.glb';

type Stage = 'preview' | 'buying' | 'revealing' | 'revealed';

function generateRandomTokens(): number[] {
    const ids: number[] = [];
    while (ids.length < 5) {
        const id = Math.floor(Math.random() * 25) + 1;
        if (!ids.includes(id)) ids.push(id);
    }
    return ids.sort((a, b) => a - b);
}

interface BoostPackModalProps {
    isOpen: boolean;
    onClose: () => void;
    onBoosted?: (tokenIds: number[], cycleId: number) => void;
}

const BoostPackModal: React.FC<BoostPackModalProps> = ({ isOpen, onClose, onBoosted }) => {
    const { isConnected } = useWalletContext();
    const { enterCycleWithBoost, getEntryFee, loading } = useTokenLeagues();

    const [stage, setStage] = useState<Stage>('preview');
    const [price, setPrice] = useState<bigint>(ethers.parseEther('0.001'));
    const [randomTokens, setRandomTokens] = useState<number[]>([]);
    const [enteredCycleId, setEnteredCycleId] = useState<number>(0);
    const [error, setError] = useState<string | null>(null);

    const flashRef = useRef<HTMLDivElement>(null);
    const tokensRef = useRef<HTMLDivElement>(null);

    // Reset on open
    useEffect(() => {
        if (isOpen) {
            setStage('preview');
            setRandomTokens([]);
            setError(null);
            setEnteredCycleId(0);
        }
    }, [isOpen]);

    // Load entry fee (same price as normal entry)
    useEffect(() => {
        if (isOpen) {
            getEntryFee().then(p => setPrice(p));
        }
    }, [isOpen, getEntryFee]);

    const handleBuy = async () => {
        if (!isConnected) return;
        setError(null);

        const tokens = generateRandomTokens();
        setRandomTokens(tokens);
        setStage('buying');

        try {
            const result = await enterCycleWithBoost(tokens);
            setEnteredCycleId(result.cycleId);

            // Flash + reveal animation
            setStage('revealing');
            if (flashRef.current) {
                gsap.fromTo(flashRef.current,
                    { opacity: 1 },
                    { opacity: 0, duration: 0.7, ease: 'power2.out' }
                );
            }

            // Staggered token reveal
            setTimeout(() => {
                setStage('revealed');
                requestAnimationFrame(() => {
                    if (tokensRef.current) {
                        const cards = tokensRef.current.querySelectorAll('.boost-token-card');
                        gsap.fromTo(cards,
                            { scale: 0, rotationY: 180, opacity: 0 },
                            {
                                scale: 1, rotationY: 0, opacity: 1,
                                duration: 0.5, stagger: 0.1,
                                ease: 'back.out(1.5)',
                            }
                        );
                    }
                });
            }, 500);
        } catch (err: any) {
            const msg = err?.reason || err?.shortMessage || err?.message || 'Transaction failed';
            setError(msg.length > 100 ? msg.slice(0, 97) + '...' : msg);
            setStage('preview');
        }
    };

    const handleDone = () => {
        if (onBoosted && randomTokens.length === 5 && enteredCycleId > 0) {
            onBoosted(randomTokens, enteredCycleId);
        }
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md overflow-hidden">
            {/* Flash overlay */}
            <div ref={flashRef} className="absolute inset-0 bg-white pointer-events-none opacity-0 z-[60]" />

            {/* Close button */}
            <button
                onClick={stage === 'revealed' ? handleDone : onClose}
                className="absolute top-4 right-4 z-50 p-2 bg-white/10 backdrop-blur-xl border border-white/20 hover:bg-white/20 rounded-full transition-colors shadow-[0_4px_16px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.15)]"
            >
                <X className="w-5 h-5 text-white" />
            </button>

            {/* PREVIEW stage */}
            {stage === 'preview' && (
                <div className="flex flex-col items-center w-full h-full px-4 py-4 sm:py-0 sm:justify-center">
                    {/* 3D pack */}
                    <div className="relative w-full flex-1 min-h-0 max-h-[55%] shrink mb-4">
                        <ModelViewer3D mode="interactive" cameraZ={4.5} modelScale={1} glbPath={BOOST_GLB} />
                    </div>

                    {/* Info */}
                    <div className="flex flex-col items-center gap-3 shrink-0 max-w-sm w-full px-5">
                        <h2 className="text-xl font-black text-white uppercase tracking-wider">Boost Pack</h2>
                        <p className="text-zinc-400 text-xs text-center leading-relaxed">
                            5 random tokens + <span className="text-[#9333ea] font-bold">+5% score boost</span>
                        </p>

                        {error && (
                            <div className="w-full px-3 py-2 bg-red-500/20 border border-red-500/30 rounded-xl">
                                <p className="text-xs text-red-400 font-medium text-center">{error}</p>
                            </div>
                        )}

                        <button
                            onClick={handleBuy}
                            disabled={!isConnected || loading}
                            className="w-full bg-[#9333ea] hover:bg-[#a855f7] text-white py-3.5 rounded-2xl font-black text-sm uppercase tracking-widest active:scale-[0.97] transition-all shadow-[0_4px_30px_rgba(147,51,234,0.4)] disabled:opacity-40 flex items-center justify-center gap-2"
                        >
                            Buy · {parseFloat(ethers.formatEther(price))} {currencySymbol()}
                        </button>

                        <button
                            onClick={onClose}
                            className="text-zinc-500 text-xs font-bold hover:text-zinc-300 transition-colors py-2"
                        >
                            Not now
                        </button>
                    </div>
                </div>
            )}

            {/* BUYING stage */}
            {stage === 'buying' && (
                <div className="flex flex-col items-center justify-center gap-4">
                    <div className="relative w-48 h-48">
                        <ModelViewer3D mode="gentle" cameraZ={4.5} modelScale={1} glbPath={BOOST_GLB} />
                    </div>
                    <div className="bg-white/10 backdrop-blur-2xl border border-white/20 rounded-2xl px-6 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.15)] flex items-center gap-3">
                        <RefreshCw className="w-5 h-5 text-[#9333ea] animate-spin" />
                        <p className="text-white font-bold text-sm">Confirm in wallet...</p>
                    </div>
                </div>
            )}

            {/* REVEALING stage */}
            {stage === 'revealing' && (
                <div className="flex flex-col items-center justify-center gap-4">
                    <RefreshCw className="w-8 h-8 text-[#9333ea] animate-spin" />
                    <p className="text-white font-black text-lg uppercase tracking-widest">Opening...</p>
                </div>
            )}

            {/* REVEALED stage */}
            {stage === 'revealed' && (
                <div className="flex flex-col items-center w-full h-full px-4 py-8 justify-center">
                    {/* Boost badge */}
                    <div className="flex items-center gap-2 mb-6">
                        <div className="bg-white/10 backdrop-blur-2xl border border-white/20 rounded-full px-4 py-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.15)]">
                            <span className="text-[#9333ea] font-black text-sm uppercase tracking-wider">+5% Boosted</span>
                        </div>
                    </div>

                    <h3 className="text-white font-black text-lg mb-2 uppercase tracking-wider">Your Tokens</h3>
                    <p className="text-zinc-400 text-xs mb-6">Cycle #{enteredCycleId}</p>

                    {/* Token cards */}
                    <div ref={tokensRef} className="flex flex-wrap justify-center gap-3 mb-8 max-w-md">
                        {randomTokens.map((tokenId) => {
                            const token = TOKENS.find(t => t.id === tokenId);
                            if (!token) return null;
                            return (
                                <div
                                    key={tokenId}
                                    className="boost-token-card flex flex-col items-center gap-2 bg-white/10 backdrop-blur-2xl border border-white/20 rounded-2xl p-4 w-[72px] md:w-[88px] shadow-[0_4px_16px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.15)]"
                                    style={{ perspective: '600px' }}
                                >
                                    <TokenIcon symbol={token.symbol} color={token.color} size={36} />
                                    <span className="text-[10px] font-black text-white leading-none">{token.symbol}</span>
                                </div>
                            );
                        })}
                    </div>

                    <button
                        onClick={handleDone}
                        className="bg-[#9333ea] hover:bg-[#a855f7] text-white px-8 py-3 rounded-2xl font-black text-sm uppercase tracking-widest active:scale-[0.97] transition-all shadow-[0_4px_30px_rgba(147,51,234,0.4)]"
                    >
                        Let's Go
                    </button>
                </div>
            )}
        </div>
    );
};

export default BoostPackModal;
