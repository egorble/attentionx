// Pack opener contract hook
import { useState, useCallback } from 'react';
import { ethers } from 'ethers';
import { getPackOpenerContract, getNFTContract, STARTUPS } from '../lib/contracts';
import { CardData, Rarity } from '../types';
import { blockchainCache, CacheKeys, CacheTTL } from '../lib/cache';
import { metadataUrl } from '../lib/api';
import { getActiveNetworkId } from '../lib/networks';

// Map rarity strings to enum
const RARITY_STRING_MAP: Record<string, Rarity> = {
    'Common': Rarity.COMMON,
    'Rare': Rarity.RARE,
    'Epic': Rarity.EPIC,
    'Epic Rare': Rarity.EPIC_RARE,
    'EpicRare': Rarity.EPIC_RARE,
    'Legendary': Rarity.LEGENDARY,
};

// Fetch metadata from API with 5s timeout
async function fetchCardMetadata(tokenId: number): Promise<CardData | null> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(metadataUrl(`/${tokenId}`), { signal: controller.signal });
        clearTimeout(timeout);
        if (!response.ok) return null;

        const data = await response.json();

        const attributes = data.attributes || [];
        const getAttribute = (traitType: string) => {
            const attr = attributes.find((a: any) => a.trait_type === traitType);
            return attr?.value;
        };

        const rarityStr = getAttribute('Rarity') || 'Common';
        const multiplierStr = getAttribute('Multiplier') || '1x';

        const startupId = parseInt(getAttribute('Startup ID')) || 1;
        return {
            tokenId,
            startupId,
            name: getAttribute('Startup') || data.name?.split(' #')[0] || 'Unknown',
            rarity: RARITY_STRING_MAP[rarityStr] || Rarity.COMMON,
            multiplier: parseInt(multiplierStr) || 1,
            isLocked: getAttribute('Locked') === 'Yes',
            image: `/images/${startupId}.png`,
            edition: parseInt(getAttribute('Edition')) || 1,
        };
    } catch (e) {
        return null;
    }
}

