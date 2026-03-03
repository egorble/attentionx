/**
 * Hook for TokenLeagues smart contract interactions.
 * Handles: enterCycle, claimPrize, setAutoPlay, read states.
 */

import { useState, useCallback } from 'react';
import { ethers } from 'ethers';
import { getTokenLeaguesContract, getReadProvider } from '../lib/contracts';
import { useWalletContext } from '../context/WalletContext';

/** Parse blockchain/wallet errors into short user-friendly messages */
function friendlyError(err: any): string {
    const raw = (err?.reason || err?.message || err?.toString() || 'Transaction failed').toLowerCase();
    if (raw.includes('insufficient funds') || raw.includes('insufficient_funds'))
        return 'Insufficient balance to cover entry fee + gas';
    if (raw.includes('user rejected') || raw.includes('user denied') || raw.includes('action_rejected'))
        return 'Transaction cancelled';
    if (raw.includes('already entered') || raw.includes('already_entered'))
        return 'You already entered this cycle';
    if (raw.includes('cycle not active') || raw.includes('not_active'))
        return 'Cycle is not active right now';
    if (raw.includes('nonce'))
        return 'Nonce error — try again';
    if (raw.includes('timeout') || raw.includes('timed out'))
        return 'Transaction timed out — try again';
    if (raw.includes('unpredictable_gas') || raw.includes('cannot estimate'))
        return 'Transaction would fail — check balance or cycle status';
    // Fallback: truncate to something readable
    const fallback = err?.reason || err?.shortMessage || 'Transaction failed';
    return fallback.length > 80 ? fallback.slice(0, 77) + '...' : fallback;
}

// Token metadata — all 25 RISEx markets (crypto + stocks + commodities)
export const TOKENS = [
    // Crypto
    { id: 1,  symbol: 'BTC',   name: 'Bitcoin',      color: '#F7931A' },
    { id: 2,  symbol: 'ETH',   name: 'Ethereum',     color: '#627EEA' },
    { id: 3,  symbol: 'BNB',   name: 'BNB',          color: '#F0B90B' },
    { id: 4,  symbol: 'SOL',   name: 'Solana',       color: '#9945FF' },
    { id: 5,  symbol: 'DOGE',  name: 'Dogecoin',     color: '#C2A633' },
    { id: 6,  symbol: 'XRP',   name: 'XRP',          color: '#23292F' },
    { id: 7,  symbol: 'LINK',  name: 'Chainlink',    color: '#2A5ADA' },
    { id: 8,  symbol: 'ZEC',   name: 'Zcash',        color: '#ECB244' },
    { id: 9,  symbol: 'LTC',   name: 'Litecoin',     color: '#BFBBBB' },
    { id: 10, symbol: 'AAVE',  name: 'Aave',         color: '#B6509E' },
    { id: 11, symbol: 'TAO',   name: 'Bittensor',    color: '#000000' },
    { id: 12, symbol: 'PUMP',  name: 'PumpFun',      color: '#00D4AA' },
    { id: 13, symbol: 'PENGU', name: 'Pudgy Penguins', color: '#5B9BD5' },
    { id: 14, symbol: 'PEPE',  name: 'Pepe',         color: '#3D9B35' },
    { id: 15, symbol: 'HYPE',  name: 'Hyperliquid',  color: '#7CFC00' },
    { id: 16, symbol: 'XMR',   name: 'Monero',       color: '#FF6600' },
    { id: 17, symbol: 'MNT',   name: 'Mantle',       color: '#000000' },
    // Stocks
    { id: 18, symbol: 'SPY',   name: 'S&P 500 ETF',  color: '#1B5E20' },
    { id: 19, symbol: 'TSLA',  name: 'Tesla',        color: '#CC0000' },
    { id: 20, symbol: 'COIN',  name: 'Coinbase',     color: '#0052FF' },
    { id: 21, symbol: 'HOOD',  name: 'Robinhood',    color: '#00C805' },
    { id: 22, symbol: 'NVDA',  name: 'NVIDIA',       color: '#76B900' },
    { id: 23, symbol: 'LIT',   name: 'Litentry',     color: '#6C63FF' },
    // Commodities
    { id: 24, symbol: 'XAU',   name: 'Gold',         color: '#FFD700' },
    { id: 25, symbol: 'XAG',   name: 'Silver',       color: '#C0C0C0' },
] as const;

