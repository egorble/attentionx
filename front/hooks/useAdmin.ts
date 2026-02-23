// Admin contract operations hook
import { useState, useCallback } from 'react';
import { ethers } from 'ethers';
import {
    getNFTContract,
    getPackOpenerContract,
    getTournamentContract,
    formatXTZ,
    getActiveContracts,
} from '../lib/contracts';
import { getActiveNetwork } from '../lib/networks';

// Admin addresses (multi-admin support)
export const ADMIN_ADDRESSES = [
    '0x233c8C54F25734B744E522bdC1Eed9cbc8C97D0c',
    '0xB36402e87a86206D3a114a98B53f31362291fe1B',
].map(a => a.toLowerCase());

export function isAdmin(address: string | null): boolean {
    if (!address) return false;
    return ADMIN_ADDRESSES.includes(address.toLowerCase());
}

export interface ContractBalances {
    nft: bigint;
    packOpener: bigint;
    tournament: bigint;
}

export interface AdminStats {
    packsSold: number;
    packPrice: bigint;
    totalNFTs: number;
    activeTournamentId: number;
    nextTournamentId: number;
}

export interface TournamentData {
    id: number;
    registrationStart: number;
    startTime: number;
    endTime: number;
    prizePool: bigint;
    entryCount: number;
    status: number; // 0=Created, 1=Active, 2=Finalized, 3=Cancelled
}

