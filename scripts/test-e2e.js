/**
 * End-to-End Tournament Test
 *
 * Creates a short tournament, enters with real NFTs,
 * triggers scoring, waits for end, triggers finalization, checks leaderboard.
 *
 * Usage: cd scripts && node test-e2e.js
 *
 * Requires:
 *   - scripts/.env with PRIVATE_KEY
 *   - Server running on port 3005
 */

import { ethers } from 'ethers';
import 'dotenv/config';

const RPC_URL = 'https://testnet.riselabs.xyz';
const API_URL = 'http://localhost:3005/api';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
    console.error('Set PRIVATE_KEY in scripts/.env');
    process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// Contract addresses
const PACK_OPENER = '0x8A35cbe95CD07321CE4f0C73dC2518AAc5b28554';
const TOURNAMENT_MANAGER = '0xfF528538033a55C7b9C23608eB3d15e2387E0d61';
const NFT_CONTRACT = '0xD3C4633257733dA9597b193cDaAA06bCBCbA0BF0';

// ABIs
const tmABI = [
    'function createTournament(uint256 registrationStart, uint256 startTime, uint256 endTime) returns (uint256)',
    'function getTournament(uint256 id) view returns (tuple(uint256 id, uint256 registrationStart, uint256 startTime, uint256 endTime, uint256 prizePool, uint256 entryCount, uint8 status))',
    'function enterTournament(uint256 tournamentId, uint256[5] cardIds)',
    'function hasEntered(uint256 tournamentId, address user) view returns (bool)',
    'function finalizeWithPoints(uint256 tournamentId, uint256[19] points)',
    'function finalizeTournament(uint256 tournamentId, address[] winners, uint256[] amounts)',
    'function claimPrize(uint256 tournamentId)',
    'function getUserScoreInfo(uint256 tournamentId, address user) view returns (uint256 score, uint256 prize, uint256 totalScore)',
    'function getUserLineup(uint256 tournamentId, address user) view returns (tuple(uint256[5] cardIds, address owner, uint256 timestamp, bool cancelled, bool claimed))',
    'function nextTournamentId() view returns (uint256)',
    'function getTournamentParticipants(uint256 tournamentId) view returns (address[])',
    'function cancelTournament(uint256 tournamentId)',
    'function getTournamentPhase(uint256 tournamentId) view returns (string)',
];

const poABI = [
    'function setActiveTournament(uint256 tournamentId)',
    'function activeTournamentId() view returns (uint256)',
    'function buyAndOpenPack(address referrer) payable returns (uint256)',
];

const nftABI = [
    'function getOwnedTokens(address owner) view returns (uint256[])',
    'function getCardInfo(uint256 tokenId) view returns (tuple(uint256 startupId, uint256 edition, uint8 rarity, uint256 multiplier, bool isLocked, string name))',
    'function isLocked(uint256 tokenId) view returns (bool)',
];

const tm = new ethers.Contract(TOURNAMENT_MANAGER, tmABI, wallet);
const po = new ethers.Contract(PACK_OPENER, poABI, wallet);
const nft = new ethers.Contract(NFT_CONTRACT, nftABI, provider);

// Startup name -> contract startupId (1-indexed)
const STARTUP_IDS = {
    'Openclaw': 1, 'Lovable': 2, 'Cursor': 3, 'OpenAI': 4,
    'Anthropic': 5, 'Browser Use': 6, 'Dedalus Labs': 7, 'Autumn': 8,
    'Axiom': 9, 'Multifactor': 10, 'Dome': 11, 'GrazeMate': 12,
    'Tornyol Systems': 13, 'Pocket': 14, 'Caretta': 15,
    'AxionOrbital Space': 16, 'Freeport Markets': 17, 'Ruvo': 18, 'Lightberry': 19,
};

const STATUS_MAP = { 0: 'Created', 1: 'Active', 2: 'Finalized', 3: 'Cancelled' };