export function useTokenLeagues() {
    const { getSigner, address } = useWalletContext();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /** Enter current cycle with 5 token selections */
    const enterCycle = useCallback(async (tokenIds: number[]) => {
        console.log('[TL Entry] === START === address:', address, 'tokens:', tokenIds);
        const signer = await getSigner();
        if (!signer) throw new Error('Wallet not connected');
        if (tokenIds.length !== 5) throw new Error('Must select exactly 5 tokens');

        setLoading(true);
        setError(null);
        try {
            const contract = getTokenLeaguesContract(signer);
            const entryFee = await contract.entryFee();
            console.log('[TL Entry] entryFee:', entryFee.toString());

            // Read on-chain cycleId BEFORE tx
            const preId = Number(await contract.currentCycleId());
            console.log('[TL Entry] on-chain currentCycleId BEFORE tx:', preId);

            const tx = await contract.enterCycle(tokenIds, { value: entryFee });
            console.log('[TL Entry] TX sent:', tx.hash);
            const receipt = await tx.wait();
            console.log('[TL Entry] TX confirmed, block:', receipt?.blockNumber);

            // Read on-chain cycleId AFTER tx
            const cycleId = Number(await contract.currentCycleId());
            console.log('[TL Entry] on-chain currentCycleId AFTER tx:', cycleId);
            if (preId !== cycleId) {
                console.warn('[TL Entry] ⚠️ CYCLE ID CHANGED during tx! pre:', preId, 'post:', cycleId);
            }

            // POST to backend
            const postBody = { cycleId, address, tokenIds };
            console.log('[TL Entry] POST /api/token-leagues/entry body:', JSON.stringify(postBody));
            try {
                const resp = await fetch('/api/token-leagues/entry', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(postBody),
                });
                const respText = await resp.text();
                console.log('[TL Entry] POST response:', resp.status, respText);
                if (!resp.ok) {
                    console.error('[TL Entry] ❌ Backend POST failed:', resp.status, respText);
                }
            } catch (e) {
                console.error('[TL Entry] ❌ Backend POST network error:', e);
            }

            console.log('[TL Entry] === DONE ===');
            return receipt;
        } catch (err: any) {
            console.error('[TL Entry] ❌ TX error:', err?.reason || err?.message || err);
            setError(friendlyError(err));
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getSigner, address]);

    /** Claim accumulated prizes */
    const claimPrize = useCallback(async () => {
        const signer = await getSigner();
        if (!signer) throw new Error('Wallet not connected');

        setLoading(true);
        setError(null);
        try {
            const contract = getTokenLeaguesContract(signer);
            const tx = await contract.claimPrize();
            return await tx.wait();
        } catch (err: any) {
            const msg = err?.reason || err?.message || 'Claim failed';
            setError(msg);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getSigner]);

    /** Set AutoPlay on-chain + server */
    const setAutoPlay = useCallback(async (enabled: boolean, tokenIds: number[]) => {
        const signer = await getSigner();
        if (!signer || !address) throw new Error('Wallet not connected');
        if (enabled && tokenIds.length !== 5) throw new Error('Must select exactly 5 tokens');

        setLoading(true);
        setError(null);
        try {
            // On-chain
            const contract = getTokenLeaguesContract(signer);
            const tx = await contract.setAutoPlay(enabled, tokenIds.length === 5 ? tokenIds : [1,2,3,4,5]);
            await tx.wait();

            // Server (for cycle manager to auto-enter)
            try {
                await fetch('/api/token-leagues/autoplay', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ address, enabled, tokenIds }),
                });
            } catch {} // non-critical

        } catch (err: any) {
            const msg = err?.reason || err?.message || 'AutoPlay update failed';
            setError(msg);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getSigner, address]);

    /** Read claimable balance */
    const getClaimableBalance = useCallback(async (): Promise<bigint> => {
        if (!address) return 0n;
        try {
            const contract = getTokenLeaguesContract();
            return await contract.getClaimableBalance(address);
        } catch {
            return 0n;
        }
    }, [address]);

    /** Check if user entered current cycle */
    const hasEnteredCycle = useCallback(async (cycleId: number): Promise<boolean> => {
        if (!address) return false;
        try {
            const contract = getTokenLeaguesContract();
            return await contract.hasEntered(cycleId, address);
        } catch (err: any) {
            console.error('[useTokenLeagues] hasEnteredCycle RPC error:', err?.message || err);
            return false;
        }
    }, [address]);

    /** Get entry fee */
    const getEntryFee = useCallback(async (): Promise<bigint> => {
        try {
            const contract = getTokenLeaguesContract();
            return await contract.entryFee();
        } catch {
            return ethers.parseEther('0.001');
        }
    }, []);

    /** Get user's selected tokens for a cycle */
    const getUserTokens = useCallback(async (cycleId: number): Promise<number[]> => {
        if (!address) return [];
        try {
            const contract = getTokenLeaguesContract();
            const tokens: bigint[] = await contract.getUserTokens(cycleId, address);
            const ids = tokens.map(t => Number(t)).filter(t => t > 0);
            return ids;
        } catch (err: any) {
            console.error('[useTokenLeagues] getUserTokens RPC error:', err?.message || err);
            return [];
        }
    }, [address]);

    return {
        enterCycle,
        claimPrize,
        setAutoPlay,
        getClaimableBalance,
        hasEnteredCycle,
        getEntryFee,
        getUserTokens,
        loading,
        error,
    };
}
