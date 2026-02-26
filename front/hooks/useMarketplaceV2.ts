import { useState, useCallback } from 'react';
import { BrowserProvider, ethers } from 'ethers';
import { getMarketplaceV2Contract, getNFTContract, getPackNFTContract, CONTRACTS, formatXTZ } from '@/lib/contracts';
import { getActiveContracts } from '@/lib/contracts';
import { blockchainCache, CacheKeys, CacheTTL } from '../lib/cache';
import { getActiveNetworkId } from '../lib/networks';
import { useWalletContext } from '../context/WalletContext';

// ============ Constants ============
// Gas limits removed - letting ethers.js auto-estimate for better reliability

// ============ Types ============
export interface Bid {
    bidId: bigint;
    bidder: string;
    tokenId: bigint;
    amount: bigint;
    expiration: bigint;
    active: boolean;
    nftAddr?: string;
}

export interface Auction {
    auctionId: bigint;
    seller: string;
    tokenId: bigint;
    startPrice: bigint;
    reservePrice: bigint;
    highestBid: bigint;
    highestBidder: string;
    startTime: bigint;
    endTime: bigint;
    status: number; // 0=Active, 1=Ended, 2=Cancelled
    nftAddr?: string;
    isPack?: boolean;
}

export interface Sale {
    tokenId: bigint;
    seller: string;
    buyer: string;
    price: bigint;
    timestamp: bigint;
    saleType: number; // 0=Listing, 1=Bid, 2=Auction
}

export interface TokenStats {
    totalSales: bigint;
    totalVolume: bigint;
    highestSale: bigint;
    lowestSale: bigint;
    lastSalePrice: bigint;
    lastSaleTime: bigint;
}

export interface MarketplaceStats {
    totalListings: bigint;
    activeBids: bigint;
    activeAuctions: bigint;
    totalVolume: bigint;
    totalSales: bigint;
}

export interface Listing {
    listingId: bigint;
    seller: string;
    tokenId: bigint;
    price: bigint;
    listedAt: bigint;
    active: boolean;
    nftAddr?: string;
    isPack?: boolean;
}