export function usePacks() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Get current pack price - cache first, refresh in background
    const getPackPrice = useCallback(async (): Promise<bigint> => {
        const key = CacheKeys.packPrice();

        // Try cache first
        const cached = blockchainCache.get<bigint>(key);
        if (cached !== undefined) {
            // Refresh in background if stale
            if (blockchainCache.isStale(key, CacheTTL.DEFAULT)) {
                blockchainCache.fetchInBackground(key, async () => {
                    const contract = getPackOpenerContract();
                    return await contract.currentPackPrice();
                });
            }
            return cached;
        }

        // Fetch fresh
        return blockchainCache.getOrFetch(key, async () => {
            const contract = getPackOpenerContract();
            return await contract.currentPackPrice();
        }, CacheTTL.DEFAULT);
    }, []);

    // Get packs sold - cache first
    const getPacksSold = useCallback(async (): Promise<number> => {
        const key = CacheKeys.packsSold();

        // Try cache first
        const cached = blockchainCache.get<number>(key);
        if (cached !== undefined) {
            // Refresh in background if stale
            if (blockchainCache.isStale(key, CacheTTL.SHORT)) {
                blockchainCache.fetchInBackground(key, async () => {
                    const contract = getPackOpenerContract();
                    return Number(await contract.packsSold());
                });
            }
            return cached;
        }

        // Fetch fresh
        return blockchainCache.getOrFetch(key, async () => {
            const contract = getPackOpenerContract();
            return Number(await contract.packsSold());
        }, CacheTTL.SHORT);
    }, []);

    // Buy AND Open pack in one transaction - returns 5 cards with metadata
    const buyAndOpenPack = useCallback(async (
        signer: ethers.Signer
    ): Promise<{ success: boolean; cards?: CardData[]; error?: string }> => {
        setIsLoading(true);
        setError(null);

        try {
            const packContract = getPackOpenerContract(signer);
            const nftContract = getNFTContract(signer);
            const signerAddress = await signer.getAddress();

            // Get referrer from localStorage or URL params
            let referrer = localStorage.getItem(`attentionx_referrer_${getActiveNetworkId()}`);
            if (!referrer) {
                const params = new URLSearchParams(window.location.search);
                const ref = params.get('ref');
                if (ref && ref.startsWith('0x') && ref.length === 42) {
                    referrer = ref.toLowerCase();
                }
            }
            // Don't refer yourself
            if (referrer && referrer.toLowerCase() === signerAddress.toLowerCase()) {
                referrer = null;
            }

            const referrerAddress = referrer || ethers.ZeroAddress;
            const price = await packContract.currentPackPrice();


            // Single transaction: buy, set referrer, and open pack
            // Explicit gas limit — batchMint of 5 ERC721Enumerable NFTs + fund distribution uses ~3.1M gas
            const tx = await packContract.buyAndOpenPack(referrerAddress, {
                value: BigInt(price.toString()),
                gasLimit: 10_000_000n
            });

            const receipt = await tx.wait();

            // Parse CardMinted events to get token IDs + startup data
            const mintedTokens: { tokenId: number; startupId: number; edition: number }[] = [];
            for (const log of receipt.logs) {
                try {
                    const parsed = nftContract.interface.parseLog(log);
                    if (parsed?.name === 'CardMinted') {
                        mintedTokens.push({
                            tokenId: Number(parsed.args.tokenId),
                            startupId: Number(parsed.args.startupId),
                            edition: Number(parsed.args.edition),
                        });
                    }
                } catch { }
            }


            // Invalidate cache after purchase
            blockchainCache.invalidate(CacheKeys.packsSold());
            blockchainCache.invalidatePrefix(`nft:owned:${signerAddress}`);
            blockchainCache.invalidatePrefix(`nft:cards:${signerAddress}`);
            blockchainCache.invalidatePrefix(`pack:user:${signerAddress}`);

            // Fetch metadata for all cards in parallel, fallback to event data
            const metadataResults = await Promise.all(
                mintedTokens.map(mt => fetchCardMetadata(mt.tokenId))
            );
            const cards: CardData[] = mintedTokens.map((mt, i) => {
                const card = metadataResults[i];
                if (card) return card;
                // Fallback: construct from on-chain event data
                const startup = STARTUPS[mt.startupId];
                return {
                    tokenId: mt.tokenId,
                    startupId: mt.startupId,
                    name: startup?.name || 'Unknown',
                    rarity: RARITY_STRING_MAP[startup?.rarity || 'Common'] || Rarity.COMMON,
                    multiplier: startup?.multiplier || 1,
                    isLocked: false,
                    image: `/images/${mt.startupId}.png`,
                    edition: mt.edition,
                };
            });
            cards.forEach(card => blockchainCache.set(CacheKeys.cardMetadata(card.tokenId), card));

            return { success: true, cards };
        } catch (e: any) {
            const msg = e.reason || e.message || 'Failed to buy pack';
            setError(msg);
            return { success: false, error: msg };
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Buy AND Open multiple packs (up to 10) in one transaction
    const buyAndOpenMultiplePacks = useCallback(async (
        signer: ethers.Signer,
        count: number
    ): Promise<{ success: boolean; cards?: CardData[]; error?: string }> => {
        setIsLoading(true);
        setError(null);

        try {
            const packContract = getPackOpenerContract(signer);
            const nftContract = getNFTContract(signer);
            const signerAddress = await signer.getAddress();

            // Get referrer
            let referrer = localStorage.getItem(`attentionx_referrer_${getActiveNetworkId()}`);
            if (!referrer) {
                const params = new URLSearchParams(window.location.search);
                const ref = params.get('ref');
                if (ref && ref.startsWith('0x') && ref.length === 42) {
                    referrer = ref.toLowerCase();
                }
            }
            if (referrer && referrer.toLowerCase() === signerAddress.toLowerCase()) {
                referrer = null;
            }

            const referrerAddress = referrer || ethers.ZeroAddress;
            const price = await packContract.currentPackPrice();
            const totalPrice = BigInt(price.toString()) * BigInt(count);


            // Explicit gas limit — scales with pack count (each pack mints 5 NFTs)
            const gasPerPack = 4_000_000n;
            const tx = await packContract.buyAndOpenMultiplePacks(referrerAddress, count, {
                value: totalPrice,
                gasLimit: gasPerPack * BigInt(count) + 1_000_000n
            });

            const receipt = await tx.wait();

            // Parse CardMinted events to get all token IDs + startup data
            const mintedTokens: { tokenId: number; startupId: number; edition: number }[] = [];
            for (const log of receipt.logs) {
                try {
                    const parsed = nftContract.interface.parseLog(log);
                    if (parsed?.name === 'CardMinted') {
                        mintedTokens.push({
                            tokenId: Number(parsed.args.tokenId),
                            startupId: Number(parsed.args.startupId),
                            edition: Number(parsed.args.edition),
                        });
                    }
                } catch { }
            }


            // Invalidate cache
            blockchainCache.invalidate(CacheKeys.packsSold());
            blockchainCache.invalidatePrefix(`nft:owned:${signerAddress}`);
            blockchainCache.invalidatePrefix(`nft:cards:${signerAddress}`);
            blockchainCache.invalidatePrefix(`pack:user:${signerAddress}`);

            // Fetch metadata for all cards in parallel, fallback to event data
            const metadataResults = await Promise.all(
                mintedTokens.map(mt => fetchCardMetadata(mt.tokenId))
            );
            const cards: CardData[] = mintedTokens.map((mt, i) => {
                const card = metadataResults[i];
                if (card) return card;
                const startup = STARTUPS[mt.startupId];
                return {
                    tokenId: mt.tokenId,
                    startupId: mt.startupId,
                    name: startup?.name || 'Unknown',
                    rarity: RARITY_STRING_MAP[startup?.rarity || 'Common'] || Rarity.COMMON,
                    multiplier: startup?.multiplier || 1,
                    isLocked: false,
                    image: `/images/${mt.startupId}.png`,
                    edition: mt.edition,
                };
            });
            cards.forEach(card => blockchainCache.set(CacheKeys.cardMetadata(card.tokenId), card));

            return { success: true, cards };
        } catch (e: any) {
            const msg = e.reason || e.message || 'Failed to buy packs';
            setError(msg);
            return { success: false, error: msg };
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Get user's unopened packs count
    const getUnopenedPackCount = useCallback(async (address: string): Promise<number> => {
        try {
            const contract = getPackOpenerContract();
            return Number(await contract.getUnopenedPackCount(address));
        } catch {
            return 0;
        }
    }, []);

    // Get user's pack history
    const getUserPacks = useCallback(async (address: string): Promise<number[]> => {
        try {
            const contract = getPackOpenerContract();
            const packs = await contract.getUserPacks(address);
            return packs.map((p: bigint) => Number(p));
        } catch {
            return [];
        }
    }, []);

    return {
        isLoading,
        error,
        getPackPrice,
        getPacksSold,
        buyAndOpenPack,
        buyAndOpenMultiplePacks,
        getUnopenedPackCount,
        getUserPacks,
    };
}
