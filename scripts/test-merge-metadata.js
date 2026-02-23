// scripts/test-merge-metadata.js
// End-to-end merge test: merge 3 cards, check on-chain vs metadata server
// Usage: node scripts/test-merge-metadata.js [network] [count]
// Example: node scripts/test-merge-metadata.js rise 5

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const NETWORKS = {
    rise: {
        rpc: "https://testnet.riselabs.xyz",
        metadataUrl: "https://app.attnx.fun/metadata-rise",
    },
};

const RARITY_NAMES = ["Common", "Rare", "Epic", "EpicRare", "Legendary"];
const MERGE_TARGET = { 0: 1, 1: 2, 2: 4 }; // Common→Rare, Rare→Epic, Epic→Legendary

const NFT_ABI = [
    "function getOwnedTokens(address owner) view returns (uint256[])",
    "function getCardInfo(uint256 tokenId) view returns (tuple(uint256 startupId, uint256 edition, uint8 rarity, uint256 multiplier, bool isLocked, string name))",
    "function mergeCards(uint256[3] tokenIds) returns (uint256)",
    "function totalSupply() view returns (uint256)",
    "event CardsMerged(address indexed owner, uint256[3] burnedTokenIds, uint256 indexed newTokenId, uint8 fromRarity, uint8 toRarity)",
];

async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function fetchMetadata(baseUrl, tokenId, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(`${baseUrl}/${tokenId}`);
            if (!res.ok) {
                if (i < retries - 1) { await sleep(2000); continue; }
                return { error: `HTTP ${res.status}` };
            }
            return await res.json();
        } catch (e) {
            if (i < retries - 1) { await sleep(2000); continue; }
            return { error: e.message };
        }
    }
}

function getAttribute(metadata, traitType) {
    const attr = (metadata.attributes || []).find((a) => a.trait_type === traitType);
    return attr?.value;
}

