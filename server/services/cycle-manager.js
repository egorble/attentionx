/**
 * Cycle Manager — manages 10-minute Token Leagues cycles.
 *
 * Responsibilities:
 * - Auto-create new cycle every 10 minutes
 * - Snapshot start prices on cycle start
 * - Calculate live scores during cycle
 * - On cycle end: snapshot end prices, calculate final scores, rank players,
 *   calculate prize distribution, call contract.finalizeCycle()
 * - Auto-enter AutoPlay users into next cycle
 *
 * Usage:
 *   import { cycleManager } from './cycle-manager.js';
 *   cycleManager.start(priceEngine, wsServer);
 */

import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import { CHAIN, CONTRACTS, ADMIN_PRIVATE_KEY } from '../config.js';
import * as db from '../db/database.js';
import { TOKEN_LIST } from './price-engine.js';

const CYCLE_DURATION = 10 * 60; // 10 minutes in seconds
const LEVERAGE = 5; // 5x simulated leverage
const TICK_INTERVAL = 5000; // update live scores every 5s
const RETRY_MAX = 5;           // max retries for on-chain ops
const RETRY_BASE_MS = 2000;    // 2s initial delay

/** Retry an async function with exponential backoff */
async function retryAsync(fn, label, maxRetries = RETRY_MAX, baseMs = RETRY_BASE_MS) {
    let lastErr;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (attempt < maxRetries) {
                const delay = baseMs * Math.pow(2, attempt - 1) + Math.random() * 1000;
                console.warn(`[CycleManager] ${label} failed (attempt ${attempt}/${maxRetries}): ${err.message}. Retrying in ${(delay / 1000).toFixed(1)}s...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    throw lastErr;
}

const TOKEN_LEAGUES_ABI = [
    'function currentCycleId() view returns (uint256)',
    'function entryFee() view returns (uint256)',
    'function startNewCycle(uint256 startTime, uint256 endTime) returns (uint256)',
    'function finalizeCycle(uint256 cycleId, address[] winners, uint256[] amounts)',
    'function enterCycleFor(address user, uint8[5] tokenIds) payable',
    'function getCycle(uint256 cycleId) view returns (tuple(uint256 id, uint256 startTime, uint256 endTime, uint256 prizePool, uint256 entryCount, bool finalized))',
    'function hasEntered(uint256 cycleId, address user) view returns (bool)',
    'function getParticipants(uint256 cycleId) view returns (address[])',
    'function getUserTokens(uint256 cycleId, address user) view returns (uint8[5])',
];

class CycleManager extends EventEmitter {
    constructor() {
        super();
        this.priceEngine = null;
        this.wsServer = null;
        this.currentCycle = null; // { id, startTime, endTime, startPrices }
        this.tickInterval = null;
        this.cycleTimeout = null;
        this._started = false;
        this.liveLeaderboard = []; // cached live leaderboard for WS broadcast
        this._lastParticipantSync = 0; // timestamp of last on-chain participant sync
    }

    /**
     * Start the cycle manager.
     * @param {PriceEngine} priceEngine
     * @param {WSServer} wsServer
     */
    async start(priceEngine, wsServer) {
        if (this._started) return;
        this._started = true;
        this.priceEngine = priceEngine;
        this.wsServer = wsServer;

        console.log('[CycleManager] Starting...');

        // Run DB migrations
        try {
            db.runTokenLeaguesMigrations();
            console.log('[CycleManager] DB migrations applied');
        } catch (err) {
            console.error(`[CycleManager] DB migration error: ${err.message}`);
        }

        // ─── On-chain reconciliation: always sync with contract as source of truth ───
        let onChainCycleId = 0;
        try {
            const provider = new ethers.JsonRpcProvider(CHAIN.RPC_URL);
            const contract = new ethers.Contract(CONTRACTS.TokenLeagues, TOKEN_LEAGUES_ABI, provider);
            onChainCycleId = Number(await contract.currentCycleId());
            console.log(`[CycleManager] On-chain currentCycleId: ${onChainCycleId}`);

            // Finalize ALL expired unfinalized cycles (not just last 5)
            const scanFrom = Math.max(1, onChainCycleId - 20);
            for (let id = scanFrom; id <= onChainCycleId; id++) {
                const onChainCycle = await contract.getCycle(id);
                if (Number(onChainCycle.id) === 0) continue;

                const endTime = Number(onChainCycle.endTime);
                const nowSec = Math.floor(Date.now() / 1000);
                const dbCycle = db.getTokenCycle(id);

                // Ensure DB knows about this cycle
                if (!dbCycle) {
                    db.saveTokenCycle(id, Number(onChainCycle.startTime), endTime);
                    console.log(`[CycleManager] Registered on-chain cycle #${id} in DB`);
                }

                // Finalize expired unfinalized cycles
                if (!onChainCycle.finalized && nowSec >= endTime) {
                    if (!dbCycle || dbCycle.status !== 'finalized') {
                        console.log(`[CycleManager] Finalizing expired cycle #${id}...`);
                        try {
                            await this._finalizeCycle(id);
                        } catch (e) {
                            console.warn(`[CycleManager] Finalization of cycle #${id} failed: ${e.message}`);
                        }
                    }
                }
            }

            // Now check: is the on-chain current cycle still active?
            const currentOnChain = await contract.getCycle(onChainCycleId);
            const nowSec = Math.floor(Date.now() / 1000);
            if (Number(currentOnChain.id) > 0 && !currentOnChain.finalized && nowSec < Number(currentOnChain.endTime)) {
                // Adopt the on-chain current cycle directly
                const startTime = Number(currentOnChain.startTime);
                const endTime = Number(currentOnChain.endTime);

                // Get start prices from DB or snapshot current
                const existingPrices = db.getTokenPrices(onChainCycleId);
                const startPrices = {};
                if (existingPrices.length > 0) {
                    for (const p of existingPrices) startPrices[p.token_id] = p.start_price;
                } else {
                    const snapshot = this.priceEngine.getPriceSnapshot();
                    const priceRecords = [];
                    for (const s of snapshot) {
                        startPrices[s.tokenId] = s.price;
                        priceRecords.push({ tokenId: s.tokenId, startPrice: s.price });
                    }
                    db.saveTokenPrices(onChainCycleId, priceRecords);
                }

                this.currentCycle = { id: onChainCycleId, startTime, endTime, startPrices };
                db.saveDatabase();
                console.log(`[CycleManager] ✅ Adopted on-chain cycle #${onChainCycleId} (ends in ${endTime - nowSec}s)`);
                this._scheduleCycleEnd();
                this._startTick();
                return;
            }
        } catch (err) {
            console.warn(`[CycleManager] On-chain reconciliation failed: ${err.message}`);
        }

        // Fallback: check DB for active cycle
        const activeCycle = db.getActiveTokenCycle();
        if (activeCycle) {
            const now = Math.floor(Date.now() / 1000);
            if (now < activeCycle.end_time) {
                const prices = db.getTokenPrices(activeCycle.cycle_id);
                const startPrices = {};
                for (const p of prices) startPrices[p.token_id] = p.start_price;
                this.currentCycle = {
                    id: activeCycle.cycle_id,
                    startTime: activeCycle.start_time,
                    endTime: activeCycle.end_time,
                    startPrices,
                };
                console.log(`[CycleManager] Resumed DB cycle #${this.currentCycle.id}, ends in ${activeCycle.end_time - now}s`);
                this._scheduleCycleEnd();
                this._startTick();
                return;
            } else {
                console.log(`[CycleManager] DB cycle #${activeCycle.cycle_id} expired, finalizing...`);
                await this._finalizeCycle(activeCycle.cycle_id);
            }
        }

        // No active cycle anywhere — start fresh
        await this._startNewCycle();
    }

    stop() {
        this._started = false;
        if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null; }
        if (this.cycleTimeout) { clearTimeout(this.cycleTimeout); this.cycleTimeout = null; }
    }

    /** Get current cycle info for API/WS */
    getCurrentCycle() {
        if (!this.currentCycle) return null;
        const now = Math.floor(Date.now() / 1000);
        return {
            id: this.currentCycle.id,
            startTime: this.currentCycle.startTime,
            endTime: this.currentCycle.endTime,
            timeLeft: Math.max(0, this.currentCycle.endTime - now),
            status: now >= this.currentCycle.endTime ? 'finalizing' : 'active',
        };
    }

    /** Get live scores for current cycle */
    getLiveLeaderboard() {
        return this.liveLeaderboard;
    }

    /** Get live token performance for current cycle */
    getLiveTokenPerformance() {
        if (!this.currentCycle || !this.currentCycle.startPrices) return [];

        const currentPrices = this.priceEngine.getPrices();
        const performance = [];

        for (const t of TOKEN_LIST) {
            const startPrice = this.currentCycle.startPrices[t.id] || 0;
            const currentPrice = currentPrices[t.id]?.price || 0;
            const pctChange = startPrice > 0 ? ((currentPrice - startPrice) / startPrice) * 100 : 0;

            performance.push({
                tokenId: t.id,
                symbol: t.symbol,
                startPrice,
                currentPrice,
                pctChange,
                leveragedChange: pctChange * LEVERAGE,
            });
        }
        return performance;
    }

    // ─── Internal: Cycle Lifecycle ───

    async _startNewCycle() {
        const now = Math.floor(Date.now() / 1000);
        const startTime = now;
        const endTime = now + CYCLE_DURATION;

        // Try to create on-chain cycle with retries
        let cycleId;
        try {
            cycleId = await retryAsync(
                () => this._createCycleOnChain(startTime, endTime),
                'Create cycle on-chain'
            );
        } catch (err) {
            console.error('[CycleManager] On-chain cycle creation failed after retries, using local ID:', err.message);
            // Fallback: use local incrementing ID
            const lastCycle = db.getActiveTokenCycle();
            cycleId = lastCycle ? lastCycle.cycle_id + 1 : 1;
        }

        // Snapshot start prices
        const snapshot = this.priceEngine.getPriceSnapshot();
        const startPrices = {};
        const priceRecords = [];
        let zeroPrices = 0;
        for (const s of snapshot) {
            startPrices[s.tokenId] = s.price;
            priceRecords.push({ tokenId: s.tokenId, startPrice: s.price });
            if (s.price === 0) zeroPrices++;
        }
        if (zeroPrices > 0) {
            console.warn(`[CycleManager] Price snapshot: ${zeroPrices}/${snapshot.length} tokens have zero price at cycle start`);
        }
        console.log(`[CycleManager] Price snapshot for cycle #${cycleId}: ${snapshot.length - zeroPrices} tokens priced`);

        // Save to DB
        try {
            db.saveTokenCycle(cycleId, startTime, endTime);
            db.saveTokenPrices(cycleId, priceRecords);
            db.saveDatabase();
            console.log(`[CycleManager] DB: cycle #${cycleId} saved with ${priceRecords.length} price records`);
        } catch (err) {
            console.error(`[CycleManager] DB save error for cycle #${cycleId}: ${err.message}`);
        }

        this.currentCycle = { id: cycleId, startTime, endTime, startPrices };
        this.liveLeaderboard = [];

        console.log(`[CycleManager] Cycle #${cycleId} started (${new Date(startTime * 1000).toISOString()} → ${new Date(endTime * 1000).toISOString()})`);

        // Broadcast cycle start
        this.emit('cycle-started', this.getCurrentCycle());
        if (this.wsServer) {
            this.wsServer.broadcast('cycle', this.getCurrentCycle());
        }

        // Auto-enter AutoPlay users
        this._enterAutoPlayUsers(cycleId);

        // Schedule cycle end
        this._scheduleCycleEnd();
        this._startTick();
    }

    _scheduleCycleEnd() {
        if (this.cycleTimeout) clearTimeout(this.cycleTimeout);
        const msLeft = (this.currentCycle.endTime * 1000) - Date.now();
        console.log(`[CycleManager] Cycle #${this.currentCycle.id} end scheduled in ${(msLeft / 1000).toFixed(0)}s`);

        this.cycleTimeout = setTimeout(async () => {
            console.log(`[CycleManager] Cycle #${this.currentCycle.id} timer fired, beginning finalization...`);
            try {
                await this._finalizeCycle(this.currentCycle.id);
            } catch (err) {
                console.error(`[CycleManager] Finalization error for cycle #${this.currentCycle.id}: ${err.message}`, err.stack);
            }
            // Start next cycle after a brief pause
            setTimeout(() => {
                if (this._started) {
                    console.log('[CycleManager] Starting next cycle...');
                    this._startNewCycle();
                }
            }, 2000);
        }, Math.max(0, msLeft));
    }

    _startTick() {
        if (this.tickInterval) clearInterval(this.tickInterval);
        this.tickInterval = setInterval(() => {
            this._updateLiveScores().catch(err => {
                console.error(`[CycleManager] _updateLiveScores unhandled error: ${err.message}`);
            });
        }, TICK_INTERVAL);
    }

    // ─── Live Score Calculation ───

    async _updateLiveScores() {
        if (!this.currentCycle) return;

        // Sync with on-chain every 15 seconds: check cycle ID + participants
        const now = Date.now();
        if (now - this._lastParticipantSync > 15_000) {
            this._lastParticipantSync = now;
            try {
                const provider = new ethers.JsonRpcProvider(CHAIN.RPC_URL);
                const contract = new ethers.Contract(CONTRACTS.TokenLeagues, TOKEN_LEAGUES_ABI, provider);

                // Check if on-chain has moved past our current cycle
                const onChainId = Number(await contract.currentCycleId());
                if (onChainId > this.currentCycle.id) {
                    console.warn(`[CycleManager] ⚠️ DESYNC: backend cycle #${this.currentCycle.id} but on-chain is #${onChainId}. Catching up...`);

                    // Finalize our old cycle if needed
                    const nowSec = Math.floor(Date.now() / 1000);
                    if (nowSec >= this.currentCycle.endTime) {
                        try {
                            await this._finalizeCycle(this.currentCycle.id);
                        } catch (e) {
                            console.warn(`[CycleManager] Finalize old cycle #${this.currentCycle.id} failed: ${e.message}`);
                        }
                    }

                    // Adopt the on-chain current cycle
                    const onChainCycle = await contract.getCycle(onChainId);
                    if (onChainCycle.id > 0 && !onChainCycle.finalized) {
                        const startTime = Number(onChainCycle.startTime);
                        const endTime = Number(onChainCycle.endTime);

                        // Ensure DB has this cycle
                        if (!db.getTokenCycle(onChainId)) {
                            db.saveTokenCycle(onChainId, startTime, endTime);
                        }

                        // Snapshot current prices as start prices (best effort for mid-cycle adoption)
                        const snapshot = this.priceEngine.getPriceSnapshot();
                        const startPrices = {};
                        const existingPrices = db.getTokenPrices(onChainId);
                        if (existingPrices.length > 0) {
                            for (const p of existingPrices) startPrices[p.token_id] = p.start_price;
                        } else {
                            const priceRecords = [];
                            for (const s of snapshot) {
                                startPrices[s.tokenId] = s.price;
                                priceRecords.push({ tokenId: s.tokenId, startPrice: s.price });
                            }
                            db.saveTokenPrices(onChainId, priceRecords);
                        }

                        this.currentCycle = { id: onChainId, startTime, endTime, startPrices };
                        this.liveLeaderboard = [];
                        db.saveDatabase();

                        console.log(`[CycleManager] ✅ Adopted on-chain cycle #${onChainId} (ends in ${endTime - nowSec}s)`);

                        // Re-schedule end
                        this._scheduleCycleEnd();
                    }
                }

                // Sync participants for current cycle
                const participants = await contract.getParticipants(this.currentCycle.id);
                let synced = 0;
                for (const addr of participants) {
                    const existing = db.getTokenEntry(this.currentCycle.id, addr);
                    if (!existing) {
                        const tokens = await contract.getUserTokens(this.currentCycle.id, addr);
                        const tokenIds = tokens.map(Number).filter(t => t > 0);
                        if (tokenIds.length > 0) {
                            db.saveTokenEntry(this.currentCycle.id, addr.toLowerCase(), tokenIds);
                            synced++;
                        }
                    }
                }
                if (synced > 0) {
                    db.saveDatabase();
                    console.log(`[CycleManager] Live sync: pulled ${synced} on-chain entries into DB for cycle #${this.currentCycle.id}`);
                }
            } catch (err) {
                console.warn(`[CycleManager] Live sync failed: ${err.message}`);
            }
        }

        try {
            const entries = db.getTokenEntries(this.currentCycle.id);
            if (entries.length === 0) return;

            const currentPrices = this.priceEngine.getPrices();
            const scores = [];
            let missingPrices = 0;

            for (const entry of entries) {
                const tokenIds = entry.token_ids;
                let totalPct = 0;

                for (const tid of tokenIds) {
                    const startPrice = this.currentCycle.startPrices[tid] || 0;
                    const curPrice = currentPrices[tid]?.price || 0;
                    if (startPrice === 0 || curPrice === 0) missingPrices++;
                    const pct = startPrice > 0 ? ((curPrice - startPrice) / startPrice) * 100 : 0;
                    totalPct += pct;
                }

                // Score = average % change × leverage
                const score = (totalPct / tokenIds.length) * LEVERAGE;

                scores.push({
                    address: entry.player_address,
                    score: Math.round(score * 100) / 100,
                    tokens: tokenIds,
                });
            }

            // Sort by score descending
            scores.sort((a, b) => b.score - a.score);
            scores.forEach((s, i) => { s.rank = i + 1; });

            this.liveLeaderboard = scores;

            if (missingPrices > 0) {
                console.warn(`[CycleManager] Live scores: ${missingPrices} missing prices detected for cycle #${this.currentCycle.id}`);
            }

            // Broadcast to WS clients
            if (this.wsServer) {
                this.wsServer.broadcast('leaderboard', scores);
                this.wsServer.broadcast('cycle', this.getCurrentCycle());
            }
        } catch (err) {
            console.error(`[CycleManager] _updateLiveScores error: ${err.message}`, err.stack);
        }
    }

    // ─── Cycle Finalization ───

    async _finalizeCycle(cycleId) {
        console.log(`[CycleManager] Finalizing cycle #${cycleId}...`);

        if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null; }

        try {
            db.updateTokenCycleStatus(cycleId, 'finalizing');
        } catch (err) {
            console.error(`[CycleManager] DB error setting finalizing status for cycle #${cycleId}: ${err.message}`);
        }

        // Snapshot end prices
        const currentPrices = this.priceEngine.getPrices();
        const cycle = db.getTokenCycle(cycleId);
        const startPricesRows = db.getTokenPrices(cycleId);
        const startPricesMap = {};
        for (const row of startPricesRows) {
            startPricesMap[row.token_id] = row.start_price;
        }

        const endPriceUpdates = [];
        for (const t of TOKEN_LIST) {
            const startPrice = startPricesMap[t.id] || 0;
            const endPrice = currentPrices[t.id]?.price || 0;
            const pctChange = startPrice > 0 ? ((endPrice - startPrice) / startPrice) * 100 : 0;
            endPriceUpdates.push({ tokenId: t.id, endPrice, pctChange });
        }
        try {
            db.updateTokenEndPrices(cycleId, endPriceUpdates);
            console.log(`[CycleManager] End prices saved for cycle #${cycleId}: ${endPriceUpdates.filter(p => p.endPrice > 0).length} tokens priced`);
        } catch (err) {
            console.error(`[CycleManager] DB error saving end prices for cycle #${cycleId}: ${err.message}`);
        }

        // Sync on-chain participants into DB (in case server missed some entries)
        try {
            const provider = new ethers.JsonRpcProvider(CHAIN.RPC_URL);
            const contract = new ethers.Contract(CONTRACTS.TokenLeagues, [
                ...TOKEN_LEAGUES_ABI,
                'function getParticipants(uint256) view returns (address[])',
                'function getUserTokens(uint256, address) view returns (uint8[5])',
            ], provider);

            const participants = await contract.getParticipants(cycleId);
            let synced = 0;
            for (const addr of participants) {
                const existing = db.getTokenEntry(cycleId, addr);
                if (!existing) {
                    const tokens = await contract.getUserTokens(cycleId, addr);
                    const tokenIds = tokens.map(Number).filter(t => t > 0);
                    if (tokenIds.length > 0) {
                        db.saveTokenEntry(cycleId, addr.toLowerCase(), tokenIds);
                        synced++;
                    }
                }
            }
            if (synced > 0) {
                console.log(`[CycleManager] Synced ${synced} on-chain entries into DB for cycle #${cycleId}`);
            }
        } catch (err) {
            console.warn(`[CycleManager] On-chain participant sync failed for cycle #${cycleId}: ${err.message}`);
        }

        // Calculate final scores
        const entries = db.getTokenEntries(cycleId);
        console.log(`[CycleManager] Cycle #${cycleId}: ${entries.length} entries to score`);
        const results = [];

        for (const entry of entries) {
            let totalPct = 0;
            for (const tid of entry.token_ids) {
                const sp = startPricesMap[tid] || 0;
                const ep = currentPrices[tid]?.price || 0;
                const pct = sp > 0 ? ((ep - sp) / sp) * 100 : 0;
                totalPct += pct;
            }
            const score = (totalPct / entry.token_ids.length) * LEVERAGE;
            results.push({
                playerAddress: entry.player_address,
                score: Math.round(score * 100) / 100,
            });
        }

        // Rank
        results.sort((a, b) => b.score - a.score);
        results.forEach((r, i) => { r.rank = i + 1; });

        // Log score summary
        if (results.length > 0) {
            const topScore = results[0]?.score ?? 0;
            const bottomScore = results[results.length - 1]?.score ?? 0;
            console.log(`[CycleManager] Cycle #${cycleId} scores: ${results.length} players | top=${topScore} bottom=${bottomScore}`);
        }

        // Prize distribution: ALL players receive rewards, rank-weighted
        // Rank 1 (best score) gets N shares, Rank 2 gets N-1, ..., Rank N gets 1 share
        // Already sorted by score desc: positive first, then least-negative, then most-negative
        const winners = results; // everyone wins
        const n = winners.length;
        const totalShares = (n * (n + 1)) / 2; // sum of 1..N
        console.log(`[CycleManager] Cycle #${cycleId} prize calc: ${n} players, rank-weighted distribution (totalShares=${totalShares})`);

        // Get prize pool from contract or DB (with retries)
        let prizePool = '0';
        try {
            prizePool = await retryAsync(async () => {
                const provider = new ethers.JsonRpcProvider(CHAIN.RPC_URL);
                const contract = new ethers.Contract(CONTRACTS.TokenLeagues, TOKEN_LEAGUES_ABI, provider);
                const onChainCycle = await contract.getCycle(cycleId);
                return onChainCycle.prizePool.toString();
            }, 'Read prize pool', 3, 1000);
        } catch (err) {
            console.warn(`[CycleManager] Could not read on-chain prize pool for cycle #${cycleId}: ${err.message}. Using DB fallback.`);
            prizePool = cycle?.prize_pool || '0';
        }

        const prizePoolBN = BigInt(prizePool);
        const winnerAddresses = [];
        const winnerAmounts = [];

        for (const w of winners) {
            // Rank 1 → N shares, Rank 2 → N-1 shares, ..., Rank N → 1 share
            const playerShares = n - w.rank + 1;
            const share = (BigInt(playerShares) * prizePoolBN) / BigInt(totalShares);
            w.prizeAmount = share.toString();
            winnerAddresses.push(w.playerAddress);
            winnerAmounts.push(share);
        }

        // Save leaderboard to DB
        try {
            db.saveTokenLeaderboard(cycleId, results.map(r => ({
                playerAddress: r.playerAddress,
                score: r.score,
                rank: r.rank,
                prizeAmount: r.prizeAmount || '0',
            })));
            console.log(`[CycleManager] DB: leaderboard saved for cycle #${cycleId} (${results.length} entries)`);
        } catch (err) {
            console.error(`[CycleManager] DB error saving leaderboard for cycle #${cycleId}: ${err.message}`);
        }

        // Finalize on-chain with retries
        try {
            if (ADMIN_PRIVATE_KEY && CONTRACTS.TokenLeagues !== '0x0000000000000000000000000000000000000000') {
                await retryAsync(async () => {
                    const provider = new ethers.JsonRpcProvider(CHAIN.RPC_URL);
                    const wallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
                    const contract = new ethers.Contract(CONTRACTS.TokenLeagues, TOKEN_LEAGUES_ABI, wallet);

                    const tx = await contract.finalizeCycle(cycleId, winnerAddresses, winnerAmounts);
                    console.log(`[CycleManager] Finalize TX: ${tx.hash}`);
                    await tx.wait();
                    console.log(`[CycleManager] Cycle #${cycleId} finalized on-chain`);
                }, 'Finalize cycle on-chain');
            }
        } catch (err) {
            console.error(`[CycleManager] On-chain finalization failed after retries:`, err.message);
        }

        try {
            db.updateTokenCycleStatus(cycleId, 'finalized', prizePool);
            db.saveDatabase();
        } catch (err) {
            console.error(`[CycleManager] DB error finalizing cycle #${cycleId}: ${err.message}`);
        }

        console.log(`[CycleManager] Cycle #${cycleId} finalized — ${winners.length} winners, pool: ${ethers.formatEther(prizePoolBN)} ETH`);

        // Broadcast results
        this.emit('cycle-finalized', { cycleId, results, winners: winners.length });
        if (this.wsServer) {
            this.wsServer.broadcast('cycle-result', {
                cycleId,
                leaderboard: results,
                prizePool: ethers.formatEther(prizePoolBN),
            });
        }
    }

    // ─── On-Chain Interactions ───

    async _createCycleOnChain(startTime, endTime) {
        if (!ADMIN_PRIVATE_KEY || CONTRACTS.TokenLeagues === '0x0000000000000000000000000000000000000000') {
            throw new Error('Contract not deployed or admin key missing');
        }
        const provider = new ethers.JsonRpcProvider(CHAIN.RPC_URL);
        const wallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
        const contract = new ethers.Contract(CONTRACTS.TokenLeagues, TOKEN_LEAGUES_ABI, wallet);

        const tx = await contract.startNewCycle(startTime, endTime);
        const receipt = await tx.wait();
        const cycleId = Number(await contract.currentCycleId());
        console.log(`[CycleManager] On-chain cycle #${cycleId} created (tx: ${receipt.hash})`);
        return cycleId;
    }

    async _enterAutoPlayUsers(cycleId) {
        const autoPlayers = db.getAllAutoPlayUsers();
        if (autoPlayers.length === 0) return;

        console.log(`[CycleManager] Auto-entering ${autoPlayers.length} users into cycle #${cycleId}`);

        if (!ADMIN_PRIVATE_KEY || CONTRACTS.TokenLeagues === '0x0000000000000000000000000000000000000000') {
            console.warn('[CycleManager] Cannot auto-enter: contract not deployed');
            return;
        }

        try {
            // Get provider+contract with retry (handles DNS/RPC failures)
            const { contract, entryFee } = await retryAsync(async () => {
                const provider = new ethers.JsonRpcProvider(CHAIN.RPC_URL);
                const wallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
                const c = new ethers.Contract(CONTRACTS.TokenLeagues, TOKEN_LEAGUES_ABI, wallet);
                const fee = await c.entryFee();
                return { contract: c, entryFee: fee };
            }, 'AutoPlay connect', 3, 2000);

            for (const player of autoPlayers) {
                try {
                    const already = await contract.hasEntered(cycleId, player.player_address);
                    if (already) continue;

                    const tokenIds = player.token_ids.map(Number);
                    const tx = await contract.enterCycleFor(player.player_address, tokenIds, { value: entryFee });
                    await tx.wait();

                    db.saveTokenEntry(cycleId, player.player_address, tokenIds);
                    console.log(`[CycleManager] Auto-entered ${player.player_address.substring(0, 10)}...`);
                } catch (err) {
                    console.error(`[CycleManager] Auto-enter failed for ${player.player_address.substring(0, 10)}:`, err.message);
                }
            }
        } catch (err) {
            console.error('[CycleManager] AutoPlay batch failed after retries:', err.message);
        }
    }
}

// Singleton
export const cycleManager = new CycleManager();