// ===== Helpers =====

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function countdown(seconds, label) {
    for (let i = seconds; i > 0; i -= 10) {
        process.stdout.write(`    ${label}: ${i}s remaining...      \r`);
        await sleep(Math.min(10000, i * 1000));
    }
    process.stdout.write('                                         \r');
}

async function apiGet(path) {
    const res = await fetch(`${API_URL}${path}`);
    return res.json();
}

async function apiPost(path, body = {}) {
    const res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return res.json();
}

async function waitForScorerDone(tournamentId, address, maxWait = 180) {
    const start = Date.now();
    let lastCheck = 0;
    while ((Date.now() - start) / 1000 < maxWait) {
        const elapsed = Math.floor((Date.now() - start) / 1000);
        if (elapsed - lastCheck >= 15) {
            lastCheck = elapsed;
            // Check if player has any score history for this tournament
            const history = await apiGet(`/player/${address}/history/${tournamentId}`);
            if (history.data?.length > 0) {
                console.log(`    Scorer finished! (${elapsed}s)`);
                return true;
            }
            process.stdout.write(`    Waiting for scorer... ${elapsed}s / ${maxWait}s\r`);
        }
        await sleep(3000);
    }
    process.stdout.write('                                              \r');
    return false;
}

// ===== Test Steps =====