async function main() {
    const networkArg = process.argv[2] || "rise";
    const mergeCount = parseInt(process.argv[3]) || 5;
    const network = NETWORKS[networkArg];
    if (!network) {
        console.error(`Unknown network: ${networkArg}`);
        process.exit(1);
    }

    const deploymentFile = path.join(__dirname, "..", `deployment-${networkArg}.json`);
    const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
    const nftAddress = deployment.proxies.UnicornX_NFT;

    const provider = new ethers.JsonRpcProvider(network.rpc);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const contract = new ethers.Contract(nftAddress, NFT_ABI, wallet);
    const readContract = new ethers.Contract(nftAddress, NFT_ABI, provider);

    console.log(`\n${"═".repeat(70)}`);
    console.log(`  Merge + Metadata Verification Test`);
    console.log(`  Network: ${networkArg} | Contract: ${nftAddress}`);
    console.log(`  Wallet: ${wallet.address}`);
    console.log(`  Metadata: ${network.metadataUrl}`);
    console.log(`  Merges planned: ${mergeCount}`);
    console.log(`${"═".repeat(70)}\n`);

    // Get owned tokens and group by rarity
    const ownedTokens = (await readContract.getOwnedTokens(wallet.address)).map(Number);
    console.log(`  Owned tokens: ${ownedTokens.length}\n`);

    // Fetch all card info
    const cardInfos = await Promise.all(
        ownedTokens.map(async (id) => {
            const info = await readContract.getCardInfo(id);
            return {
                tokenId: id,
                startupId: Number(info.startupId),
                rarity: Number(info.rarity),
                multiplier: Number(info.multiplier),
                isLocked: info.isLocked,
                name: info.name,
            };
        })
    );

    // Group by rarity (exclude locked and Legendary)
    const byRarity = {};
    for (const card of cardInfos) {
        if (card.isLocked || card.rarity === 4) continue; // skip locked & Legendary
        if (!byRarity[card.rarity]) byRarity[card.rarity] = [];
        byRarity[card.rarity].push(card);
    }

    console.log("  Available for merge:");
    for (const [rarity, cards] of Object.entries(byRarity)) {
        const groups = Math.floor(cards.length / 3);
        console.log(`    ${RARITY_NAMES[rarity]}: ${cards.length} cards (${groups} possible merges)`);
    }
    console.log("");

    // Calculate total possible merges
    let totalPossible = 0;
    for (const cards of Object.values(byRarity)) {
        totalPossible += Math.floor(cards.length / 3);
    }

    if (totalPossible === 0) {
        console.log("  ❌ No merges possible — need at least 3 cards of the same rarity.\n");
        return;
    }

    const actualMerges = Math.min(mergeCount, totalPossible);
    if (actualMerges < mergeCount) {
        console.log(`  ⚠️  Only ${actualMerges} merges possible (requested ${mergeCount})\n`);
    }

    // Execute merges
    let passed = 0;
    let failed = 0;
    const results = [];

    for (let i = 0; i < actualMerges; i++) {
        console.log(`─── Merge ${i + 1}/${actualMerges} ───`);

        // Find 3 cards of same rarity (prefer Common first to minimize value loss)
        let selectedCards = null;
        for (const rarity of [0, 1, 2]) {
            if (byRarity[rarity] && byRarity[rarity].length >= 3) {
                selectedCards = byRarity[rarity].splice(0, 3);
                break;
            }
        }

        if (!selectedCards) {
            console.log("  ⚠️  No more mergeable groups — stopping\n");
            break;
        }

        const fromRarity = RARITY_NAMES[selectedCards[0].rarity];
        const expectedRarity = MERGE_TARGET[selectedCards[0].rarity];
        const toRarity = RARITY_NAMES[expectedRarity];
        const tokenIds = selectedCards.map((c) => c.tokenId);

        console.log(`  Merging: ${tokenIds.map((id, j) => `#${id} (${selectedCards[j].name})`).join(", ")}`);
        console.log(`  ${fromRarity} → ${toRarity}`);

        try {
            // Execute merge
            const tx = await contract.mergeCards(tokenIds);
            console.log(`  TX: ${tx.hash}`);
            const receipt = await tx.wait();

            // Parse event
            let newTokenId = null;
            for (const log of receipt.logs) {
                try {
                    const parsed = contract.interface.parseLog(log);
                    if (parsed?.name === "CardsMerged") {
                        newTokenId = Number(parsed.args.newTokenId);
                        break;
                    }
                } catch {}
            }

            if (!newTokenId) {
                console.log("  ❌ Could not parse CardsMerged event\n");
                failed++;
                continue;
            }

            console.log(`  New token: #${newTokenId}`);

            // Check on-chain
            const chainInfo = await readContract.getCardInfo(newTokenId);
            const chainRarity = Number(chainInfo.rarity);
            const chainStartupId = Number(chainInfo.startupId);
            const chainMultiplier = Number(chainInfo.multiplier);
            const chainName = chainInfo.name;

            console.log(`  On-chain:  ${chainName} (startup ${chainStartupId}), ${RARITY_NAMES[chainRarity]}, ${chainMultiplier}x`);

            // Check metadata server (with retries — server may need time to see the new token)
            await sleep(3000); // wait for RPC propagation
            const metadata = await fetchMetadata(network.metadataUrl, newTokenId);

            if (metadata.error) {
                console.log(`  Metadata:  ❌ ERROR: ${metadata.error}`);
                failed++;
                results.push({ tokenId: newTokenId, chain: "OK", metadata: "ERROR" });
            } else {
                const metaStartup = getAttribute(metadata, "Startup");
                const metaStartupId = parseInt(getAttribute(metadata, "Startup ID"));
                const metaRarity = getAttribute(metadata, "Rarity");
                const metaMultiplier = getAttribute(metadata, "Multiplier");

                console.log(`  Metadata:  ${metaStartup} (startup ${metaStartupId}), ${metaRarity}, ${metaMultiplier}`);

                // Compare
                const nameMatch = metaStartup === chainName;
                const idMatch = metaStartupId === chainStartupId;
                const rarityMatch = metaRarity === RARITY_NAMES[chainRarity];
                const multiplierMatch = parseInt(metaMultiplier) === chainMultiplier;
                const allMatch = nameMatch && idMatch && rarityMatch && multiplierMatch;

                if (allMatch) {
                    console.log(`  Result:    ✅ MATCH`);
                    passed++;
                } else {
                    console.log(`  Result:    ❌ MISMATCH`);
                    if (!nameMatch) console.log(`    Name:       chain="${chainName}" vs meta="${metaStartup}"`);
                    if (!idMatch) console.log(`    StartupID:  chain=${chainStartupId} vs meta=${metaStartupId}`);
                    if (!rarityMatch) console.log(`    Rarity:     chain="${RARITY_NAMES[chainRarity]}" vs meta="${metaRarity}"`);
                    if (!multiplierMatch) console.log(`    Multiplier: chain=${chainMultiplier}x vs meta="${metaMultiplier}"`);
                    failed++;
                }

                results.push({
                    tokenId: newTokenId,
                    chain: `${chainName} ${RARITY_NAMES[chainRarity]} ${chainMultiplier}x`,
                    metadata: `${metaStartup} ${metaRarity} ${metaMultiplier}`,
                    match: allMatch,
                });
            }
        } catch (e) {
            const reason = e.reason || e.message || "Unknown error";
            console.log(`  ❌ TX failed: ${reason}`);
            failed++;
        }

        console.log("");
    }

    // Summary
    console.log(`${"═".repeat(70)}`);
    console.log(`  RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} merges`);
    console.log(`${"═".repeat(70)}`);

    if (results.length > 0) {
        console.log("\n  Token | On-Chain                    | Metadata Server             | Match");
        console.log("  ------|-----------------------------|-----------------------------|------");
        for (const r of results) {
            console.log(
                `  ${String(r.tokenId).padStart(5)} | ${(r.chain || "?").padEnd(27)} | ${(r.metadata || "?").padEnd(27)} | ${r.match ? "✅" : "❌"}`
            );
        }
    }

    console.log("");
}

main().catch((e) => {
    console.error("Fatal:", e.message);
    process.exit(1);
});
