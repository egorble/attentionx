import { useState, useCallback } from 'react';
import { ethers } from 'ethers';
import { getNFTContract, NFT_ABI, getActiveContracts } from '../lib/contracts';
import { blockchainCache, CacheKeys } from '../lib/cache';
import { metadataUrl } from '../lib/api';

// Upgrade chance display (basis points → percentage)
const DEFAULT_CHANCES: Record<number, number> = {
    1: 80,  // lv1→lv2
    2: 70,  // lv2→lv3
    3: 60,  // lv3→lv4
    4: 50,  // lv4→lv5
};

export interface UpgradeConfig {
    chances: Record<number, number>; // level → percentage
}

export interface UpgradeResult {
    success: boolean;
    burned?: boolean; // true if card was burned on failure
    newLevel?: number;
    txHash?: string;
    error?: string;
}

export function useUpgrade() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch upgrade config from contract
    const getUpgradeConfig = useCallback(async (): Promise<UpgradeConfig> => {
        try {
            const contract = getNFTContract();

            // Fetch chances for each level
            const chances: Record<number, number> = {};
            for (let lvl = 1; lvl <= 4; lvl++) {
                try {
                    const bps = await contract.upgradeChance(lvl);
                    chances[lvl] = Number(bps) / 100; // basis points to percentage
                } catch {
                    chances[lvl] = DEFAULT_CHANCES[lvl] || 0;
                }
            }

            return { chances };
        } catch {
            return { chances: DEFAULT_CHANCES };
        }
    }, []);

    // Upgrade a card (FREE — no ETH required, but card burns on failure)
    const upgradeCard = useCallback(async (
        signer: ethers.Signer,
        tokenId: number
    ): Promise<UpgradeResult> => {
        setIsLoading(true);
        setError(null);

        try {
            const contracts = getActiveContracts();
            const contract = new ethers.Contract(contracts.AttentionX_NFT, NFT_ABI, signer);

            const tx = await contract.upgradeCard(tokenId);
            const receipt = await tx.wait();

            // Check events to determine success/failure
            let upgraded = false;
            let burned = false;
            let newLevel = 0;

            for (const log of receipt.logs) {
                try {
                    const parsed = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
                    if (parsed && parsed.name === 'CardUpgraded') {
                        upgraded = true;
                        newLevel = Number(parsed.args.toLevel);
                    } else if (parsed && parsed.name === 'CardUpgradeFailed') {
                        burned = true;
                    }
                } catch {
                    // Not our event, skip
                }
            }

            // Invalidate ALL caches for this token
            blockchainCache.invalidate(CacheKeys.cardMetadata(tokenId));
            // Invalidate backend metadata server cache (so refresh gets fresh data)
            try { await fetch(metadataUrl(`/cache/${tokenId}`), { method: 'DELETE' }); } catch {}

            setIsLoading(false);
            return {
                success: upgraded,
                burned,
                newLevel: upgraded ? newLevel : undefined,
                txHash: receipt.hash,
            };
        } catch (err: any) {
            const msg = err?.reason || err?.message || 'Upgrade failed';
            let errorMsg = msg;

            if (msg.includes('MaxLevelReached')) {
                errorMsg = 'Card is already at maximum level (5)';
            } else if (msg.includes('CardIsLocked')) {
                errorMsg = 'Card is locked in a tournament';
            } else if (msg.includes('NoContractCalls')) {
                errorMsg = 'Upgrade must be called from a wallet, not a contract';
            } else if (msg.includes('user rejected') || msg.includes('denied')) {
                errorMsg = 'Transaction rejected by user';
            }

            setError(errorMsg);
            setIsLoading(false);
            // TX never went through — card is NOT burned, just an error
            return { success: false, burned: false, error: errorMsg };
        }
    }, []);

    return {
        upgradeCard,
        getUpgradeConfig,
        isLoading,
        error,
    };
}