// ============ Hook ============
export function useMarketplaceV2() {
    const { address, isConnected, walletProvider } = useWalletContext();

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Invalidate all marketplace cache keys so next read fetches fresh from blockchain.
    // Called after every successful mutation (list, buy, cancel, bid, auction, etc.)
    const invalidateMarketplaceCache = useCallback(() => {
        blockchainCache.invalidate(CacheKeys.activeListings());
        blockchainCache.invalidate(CacheKeys.activeAuctions());
        blockchainCache.invalidate(CacheKeys.marketplaceStats());
        if (address) {
            blockchainCache.invalidate(CacheKeys.userListings(address));
            blockchainCache.invalidate(CacheKeys.userBids(address));
        }
    }, [address]);

    // Get signer
    const getSigner = useCallback(async () => {
        if (!walletProvider) throw new Error('Wallet not connected');
        const provider = new BrowserProvider(walletProvider as any);
        return provider.getSigner();
    }, [walletProvider]);

    // ============ Listings ============
    // ============ Listings ============
    // Cache-first polling for active listings
    const getActiveListings = useCallback(async (): Promise<Listing[]> => {
        const key = CacheKeys.activeListings();

        // Check cache first
        const cached = blockchainCache.get<Listing[]>(key);
        if (cached !== undefined) {
            // Background refresh if stale - hook consumer should use usePollingData for persistent updates
            // But we'll trigger a background fetch if it's stale to ensure freshness
            if (blockchainCache.isStale(key, CacheTTL.DEFAULT)) {
                blockchainCache.fetchInBackground(key, async () => {
                    const contract = getMarketplaceV2Contract();
                    const listings = await contract.getActiveListings();
                    const packNftAddr = getActiveContracts().PackNFT?.toLowerCase();
                    return listings.map((l: any) => ({
                        listingId: l.listingId,
                        seller: l.seller,
                        tokenId: l.tokenId,
                        price: l.price,
                        listedAt: l.listedAt,
                        active: l.active,
                        nftAddr: l.nftAddr,
                        isPack: l.nftAddr?.toLowerCase() === packNftAddr,
                    }));
                });
            }
            return cached;
        }

        return blockchainCache.getOrFetch(key, async () => {
            const contract = getMarketplaceV2Contract();
            const listings = await contract.getActiveListings();
            const packNftAddr = getActiveContracts().PackNFT?.toLowerCase();
            return listings.map((l: any) => ({
                listingId: l.listingId,
                seller: l.seller,
                tokenId: l.tokenId,
                price: l.price,
                listedAt: l.listedAt,
                active: l.active,
                nftAddr: l.nftAddr,
                isPack: l.nftAddr?.toLowerCase() === packNftAddr,
            }));
        }, CacheTTL.DEFAULT);
    }, []);

    const getUserListings = useCallback(async (userAddress: string): Promise<Listing[]> => {
        const key = CacheKeys.userListings(userAddress);

        const cached = blockchainCache.get<Listing[]>(key);
        if (cached !== undefined) {
            if (blockchainCache.isStale(key, CacheTTL.DEFAULT)) {
                blockchainCache.fetchInBackground(key, async () => {
                    const contract = getMarketplaceV2Contract();
                    const listings = await contract.getListingsBySeller(userAddress);
                    const packNftAddr = getActiveContracts().PackNFT?.toLowerCase();
                    return listings.map((l: any) => ({
                        listingId: l.listingId,
                        seller: l.seller,
                        tokenId: l.tokenId,
                        price: l.price,
                        listedAt: l.listedAt,
                        active: l.active,
                        nftAddr: l.nftAddr,
                        isPack: l.nftAddr?.toLowerCase() === packNftAddr,
                    }));
                });
            }
            return cached;
        }

        return blockchainCache.getOrFetch(key, async () => {
            const contract = getMarketplaceV2Contract();
            const listings = await contract.getListingsBySeller(userAddress);
            const packNftAddr = getActiveContracts().PackNFT?.toLowerCase();
            return listings.map((l: any) => ({
                listingId: l.listingId,
                seller: l.seller,
                tokenId: l.tokenId,
                price: l.price,
                listedAt: l.listedAt,
                active: l.active,
                nftAddr: l.nftAddr,
                isPack: l.nftAddr?.toLowerCase() === packNftAddr,
            }));
        }, CacheTTL.DEFAULT);
    }, []);

    const listCard = useCallback(async (tokenId: bigint, priceInXTZ: string) => {
        setLoading(true);
        setError(null);
        try {
            const signer = await getSigner();
            const nftContract = getNFTContract(signer);
            const marketplaceContract = getMarketplaceV2Contract(signer);

            // Approve marketplace
            const approveTx = await nftContract.approve(CONTRACTS.MarketplaceV2, tokenId);
            await approveTx.wait();

            // List card
            const priceWei = ethers.parseEther(priceInXTZ);
            const listTx = await marketplaceContract.listCard(tokenId, priceWei);
            await listTx.wait();

            invalidateMarketplaceCache();
            return true;
        } catch (err: any) {
            setError(err.message || 'Failed to list card');
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getSigner, invalidateMarketplaceCache]);

    const listPack = useCallback(async (tokenId: bigint, priceInXTZ: string) => {
        setLoading(true);
        setError(null);
        try {
            const signer = await getSigner();
            const packNft = getPackNFTContract(signer);
            const marketplaceContract = getMarketplaceV2Contract(signer);

            // Approve marketplace for pack NFT
            const contracts = getActiveContracts();
            const approveTx = await packNft.approve(contracts.MarketplaceV2, tokenId);
            await approveTx.wait();

            // List pack
            const priceWei = ethers.parseEther(priceInXTZ);
            const listTx = await marketplaceContract.listPack(tokenId, priceWei);
            await listTx.wait();

            invalidateMarketplaceCache();
            return true;
        } catch (err: any) {
            setError(err.message || 'Failed to list pack');
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getSigner, invalidateMarketplaceCache]);

    const buyCard = useCallback(async (listingId: bigint, price: bigint) => {
        setLoading(true);
        setError(null);
        try {
            const signer = await getSigner();
            const contract = getMarketplaceV2Contract(signer);

            const tx = await contract.buyCard(listingId, {
                value: price
            });
            await tx.wait();

            invalidateMarketplaceCache();
            return true;
        } catch (err: any) {
            setError(err.message || 'Failed to buy card');
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getSigner, invalidateMarketplaceCache]);

    const cancelListing = useCallback(async (listingId: bigint) => {
        setLoading(true);
        setError(null);
        try {
            const signer = await getSigner();
            const contract = getMarketplaceV2Contract(signer);

            const tx = await contract.cancelListing(listingId);
            await tx.wait();

            invalidateMarketplaceCache();
            return true;
        } catch (err: any) {
            setError(err.message || 'Failed to cancel listing');
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getSigner, invalidateMarketplaceCache]);

    // ============ Bids ============
    const getUserBids = useCallback(async (userAddress: string): Promise<Bid[]> => {
        const key = CacheKeys.userBids(userAddress);

        const cached = blockchainCache.get<Bid[]>(key);
        if (cached !== undefined) {
            if (blockchainCache.isStale(key, CacheTTL.DEFAULT)) {
                blockchainCache.fetchInBackground(key, async () => {
                    const contract = getMarketplaceV2Contract();
                    const bids = await contract.getUserBids(userAddress);
                    return bids.map((b: any) => ({
                        bidId: b.bidId,
                        bidder: b.bidder,
                        tokenId: b.tokenId,
                        amount: b.amount,
                        expiration: b.expiration,
                        active: b.active,
                    }));
                });
            }
            return cached;
        }

        return blockchainCache.getOrFetch(key, async () => {
            const contract = getMarketplaceV2Contract();
            const bids = await contract.getUserBids(userAddress);
            return bids.map((b: any) => ({
                bidId: b.bidId,
                bidder: b.bidder,
                tokenId: b.tokenId,
                amount: b.amount,
                expiration: b.expiration,
                active: b.active,
            }));
        }, CacheTTL.DEFAULT);
    }, []);

    const placeBid = useCallback(async (tokenId: bigint, amountInXTZ: string, expirationDays: number = 7) => {
        setLoading(true);
        setError(null);
        try {
            const signer = await getSigner();
            const contract = getMarketplaceV2Contract(signer);

            const amountWei = ethers.parseEther(amountInXTZ);
            const expiration = BigInt(Math.floor(Date.now() / 1000) + expirationDays * 24 * 60 * 60);

            const tx = await contract.placeBid(tokenId, expiration, {
                value: amountWei
            });
            await tx.wait();

            invalidateMarketplaceCache();
            return true;
        } catch (err: any) {
            setError(err.message || 'Failed to place bid');
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getSigner, invalidateMarketplaceCache]);

    const cancelBid = useCallback(async (bidId: bigint) => {
        setLoading(true);
        setError(null);
        try {
            const signer = await getSigner();
            const contract = getMarketplaceV2Contract(signer);

            const tx = await contract.cancelBid(bidId);
            await tx.wait();

            invalidateMarketplaceCache();
            return true;
        } catch (err: any) {
            setError(err.message || 'Failed to cancel bid');
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getSigner, invalidateMarketplaceCache]);

    const acceptBid = useCallback(async (bidId: bigint) => {
        setLoading(true);
        setError(null);
        try {
            const signer = await getSigner();
            const contract = getMarketplaceV2Contract(signer);

            const tx = await contract.acceptBid(bidId);
            await tx.wait();

            invalidateMarketplaceCache();
            return true;
        } catch (err: any) {
            setError(err.message || 'Failed to accept bid');
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getSigner, invalidateMarketplaceCache]);

    const getBidsForToken = useCallback(async (tokenId: bigint): Promise<Bid[]> => {
        try {
            const contract = getMarketplaceV2Contract();
            const bids = await contract.getActiveBidsForToken(tokenId);
            return bids.map((b: any) => ({
                bidId: b.bidId,
                bidder: b.bidder,
                tokenId: b.tokenId,
                amount: b.amount,
                expiration: b.expiration,
                active: b.active,
            }));
        } catch (err: any) {
            return [];
        }
    }, []);

    const getMyBids = useCallback(async (): Promise<Bid[]> => {
        if (!address) return [];
        const key = CacheKeys.userBids(address);

        const cached = blockchainCache.get<Bid[]>(key);
        if (cached !== undefined) {
            if (blockchainCache.isStale(key, CacheTTL.DEFAULT)) {
                blockchainCache.fetchInBackground(key, async () => {
                    const contract = getMarketplaceV2Contract();
                    const bids = await contract.getUserBids(address);
                    return bids.map((b: any) => ({
                        bidId: b.bidId,
                        bidder: b.bidder,
                        tokenId: b.tokenId,
                        amount: b.amount,
                        expiration: b.expiration,
                        active: b.active,
                    }));
                });
            }
            return cached;
        }

        return blockchainCache.getOrFetch(key, async () => {
            const contract = getMarketplaceV2Contract();
            const bids = await contract.getUserBids(address);
            return bids.map((b: any) => ({
                bidId: b.bidId,
                bidder: b.bidder,
                tokenId: b.tokenId,
                amount: b.amount,
                expiration: b.expiration,
                active: b.active,
            }));
        }, CacheTTL.DEFAULT);
    }, [address]);

    // ============ Auctions ============
    const createAuction = useCallback(async (
        tokenId: bigint,
        startPriceXTZ: string,
        reservePriceXTZ: string,
        durationDays: number
    ) => {
        setLoading(true);
        setError(null);
        try {
            const signer = await getSigner();
            const nftContract = getNFTContract(signer);
            const contract = getMarketplaceV2Contract(signer);

            // Approve marketplace
            const approveTx = await nftContract.approve(CONTRACTS.MarketplaceV2, tokenId);
            await approveTx.wait();

            const startPrice = ethers.parseEther(startPriceXTZ);
            const reservePrice = ethers.parseEther(reservePriceXTZ);
            const duration = BigInt(durationDays * 24 * 60 * 60);

            const tx = await contract.createAuction(tokenId, startPrice, reservePrice, duration);
            await tx.wait();

            invalidateMarketplaceCache();
            return true;
        } catch (err: any) {
            setError(err.message || 'Failed to create auction');
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getSigner, invalidateMarketplaceCache]);

    const createPackAuction = useCallback(async (
        tokenId: bigint,
        startPriceXTZ: string,
        reservePriceXTZ: string,
        durationDays: number
    ) => {
        setLoading(true);
        setError(null);
        try {
            const signer = await getSigner();
            const packNft = getPackNFTContract(signer);
            const contract = getMarketplaceV2Contract(signer);

            // Approve marketplace for pack NFT
            const contracts = getActiveContracts();
            const approveTx = await packNft.approve(contracts.MarketplaceV2, tokenId);
            await approveTx.wait();

            const startPrice = ethers.parseEther(startPriceXTZ);
            const reservePrice = ethers.parseEther(reservePriceXTZ);
            const duration = BigInt(durationDays * 24 * 60 * 60);

            const tx = await contract.createPackAuction(tokenId, startPrice, reservePrice, duration);
            await tx.wait();

            invalidateMarketplaceCache();
            return true;
        } catch (err: any) {
            setError(err.message || 'Failed to create pack auction');
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getSigner, invalidateMarketplaceCache]);

    const bidOnAuction = useCallback(async (auctionId: bigint, amountInXTZ: string) => {
        setLoading(true);
        setError(null);
        try {
            const signer = await getSigner();
            const contract = getMarketplaceV2Contract(signer);

            const amountWei = ethers.parseEther(amountInXTZ);

            const tx = await contract.bidOnAuction(auctionId, {
                value: amountWei
            });
            await tx.wait();

            invalidateMarketplaceCache();
            return true;
        } catch (err: any) {
            setError(err.message || 'Failed to bid on auction');
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getSigner, invalidateMarketplaceCache]);

    const finalizeAuction = useCallback(async (auctionId: bigint) => {
        setLoading(true);
        setError(null);
        try {
            const signer = await getSigner();
            const contract = getMarketplaceV2Contract(signer);

            const tx = await contract.finalizeAuction(auctionId);
            await tx.wait();

            invalidateMarketplaceCache();
            return true;
        } catch (err: any) {
            setError(err.message || 'Failed to finalize auction');
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getSigner, invalidateMarketplaceCache]);

    const cancelAuction = useCallback(async (auctionId: bigint) => {
        setLoading(true);
        setError(null);
        try {
            const signer = await getSigner();
            const contract = getMarketplaceV2Contract(signer);

            const tx = await contract.cancelAuction(auctionId);
            await tx.wait();

            invalidateMarketplaceCache();
            return true;
        } catch (err: any) {
            setError(err.message || 'Failed to cancel auction');
            throw err;
        } finally {
            setLoading(false);
        }
    }, [getSigner, invalidateMarketplaceCache]);

    const getActiveAuctions = useCallback(async (): Promise<Auction[]> => {
        const key = CacheKeys.activeAuctions();

        const cached = blockchainCache.get<Auction[]>(key);
        if (cached !== undefined) {
            if (blockchainCache.isStale(key, CacheTTL.DEFAULT)) {
                blockchainCache.fetchInBackground(key, async () => {
                    const contract = getMarketplaceV2Contract();
                    const auctions = await contract.getActiveAuctions();
                    const packNftAddr = getActiveContracts().PackNFT?.toLowerCase();
                    return auctions.map((a: any) => ({
                        auctionId: a.auctionId,
                        seller: a.seller,
                        tokenId: a.tokenId,
                        startPrice: a.startPrice,
                        reservePrice: a.reservePrice,
                        highestBid: a.highestBid,
                        highestBidder: a.highestBidder,
                        startTime: a.startTime,
                        endTime: a.endTime,
                        status: a.status,
                        nftAddr: a.nftAddr,
                        isPack: a.nftAddr?.toLowerCase() === packNftAddr,
                    }));
                });
            }
            return cached;
        }

        return blockchainCache.getOrFetch(key, async () => {
            const contract = getMarketplaceV2Contract();
            const auctions = await contract.getActiveAuctions();
            const packNftAddr = getActiveContracts().PackNFT?.toLowerCase();
            return auctions.map((a: any) => ({
                auctionId: a.auctionId,
                seller: a.seller,
                tokenId: a.tokenId,
                startPrice: a.startPrice,
                reservePrice: a.reservePrice,
                highestBid: a.highestBid,
                highestBidder: a.highestBidder,
                startTime: a.startTime,
                endTime: a.endTime,
                status: a.status,
                nftAddr: a.nftAddr,
                isPack: a.nftAddr?.toLowerCase() === packNftAddr,
            }));
        }, CacheTTL.DEFAULT);
    }, []);

    // ============ User Sold Items ============
    // Queries on-chain CardSold + BidAccepted events where seller = address
    const getUserSoldItems = useCallback(async (sellerAddress: string): Promise<Sale[]> => {
        try {
            const cacheKey = `${getActiveNetworkId()}:marketplace:sold:${sellerAddress.toLowerCase()}`;
            const cached = blockchainCache.get<Sale[]>(cacheKey);
            if (cached && !blockchainCache.isStale(cacheKey, CacheTTL.LONG)) return cached;

            const { getReadProvider } = await import('../lib/contracts');
            const provider = getReadProvider();
            const contract = getMarketplaceV2Contract(provider);

            const [soldEvents, bidEvents] = await Promise.all([
                contract.queryFilter(contract.filters.CardSold(null, sellerAddress)).catch(() => []),
                contract.queryFilter(contract.filters.BidAccepted(null, sellerAddress)).catch(() => []),
            ]);

            const allEvents = [...soldEvents, ...bidEvents];

            // Fetch block timestamps in parallel
            const timestamps = await Promise.all(
                allEvents.map(e => provider.getBlock(e.blockNumber).then(b => b?.timestamp ?? 0).catch(() => 0))
            );

            const result: Sale[] = allEvents.map((e: any, i) => ({
                tokenId: e.args.tokenId,
                seller: e.args.seller,
                buyer: e.args.buyer ?? e.args.bidder,
                price: e.args.price ?? e.args.amount,
                timestamp: BigInt(timestamps[i]),
                saleType: i < soldEvents.length ? 0 : 1, // 0=Listing, 1=Bid
            }));

            // Sort newest first
            result.sort((a, b) => Number(b.timestamp - a.timestamp));

            blockchainCache.set(cacheKey, result);
            return result;
        } catch {
            return [];
        }
    }, []);

    // ============ History & Stats ============
    const getTokenSaleHistory = useCallback(async (tokenId: bigint): Promise<Sale[]> => {
        try {
            const contract = getMarketplaceV2Contract();
            const history = await contract.getTokenSaleHistory(tokenId);
            return history.map((s: any) => ({
                tokenId: s.tokenId,
                seller: s.seller,
                buyer: s.buyer,
                price: s.price,
                timestamp: s.timestamp,
                saleType: s.saleType,
            }));
        } catch (err: any) {
            return [];
        }
    }, []);

    const getTokenStats = useCallback(async (tokenId: bigint): Promise<TokenStats | null> => {
        try {
            const contract = getMarketplaceV2Contract();
            const stats = await contract.getTokenStats(tokenId);
            return {
                totalSales: stats.salesCount,
                totalVolume: stats.totalVolume,
                highestSale: stats.highestSale,
                lowestSale: stats.lowestSale,
                lastSalePrice: stats.lastSalePrice,
                lastSaleTime: 0n,
            };
        } catch (err: any) {
            return null;
        }
    }, []);

    const getMarketplaceStats = useCallback(async (): Promise<MarketplaceStats | null> => {
        try {
            const contract = getMarketplaceV2Contract();
            const [totalVolume, totalSales, activeListings, activeAuctions] = await contract.getGlobalStats();
            return {
                totalListings: activeListings,
                activeBids: 0n,
                activeAuctions: activeAuctions,
                totalVolume: totalVolume,
                totalSales: totalSales,
            };
        } catch (err: any) {
            return null;
        }
    }, []);

    return {
        // State
        loading,
        error,
        isConnected,
        address,

        // Listings
        getActiveListings,
        getUserListings,
        listCard,
        listPack,
        buyCard,
        cancelListing,

        // Bids
        placeBid,
        cancelBid,
        acceptBid,
        getBidsForToken,
        getMyBids,
        getUserBids,

        // Auctions
        createAuction,
        createPackAuction,
        bidOnAuction,
        finalizeAuction,
        cancelAuction,
        getActiveAuctions,

        // History & Stats
        getUserSoldItems,
        getTokenSaleHistory,
        getTokenStats,
        getMarketplaceStats,

        // Utils
        formatXTZ,
    };
}
