import React, { useState, useEffect } from 'react';
import { Trophy, Users, Clock, ArrowRight, Zap } from 'lucide-react';
import { NavSection } from '../types';
import { currencySymbol } from '../lib/networks';
import { useActiveTournament } from '../hooks/useSharedData';

interface TournamentCTAProps {
    onNavigate: (section: NavSection) => void;
}

const TournamentCTA: React.FC<TournamentCTAProps> = ({ onNavigate }) => {
    const { data: tournament } = useActiveTournament();
    const [timeLeft, setTimeLeft] = useState('');

    // Update countdown
    useEffect(() => {
        if (!tournament) return;

        const updateTime = () => {
            const now = Math.floor(Date.now() / 1000);
            const end = tournament.endTime;
            const remaining = end - now;

            if (remaining <= 0) {
                setTimeLeft('Ended');
                return;
            }

            const days = Math.floor(remaining / 86400);
            const hours = Math.floor((remaining % 86400) / 3600);
            const minutes = Math.floor((remaining % 3600) / 60);

            if (days > 0) {
                setTimeLeft(`${days}d ${hours}h`);
            } else if (hours > 0) {
                setTimeLeft(`${hours}h ${minutes}m`);
            } else {
                setTimeLeft(`${minutes}m`);
            }
        };

        updateTime();
        const interval = setInterval(updateTime, 60000);
        return () => clearInterval(interval);
    }, [tournament]);

    if (!tournament) return null;

    return (
        <div className="my-8">
            <div className="relative overflow-hidden rounded-2xl border border-yc-purple/30 bg-gradient-to-r from-purple-50 via-white to-purple-50 dark:from-[#1A0F00] dark:via-[#0D0D0D] dark:to-[#1A0F00] p-4 md:p-8 group hover:border-yc-purple/60 transition-all duration-500">
                {/* Background decoration */}
                <div className="absolute -top-10 -right-10 opacity-5 pointer-events-none">
                    <Trophy size={200} />
                </div>
                <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-yc-purple via-purple-400 to-yc-purple opacity-50"></div>

                <div className="relative z-10 flex flex-col gap-4 md:gap-6">
                    {/* Top: Tournament info */}
                    <div>
                        <div className="flex items-center gap-2 mb-2 md:mb-3">
                            <span className="px-2 py-0.5 bg-yc-purple text-white text-[10px] font-bold uppercase rounded">
                                Tournament #{tournament.id}
                            </span>
                            <span className="px-2 py-0.5 bg-green-500/20 text-green-500 text-[10px] font-bold uppercase rounded flex items-center">
                                <Zap size={10} className="mr-1" /> {tournament.status === 'active' ? 'Live Now' : 'Open'}
                            </span>
                        </div>

                        <h3 className="text-xl md:text-3xl font-black text-gray-900 dark:text-white uppercase tracking-tight mb-1 md:mb-2">
                            Win the Prize Pool
                        </h3>
                        <p className="text-gray-500 dark:text-gray-400 text-xs md:text-sm max-w-lg hidden md:block">
                            Join the tournament, lock your 5 best NFT cards, and compete against other players.
                            Top scorers win from the prize pool!
                        </p>
                    </div>

                    {/* Stats Row */}
                    <div className="grid grid-cols-3 gap-2 md:flex md:items-center md:gap-4">
                        <div className="text-center bg-white/80 dark:bg-black/50 rounded-xl px-2 md:px-4 py-2 md:py-3 border border-gray-200 dark:border-gray-800">
                            <div className="flex items-center justify-center gap-1 mb-0.5 md:mb-1">
                                <Trophy className="w-3 h-3 text-yc-purple" />
                                <span className="text-[9px] md:text-[10px] text-gray-500 uppercase font-bold">Prize Pool</span>
                            </div>
                            <p className="text-sm md:text-xl font-black text-yc-purple font-mono leading-tight">
                                {tournament.prizePool}
                            </p>
                            <p className="text-[10px] md:text-xs text-yc-purple font-bold">{currencySymbol()}</p>
                        </div>
                        <div className="text-center bg-white/80 dark:bg-black/50 rounded-xl px-2 md:px-4 py-2 md:py-3 border border-gray-200 dark:border-gray-800">
                            <div className="flex items-center justify-center gap-1 mb-0.5 md:mb-1">
                                <Users className="w-3 h-3 text-gray-400" />
                                <span className="text-[9px] md:text-[10px] text-gray-500 uppercase font-bold">Players</span>
                            </div>
                            <p className="text-sm md:text-xl font-black text-gray-900 dark:text-white font-mono">
                                {tournament.entryCount}
                            </p>
                        </div>
                        <div className="text-center bg-white/80 dark:bg-black/50 rounded-xl px-2 md:px-4 py-2 md:py-3 border border-gray-200 dark:border-gray-800">
                            <div className="flex items-center justify-center gap-1 mb-0.5 md:mb-1">
                                <Clock className="w-3 h-3 text-gray-400" />
                                <span className="text-[9px] md:text-[10px] text-gray-500 uppercase font-bold">Time Left</span>
                            </div>
                            <p className="text-sm md:text-xl font-black text-gray-900 dark:text-white font-mono">
                                {timeLeft}
                            </p>
                        </div>
                    </div>

                    {/* CTA Button */}
                    <button
                        onClick={() => onNavigate(NavSection.LEAGUES)}
                        className="bg-yc-purple hover:bg-purple-600 text-white w-full md:w-auto md:self-start px-8 py-3 rounded-xl font-black text-sm uppercase tracking-wider transition-all flex items-center justify-center shadow-lg shadow-purple-500/20 active:scale-95 group"
                    >
                        Join Tournament
                        <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TournamentCTA;
