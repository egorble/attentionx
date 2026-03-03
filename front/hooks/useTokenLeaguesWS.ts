/**
 * WebSocket hook for real-time Token Leagues data.
 * Connects to server WS at /ws/token-leagues.
 * Returns reactive state: prices, cycle, leaderboard, token performance.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

interface TokenPrice {
    price: number;
    change24h: number;
    symbol: string;
}

interface CycleInfo {
    id: number;
    startTime: number;
    endTime: number;
    timeLeft: number;
    status: 'active' | 'finalizing';
    prizePool?: string;
    entryCount?: number;
}

interface LeaderboardEntry {
    address: string;
    score: number;
    rank: number;
    tokens: number[];
}

interface TokenPerformance {
    tokenId: number;
    symbol: string;
    startPrice: number;
    currentPrice: number;
    pctChange: number;
    leveragedChange: number;
}

interface CycleResult {
    cycleId: number;
    leaderboard: Array<{
        playerAddress: string;
        score: number;
        rank: number;
        prizeAmount: string;
    }>;
    prizePool: string;
}

export function useTokenLeaguesWS() {
    const [prices, setPrices] = useState<Record<number, TokenPrice>>({});
    const [cycle, setCycle] = useState<CycleInfo | null>(null);
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [tokenPerformance, setTokenPerformance] = useState<TokenPerformance[]>([]);
    const [cycleResult, setCycleResult] = useState<CycleResult | null>(null);
    const [connected, setConnected] = useState(false);

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const mountedRef = useRef(true);
    const reconnectDelayRef = useRef(2000);
    const reconnectAttemptRef = useRef(0);

    const scheduleReconnect = useCallback(() => {
        if (!mountedRef.current) return;
        reconnectAttemptRef.current++;
        const jitter = Math.random() * 1000;
        const delay = Math.min(reconnectDelayRef.current + jitter, 30000);
        console.log(`[TokenLeagues WS] Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt #${reconnectAttemptRef.current})`);
        reconnectRef.current = setTimeout(connect, delay);
        reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30000);
    }, []);

    const connect = useCallback(() => {
        if (!mountedRef.current) return;

        // Build WS URL from current location
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const url = `${protocol}//${host}/ws/token-leagues`;

        try {
            const ws = new WebSocket(url);
            wsRef.current = ws;

            ws.onopen = () => {
                if (!mountedRef.current) return;
                console.log('[TokenLeagues WS] Connected to', url);
                setConnected(true);
                // Reset backoff on success
                reconnectDelayRef.current = 2000;
                reconnectAttemptRef.current = 0;
            };

            ws.onmessage = (event) => {
                if (!mountedRef.current) return;
                try {
                    const msg = JSON.parse(event.data);
                    switch (msg.channel) {
                        case 'prices':
                            setPrices(msg.data);
                            break;
                        case 'cycle':
                            setCycle((prev: CycleInfo | null) => {
                                if (prev?.id !== msg.data?.id) {
                                    console.log(`[TL WS] cycle changed: ${prev?.id} → ${msg.data?.id} status=${msg.data?.status} entryCount=${msg.data?.entryCount} timeLeft=${msg.data?.timeLeft}`);
                                }
                                return msg.data;
                            });
                            break;
                        case 'leaderboard':
                            setLeaderboard((prev: LeaderboardEntry[]) => {
                                if (prev.length !== msg.data.length) {
                                    console.log(`[TL WS] leaderboard: ${prev.length} → ${msg.data.length} players`, msg.data);
                                }
                                return msg.data;
                            });
                            break;
                        case 'tokens':
                            setTokenPerformance(msg.data);
                            break;
                        case 'cycle-result':
                            console.log('[TokenLeagues WS] cycle-result:', msg.data);
                            setCycleResult(msg.data);
                            break;
                    }
                } catch {}
            };

            ws.onclose = (ev) => {
                if (!mountedRef.current) return;
                setConnected(false);
                scheduleReconnect();
            };

            ws.onerror = () => {
                ws.close();
            };
        } catch {
            scheduleReconnect();
        }
    }, [scheduleReconnect]);

    useEffect(() => {
        mountedRef.current = true;
        connect();

        return () => {
            mountedRef.current = false;
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            if (reconnectRef.current) {
                clearTimeout(reconnectRef.current);
            }
        };
    }, [connect]);

    // Also fetch initial data via REST as fallback
    useEffect(() => {
        async function fetchInitial() {
            try {
                const [pricesRes, cycleRes] = await Promise.all([
                    fetch('/api/token-leagues/prices').then(r => r.json()).catch(() => null),
                    fetch('/api/token-leagues/cycle/active').then(r => r.json()).catch(() => null),
                ]);

                if (pricesRes?.success) {
                    const priceMap: Record<number, TokenPrice> = {};
                    for (const t of pricesRes.data) {
                        priceMap[t.id] = { price: t.price, change24h: t.change24h, symbol: t.symbol };
                    }
                    console.log(`[TokenLeagues REST] Initial prices: ${pricesRes.data.length} tokens`);
                    setPrices(prev => Object.keys(prev).length === 0 ? priceMap : prev);
                }

                if (cycleRes?.success) {
                    console.log('[TokenLeagues REST] Initial cycle:', cycleRes.data);
                    setCycle(prev => prev ? prev : cycleRes.data);
                }
            } catch {}
        }
        fetchInitial();
    }, []);

    return {
        prices,
        cycle,
        leaderboard,
        tokenPerformance,
        cycleResult,
        connected,
    };
}