export function useAdmin() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // ============ READ FUNCTIONS ============

    // Get contract balances using CONTRACTS addresses directly
    const getContractBalances = useCallback(async (): Promise<ContractBalances> => {
        try {
            const network = getActiveNetwork();
            const contracts = getActiveContracts();
            const provider = new ethers.JsonRpcProvider(network.rpcUrl);

            const [nft, packOpener, tournament] = await Promise.all([
                provider.getBalance(contracts.AttentionX_NFT),
                provider.getBalance(contracts.PackOpener),
                provider.getBalance(contracts.TournamentManager),
            ]);

            return { nft, packOpener, tournament };
        } catch (e) {
            return { nft: BigInt(0), packOpener: BigInt(0), tournament: BigInt(0) };
        }
    }, []);

    // Get admin stats
    const getAdminStats = useCallback(async (): Promise<AdminStats> => {
        try {
            const packContract = getPackOpenerContract();
            const nftContract = getNFTContract();
            const tournamentContract = getTournamentContract();

            const [packsSold, packPrice, totalNFTs, activeTournamentId, nextTournamentId] = await Promise.all([
                packContract.packsSold(),
                packContract.currentPackPrice(),
                nftContract.totalSupply(),
                packContract.activeTournamentId(),
                tournamentContract.nextTournamentId(),
            ]);

            return {
                packsSold: Number(packsSold),
                packPrice,
                totalNFTs: Number(totalNFTs),
                activeTournamentId: Number(activeTournamentId),
                nextTournamentId: Number(nextTournamentId),
            };
        } catch (e) {
            return { packsSold: 0, packPrice: BigInt(5e18), totalNFTs: 0, activeTournamentId: 0, nextTournamentId: 0 };
        }
    }, []);

    // Get all tournaments
    const getTournaments = useCallback(async (): Promise<TournamentData[]> => {
        try {
            const contract = getTournamentContract();
            const nextId = await contract.nextTournamentId();
            const count = Number(nextId);


            const tournaments: TournamentData[] = [];
            for (let i = 0; i < count; i++) {
                try {
                    const t = await contract.getTournament(i);
                    tournaments.push({
                        id: Number(t.id),
                        registrationStart: Number(t.registrationStart),
                        startTime: Number(t.startTime),
                        endTime: Number(t.endTime),
                        prizePool: t.prizePool,
                        entryCount: Number(t.entryCount),
                        status: Number(t.status),
                    });
                } catch (e) {
                }
            }

            return tournaments;
        } catch (e) {
            return [];
        }
    }, []);

    // ============ PACK OPENER ADMIN ============

    // Withdraw funds from PackOpener
    const withdrawPackOpener = useCallback(async (signer: ethers.Signer): Promise<{ success: boolean; error?: string }> => {
        setIsLoading(true);
        setError(null);

        try {
            const contract = getPackOpenerContract(signer);

            const tx = await contract.withdraw();
            await tx.wait();

            return { success: true };
        } catch (e: any) {
            const msg = e.reason || e.message || 'Withdrawal failed';
            setError(msg);
            return { success: false, error: msg };
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Set pack price
    const setPackPrice = useCallback(async (
        signer: ethers.Signer,
        priceInXTZ: number
    ): Promise<{ success: boolean; error?: string }> => {
        setIsLoading(true);
        setError(null);

        try {
            const contract = getPackOpenerContract(signer);
            const priceWei = ethers.parseEther(priceInXTZ.toString());

            const tx = await contract.setPackPrice(priceWei);
            await tx.wait();

            return { success: true };
        } catch (e: any) {
            const msg = e.reason || e.message || 'Failed to set price';
            setError(msg);
            return { success: false, error: msg };
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Set active tournament
    const setActiveTournament = useCallback(async (
        signer: ethers.Signer,
        tournamentId: number
    ): Promise<{ success: boolean; error?: string }> => {
        setIsLoading(true);
        setError(null);

        try {
            const contract = getPackOpenerContract(signer);

            const tx = await contract.setActiveTournament(tournamentId);
            await tx.wait();

            return { success: true };
        } catch (e: any) {
            const msg = e.reason || e.message || 'Failed to set tournament';
            setError(msg);
            return { success: false, error: msg };
        } finally {
            setIsLoading(false);
        }
    }, []);

    // ============ TOURNAMENT ADMIN ============

    // Create tournament
    const createTournament = useCallback(async (
        signer: ethers.Signer,
        registrationStart: number, // Unix timestamp
        startTime: number,
        endTime: number
    ): Promise<{ success: boolean; tournamentId?: number; error?: string }> => {
        setIsLoading(true);
        setError(null);

        try {
            const contract = getTournamentContract(signer);

            const tx = await contract.createTournament(
                registrationStart,
                startTime,
                endTime
            );
            const receipt = await tx.wait();

            // Parse event to get tournament ID
            let tournamentId: number | undefined;
            for (const log of receipt.logs) {
                try {
                    const parsed = contract.interface.parseLog(log);
                    if (parsed?.name === 'TournamentCreated') {
                        tournamentId = Number(parsed.args.tournamentId);
                        break;
                    }
                } catch { }
            }

            return { success: true, tournamentId };
        } catch (e: any) {
            const msg = e.reason || e.message || 'Failed to create tournament';
            setError(msg);
            return { success: false, error: msg };
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Finalize tournament with winners
    const finalizeTournament = useCallback(async (
        signer: ethers.Signer,
        tournamentId: number,
        winners: string[],
        amounts: bigint[]
    ): Promise<{ success: boolean; error?: string }> => {
        setIsLoading(true);
        setError(null);

        try {
            const contract = getTournamentContract(signer);

            const tx = await contract.finalizeTournament(
                tournamentId,
                winners,
                amounts
            );
            await tx.wait();

            return { success: true };
        } catch (e: any) {
            const msg = e.reason || e.message || 'Failed to finalize';
            setError(msg);
            return { success: false, error: msg };
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Finalize tournament with points-based distribution
    const finalizeWithPoints = useCallback(async (
        signer: ethers.Signer,
        tournamentId: number,
        points: bigint[] // Array of 19 points for startupIds 1-19
    ): Promise<{ success: boolean; error?: string }> => {
        setIsLoading(true);
        setError(null);

        try {
            if (points.length !== 19) {
                throw new Error('Must provide exactly 19 points values');
            }

            const contract = getTournamentContract(signer);

            const tx = await contract.finalizeWithPoints(
                tournamentId,
                points
            );
            await tx.wait();

            return { success: true };
        } catch (e: any) {
            const msg = e.reason || e.message || 'Failed to finalize with points';
            setError(msg);
            return { success: false, error: msg };
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Cancel tournament
    const cancelTournament = useCallback(async (
        signer: ethers.Signer,
        tournamentId: number
    ): Promise<{ success: boolean; error?: string }> => {
        setIsLoading(true);
        setError(null);

        try {
            const contract = getTournamentContract(signer);

            const tx = await contract.cancelTournament(tournamentId);
            await tx.wait();

            return { success: true };
        } catch (e: any) {
            const msg = e.reason || e.message || 'Failed to cancel';
            setError(msg);
            return { success: false, error: msg };
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Withdraw from specific tournament prize pool
    const withdrawFromPrizePool = useCallback(async (
        signer: ethers.Signer,
        tournamentId: number,
        amount: bigint,
        to: string
    ): Promise<{ success: boolean; error?: string }> => {
        setIsLoading(true);
        setError(null);

        try {
            const contract = getTournamentContract(signer);

            const tx = await contract.withdrawFromPrizePool(
                tournamentId,
                amount,
                to
            );
            await tx.wait();

            return { success: true };
        } catch (e: any) {
            const msg = e.reason || e.message || 'Withdrawal failed';
            setError(msg);
            return { success: false, error: msg };
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Emergency withdraw from TournamentManager
    const emergencyWithdrawTournament = useCallback(async (
        signer: ethers.Signer,
        amount: bigint,
        to: string
    ): Promise<{ success: boolean; error?: string }> => {
        setIsLoading(true);
        setError(null);

        try {
            const contract = getTournamentContract(signer);

            const tx = await contract.emergencyWithdraw(amount, to);
            await tx.wait();

            return { success: true };
        } catch (e: any) {
            const msg = e.reason || e.message || 'Withdrawal failed';
            setError(msg);
            return { success: false, error: msg };
        } finally {
            setIsLoading(false);
        }
    }, []);

    // ============ PAUSE/UNPAUSE ============

    const pausePackOpener = useCallback(async (signer: ethers.Signer) => {
        const contract = getPackOpenerContract(signer);
        const tx = await contract.pause();
        await tx.wait();
    }, []);

    const unpausePackOpener = useCallback(async (signer: ethers.Signer) => {
        const contract = getPackOpenerContract(signer);
        const tx = await contract.unpause();
        await tx.wait();
    }, []);

    const pauseTournament = useCallback(async (signer: ethers.Signer) => {
        const contract = getTournamentContract(signer);
        const tx = await contract.pause();
        await tx.wait();
    }, []);

    const unpauseTournament = useCallback(async (signer: ethers.Signer) => {
        const contract = getTournamentContract(signer);
        const tx = await contract.unpause();
        await tx.wait();
    }, []);

    return {
        isLoading,
        error,
        // Read
        getContractBalances,
        getAdminStats,
        getTournaments,
        // PackOpener
        withdrawPackOpener,
        setPackPrice,
        setActiveTournament,
        pausePackOpener,
        unpausePackOpener,
        // Tournament
        createTournament,
        finalizeTournament,
        finalizeWithPoints,
        cancelTournament,
        withdrawFromPrizePool,
        emergencyWithdrawTournament,
        pauseTournament,
        unpauseTournament,
    };
}