async function run() {
    console.log('========================================');
    console.log('  FantasyYC End-to-End Tournament Test');
    console.log('========================================\n');
    console.log(`Wallet: ${wallet.address}`);
    const balance = await provider.getBalance(wallet.address);
    console.log(`Balance: ${ethers.formatEther(balance)} ETH\n`);

    let previousActiveTournament = 0;
    let testTournamentId = 0;
    let testPassed = { create: false, enter: false, score: false, finalize: false, leaderboard: false };

    try {
        // ===== STEP 1: Save current active tournament =====
        console.log('[1] Checking current active tournament...');
        previousActiveTournament = Number(await po.activeTournamentId());
        console.log(`    Current active: #${previousActiveTournament}`);

        // ===== STEP 2: Get owned unlocked NFTs =====
        console.log('\n[2] Checking owned NFTs...');
        const allTokens = await nft.getOwnedTokens(wallet.address);
        console.log(`    Total owned: ${allTokens.length}`);

        const unlocked = [];
        for (const tokenId of allTokens) {
            const locked = await nft.isLocked(Number(tokenId));
            if (!locked) {
                const info = await nft.getCardInfo(tokenId);
                unlocked.push({
                    tokenId: Number(tokenId),
                    startupId: Number(info.startupId),
                    name: info.name,
                    rarity: ['Common', 'Rare', 'Epic', 'EpicRare', 'Legendary'][info.rarity] || 'Unknown',
                    multiplier: Number(info.multiplier),
                });
            }
            if (unlocked.length >= 5) break;
        }
        console.log(`    Unlocked: ${unlocked.length}`);

        if (unlocked.length < 5) {
            console.log('\n    Not enough unlocked cards. Buying a pack...');
            const packPrice = ethers.parseEther('0.5');
            const buyTx = await po.buyAndOpenPack(ethers.ZeroAddress, { value: packPrice });
            await buyTx.wait();
            console.log('    Pack bought!');

            const newTokens = await nft.getOwnedTokens(wallet.address);
            unlocked.length = 0;
            for (const tokenId of newTokens) {
                const locked = await nft.isLocked(Number(tokenId));
                if (!locked) {
                    const info = await nft.getCardInfo(tokenId);
                    unlocked.push({
                        tokenId: Number(tokenId),
                        startupId: Number(info.startupId),
                        name: info.name,
                        rarity: ['Common', 'Rare', 'Epic', 'EpicRare', 'Legendary'][info.rarity] || 'Unknown',
                        multiplier: Number(info.multiplier),
                    });
                }
                if (unlocked.length >= 5) break;
            }
        }

        if (unlocked.length < 5) {
            console.error('    FAIL: Still <5 unlocked cards.');
            process.exit(1);
        }

        const lineup = unlocked.slice(0, 5);
        console.log('    Lineup:');
        lineup.forEach((c, i) => console.log(`      ${i + 1}. #${c.tokenId} ${c.name} (ID:${c.startupId}, ${c.rarity}, ${c.multiplier}x)`));

        // ===== STEP 3: Create short tournament =====
        // Tournament: registration already open, starts in 30s, ends in 5 min
        console.log('\n[3] Creating test tournament...');
        const now = Math.floor(Date.now() / 1000);
        const regStart = now - 120;     // registration opened 2 min ago
        const startTime = now + 30;     // starts in 30 seconds
        const endTime = now + 330;      // ends in 5.5 min (5 min active)

        console.log(`    Start in: 30s | Active for: 5 min | Total: 5.5 min`);

        const createTx = await tm.createTournament(regStart, startTime, endTime);
        const createReceipt = await createTx.wait();
        const nextId = Number(await tm.nextTournamentId());
        testTournamentId = nextId - 1;
        console.log(`    Created tournament #${testTournamentId} ✅`);
        testPassed.create = true;

        // ===== STEP 4: Set as active =====
        console.log('\n[4] Setting as active tournament...');
        await (await po.setActiveTournament(testTournamentId)).wait();
        console.log(`    Active: #${Number(await po.activeTournamentId())} ✅`);

        // ===== STEP 5: Enter tournament =====
        console.log('\n[5] Entering tournament...');
        const cardIds = lineup.map(c => c.tokenId);
        await (await tm.enterTournament(testTournamentId, cardIds)).wait();
        const entered = await tm.hasEntered(testTournamentId, wallet.address);
        console.log(`    hasEntered: ${entered} ${entered ? '✅' : '❌'}`);
        testPassed.enter = entered;

        // Verify cards are locked
        const firstCardLocked = await nft.isLocked(cardIds[0]);
        console.log(`    Cards locked: ${firstCardLocked} ${firstCardLocked ? '✅' : '❌'}`);

        // ===== STEP 6: Wait for tournament to start =====
        const waitStart = Math.max(0, startTime - Math.floor(Date.now() / 1000) + 3);
        console.log(`\n[6] Waiting ${waitStart}s for tournament to start...`);
        await countdown(waitStart, 'Start');

        // Verify phase
        const phase = await tm.getTournamentPhase(testTournamentId);
        console.log(`    Phase: ${phase} ${phase === 'Active' ? '✅' : '⚠️'}`);

        // Wait for server to sync
        console.log('    Waiting for server sync (20s)...');
        await sleep(20000);
        const serverTournament = await apiGet('/tournaments/active');
        console.log(`    Server active tournament: #${serverTournament.data?.id || 'none'} (status: ${serverTournament.data?.status || '?'})`);

        // ===== STEP 7: Trigger scorer =====
        console.log('\n[7] Triggering daily scorer...');
        const today = new Date().toISOString().split('T')[0];
        const scorerResult = await apiPost('/run-scorer', { date: today });
        console.log(`    Scorer triggered for ${today}: ${scorerResult.success ? '✅' : '❌'}`);

        // Wait for scorer to complete (polls every 15s, max 3 min)
        console.log('    Waiting for scorer to finish (may take up to 3 min for 19 startups)...');
        const scorerDone = await waitForScorerDone(
            testTournamentId,
            wallet.address.toLowerCase(),
            180
        );

        // ===== STEP 8: Check leaderboard =====
        console.log('\n[8] Checking leaderboard & scores...');
        const leaderboard = await apiGet(`/leaderboard/${testTournamentId}`);
        if (leaderboard.success && leaderboard.data?.length > 0) {
            console.log('    ✅ Leaderboard:');
            leaderboard.data.forEach((entry, i) => {
                console.log(`      ${i + 1}. ${entry.address?.substring(0, 12)}... - ${entry.score} pts`);
            });
            testPassed.leaderboard = true;
        } else {
            console.log('    ⚠️  Leaderboard empty');
        }

        // Player rank
        const rankData = await apiGet(`/player/${wallet.address.toLowerCase()}/rank/${testTournamentId}`);
        if (rankData.data?.rank) {
            console.log(`    Rank: #${rankData.data.rank}, Score: ${rankData.data.score}`);
        }

        // Score history
        const history = await apiGet(`/player/${wallet.address.toLowerCase()}/history/${testTournamentId}`);
        if (history.data?.length > 0) {
            testPassed.score = true;
            console.log('    Score history:');
            history.data.forEach(h => console.log(`      ${h.date}: ${h.points} pts`));
        } else {
            console.log('    ⚠️  No score history');
        }

        // Card scores
        const cardScores = await apiGet(`/player/${wallet.address.toLowerCase()}/card-scores/${testTournamentId}`);
        const csData = cardScores.data || {};
        if (Object.keys(csData).length > 0) {
            console.log('    Per-startup scores:');
            for (const [name, data] of Object.entries(csData)) {
                console.log(`      ${name}: total=${data.totalPoints}, today=${data.todayPoints}`);
            }
        }

        // ===== STEP 9: Wait for tournament to end =====
        const now2 = Math.floor(Date.now() / 1000);
        const waitEnd = Math.max(0, endTime - now2 + 5);
        console.log(`\n[9] Waiting ${waitEnd}s for tournament to end...`);
        await countdown(waitEnd, 'End');

        const phase2 = await tm.getTournamentPhase(testTournamentId);
        console.log(`    Phase: ${phase2} ${phase2 === 'Ended' ? '✅' : '⚠️'}`);

        // ===== STEP 10: Finalize tournament =====
        console.log('\n[10] Finalizing tournament...');

        // Build points array from DB scores
        const topStartups = await apiGet(`/top-startups/${testTournamentId}?limit=19`);
        const points = new Array(19).fill(0);

        if (topStartups.success && topStartups.data?.length > 0) {
            console.log('    Using real scores from DB:');
            for (const s of topStartups.data) {
                const id = STARTUP_IDS[s.name];
                if (id) {
                    points[id - 1] = Math.floor(s.points);
                    console.log(`      ${s.name} (ID:${id}): ${points[id - 1]} pts`);
                }
            }
        }

        // If scorer produced no data, use dummy scores
        if (points.every(p => p === 0)) {
            console.log('    No real scores, using dummy points for test...');
            // Assign points to startups our cards belong to (so we get a score)
            for (const card of lineup) {
                if (card.startupId > 0 && card.startupId <= 19) {
                    points[card.startupId - 1] = 100 + Math.floor(Math.random() * 400);
                }
            }
            // Also assign some other startups
            points[3] = 500;  // OpenAI
            points[2] = 300;  // Cursor
        }

        console.log(`    Points: [${points.map((p, i) => p > 0 ? `ID${i + 1}:${p}` : '').filter(Boolean).join(', ')}]`);

        // Calculate scores off-chain (same math as finalizeWithPoints contract)
        console.log('    Calculating scores off-chain...');
        const lineupData = await tm.getUserLineup(testTournamentId, wallet.address);
        let userScore = 0n;
        for (const tokenId of lineupData.cardIds) {
            if (Number(tokenId) === 0) continue;
            const info = await nft.getCardInfo(tokenId);
            const sId = Number(info.startupId);
            const mult = Number(info.multiplier);
            const pts = points[sId - 1] || 0;
            userScore += BigInt(pts) * BigInt(mult);
            console.log(`      Token #${tokenId}: startup=${sId}, mult=${mult}x, pts=${pts}, card_score=${pts * mult}`);
        }
        console.log(`    Total user score: ${userScore}`);

        // Build winners/amounts arrays
        const winners = userScore > 0n ? [wallet.address] : [];
        const prizePool = (await tm.getTournament(testTournamentId)).prizePool;
        const amounts = userScore > 0n ? [prizePool] : []; // Single player gets entire pool

        // Finalize using finalizeTournament (off-chain scoring)
        try {
            console.log(`    Sending finalizeTournament tx (${winners.length} winners)...`);
            const tx = await tm.finalizeTournament(testTournamentId, winners, amounts);
            const receipt = await tx.wait();
            console.log(`    ✅ Finalized! Block: ${receipt.blockNumber}, Gas: ${receipt.gasUsed}`);
            testPassed.finalize = true;
        } catch (e) {
            console.error(`    ❌ Direct finalization failed: ${e.reason || e.message}`);

            // Try via server API as fallback
            console.log('    Trying via server API...');
            const apiResult = await apiPost('/finalize');
            console.log(`    API result: ${JSON.stringify(apiResult)}`);
            if (apiResult.finalized) testPassed.finalize = true;
        }

        // ===== STEP 11: Verify final state =====
        console.log('\n[11] Verifying final state...');
        const t3 = await tm.getTournament(testTournamentId);
        const finalStatus = Number(t3.status);
        console.log(`    Status: ${STATUS_MAP[finalStatus]} ${finalStatus === 2 ? '✅' : '⚠️'}`);
        console.log(`    Prize pool: ${ethers.formatEther(t3.prizePool)} ETH`);
        console.log(`    Entry count: ${Number(t3.entryCount)}`);

        try {
            const scoreInfo = await tm.getUserScoreInfo(testTournamentId, wallet.address);
            console.log(`    User score: ${scoreInfo.score}`);
            console.log(`    User prize: ${ethers.formatEther(scoreInfo.prize)} ETH`);
            console.log(`    Total score: ${scoreInfo.totalScore}`);
        } catch (e) {
            console.log(`    Score info: ${e.reason || e.message}`);
        }

        // Check NFTs are unlocked after finalization
        const cardUnlocked = await nft.isLocked(cardIds[0]);
        console.log(`    Cards unlocked: ${!cardUnlocked} ${!cardUnlocked ? '✅' : '❌'}`);

        // ===== STEP 12: Claim prize =====
        if (finalStatus === 2) {
            console.log('\n[12] Claiming prize...');
            try {
                const claimTx = await tm.claimPrize(testTournamentId);
                const claimReceipt = await claimTx.wait();
                console.log(`    ✅ Prize claimed! Gas: ${claimReceipt.gasUsed}`);
            } catch (e) {
                console.log(`    Claim: ${e.reason || e.message}`);
            }
        }

    } catch (err) {
        console.error(`\n❌ Error: ${err.reason || err.message}`);
        if (err.data) console.error('   Data:', err.data);
    } finally {
        // ===== STEP 13: Restore previous active tournament =====
        console.log('\n[13] Cleanup...');
        try {
            if (previousActiveTournament > 0 && previousActiveTournament !== testTournamentId) {
                const prevT = await tm.getTournament(previousActiveTournament);
                const prevStatus = Number(prevT.status);
                if (prevStatus !== 2 && prevStatus !== 3) {
                    await (await po.setActiveTournament(previousActiveTournament)).wait();
                    console.log(`    Restored tournament #${previousActiveTournament} as active ✅`);
                } else {
                    console.log(`    Previous #${previousActiveTournament} is ${STATUS_MAP[prevStatus]}`);
                }
            } else {
                console.log('    Test tournament remains active (no previous to restore)');
            }
        } catch (e) {
            console.error(`    Restore failed: ${e.reason || e.message}`);
        }

        // Print summary
        const finalActive = Number(await po.activeTournamentId());
        const balAfter = await provider.getBalance(wallet.address);

        console.log('\n========================================');
        console.log('            TEST RESULTS');
        console.log('========================================');
        console.log(`  Tournament #${testTournamentId}`);
        console.log(`  Create:      ${testPassed.create ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`  Enter:       ${testPassed.enter ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`  Score:       ${testPassed.score ? '✅ PASS' : '⚠️  No data (may need tweets)'}`);
        console.log(`  Finalize:    ${testPassed.finalize ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`  Leaderboard: ${testPassed.leaderboard ? '✅ PASS' : '⚠️  Empty'}`);
        console.log(`  Active now:  #${finalActive}`);
        console.log(`  Balance:     ${ethers.formatEther(balAfter)} ETH`);
        console.log('========================================\n');
    }
}

run().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
