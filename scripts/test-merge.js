// scripts/test-merge.js — Test merge: 3 Common → should produce 1 Rare
const { ethers } = require("ethers");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const NFT_ADDRESS = "0x172aC7aa7a6774559b1588E2F4426F7303a97cf1";
const PACK_ADDRESS = "0x78b602DE1721FF85C0c07F2Db5CF253c73590BaF";
const RPC = "https://testnet.riselabs.xyz";

const NFT_ABI = [
    "function getOwnedTokens(address owner) view returns (uint256[])",
    "function getCardInfo(uint256 tokenId) view returns (tuple(uint256 startupId, uint256 edition, uint8 rarity, uint256 multiplier, bool isLocked, string name))",
    "function mergeCards(uint256[3] tokenIds) returns (uint256)",
    "function totalSupply() view returns (uint256)",
];

const PACK_ABI = [
    "function buyAndOpenPack(address referrer) payable returns (uint256[5], uint256[5])",
    "function currentPackPrice() view returns (uint256)",
];

const RARITY_NAMES = ["Common", "Rare", "Epic", "EpicRare", "Legendary"];

async function main() {
    const provider = new ethers.JsonRpcProvider(RPC);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const nft = new ethers.Contract(NFT_ADDRESS, NFT_ABI, wallet);
    const pack = new ethers.Contract(PACK_ADDRESS, PACK_ABI, wallet);

    console.log("Wallet:", wallet.address);
    console.log("");

    // Step 1: List current cards
    console.log("=== STEP 1: Current Cards ===");
    let tokens = await nft.getOwnedTokens(wallet.address);
    console.log("Total owned:", tokens.length);

    const commons = [];
    for (const tokenId of tokens) {
        const info = await nft.getCardInfo(tokenId);
        const rarity = Number(info.rarity);
        const label = `Token #${tokenId} | ${info.name} | ${RARITY_NAMES[rarity]} | ${info.multiplier}x | sid=${info.startupId}`;
        console.log(label);
        if (rarity === 0 && info.isLocked === false) {
            commons.push(Number(tokenId));
        }
    }
    console.log("\nAvailable Common cards:", commons.length, "- IDs:", commons.join(", "));

    // Step 2: Buy packs if we need more commons
    if (commons.length < 3) {
        console.log("\n=== STEP 2: Need more commons, buying a pack ===");
        const price = await pack.currentPackPrice();
        console.log("Pack price:", ethers.formatEther(price), "ETH");

        const tx = await pack.buyAndOpenPack(ethers.ZeroAddress, {
            value: price,
            gasLimit: 10000000n,
        });
        console.log("TX:", tx.hash);
        const receipt = await tx.wait();
        console.log("Confirmed! Checking new cards...");

        // Re-scan
        tokens = await nft.getOwnedTokens(wallet.address);
        commons.length = 0;
        for (const tokenId of tokens) {
            const info = await nft.getCardInfo(tokenId);
            const rarity = Number(info.rarity);
            if (rarity === 0 && info.isLocked === false) {
                commons.push(Number(tokenId));
            }
        }
        console.log("Available Common cards now:", commons.length, "- IDs:", commons.join(", "));
    }

    if (commons.length < 3) {
        console.log("\nStill not enough commons. Buying another pack...");
        const price = await pack.currentPackPrice();
        const tx = await pack.buyAndOpenPack(ethers.ZeroAddress, {
            value: price,
            gasLimit: 10000000n,
        });
        await tx.wait();

        tokens = await nft.getOwnedTokens(wallet.address);
        commons.length = 0;
        for (const tokenId of tokens) {
            const info = await nft.getCardInfo(tokenId);
            if (Number(info.rarity) === 0 && info.isLocked === false) {
                commons.push(Number(tokenId));
            }
        }
        console.log("Available Common cards now:", commons.length);
    }

    if (commons.length < 3) {
        console.log("ERROR: Still not enough common cards to merge. Exiting.");
        return;
    }

    // Step 3: Merge 3 commons
    const mergeIds = commons.slice(0, 3);
    console.log("\n=== STEP 3: Merging 3 Common Cards ===");
    console.log("Merging token IDs:", mergeIds);

    // Show what we're merging
    for (const id of mergeIds) {
        const info = await nft.getCardInfo(id);
        console.log(`  #${id}: ${info.name} | ${RARITY_NAMES[Number(info.rarity)]} | ${info.multiplier}x`);
    }

    const mergeTx = await nft.mergeCards(mergeIds, { gasLimit: 5000000n });
    console.log("Merge TX:", mergeTx.hash);
    const mergeReceipt = await mergeTx.wait();
    console.log("Merge confirmed in block:", mergeReceipt.blockNumber);

    // Parse CardsMerged event
    const iface = new ethers.Interface([
        "event CardsMerged(address indexed owner, uint256[3] burnedTokenIds, uint256 indexed newTokenId, uint8 fromRarity, uint8 toRarity)",
    ]);

    let newTokenId = null;
    let fromRarity = null;
    let toRarity = null;
    for (const log of mergeReceipt.logs) {
        try {
            const parsed = iface.parseLog(log);
            if (parsed && parsed.name === "CardsMerged") {
                newTokenId = Number(parsed.args.newTokenId);
                fromRarity = Number(parsed.args.fromRarity);
                toRarity = Number(parsed.args.toRarity);
                break;
            }
        } catch {}
    }

    console.log("\n=== STEP 4: RESULT ===");
    console.log("Event: fromRarity =", RARITY_NAMES[fromRarity], "-> toRarity =", RARITY_NAMES[toRarity]);
    console.log("New token ID:", newTokenId);

    if (newTokenId) {
        const newInfo = await nft.getCardInfo(newTokenId);
        const newRarity = Number(newInfo.rarity);
        console.log("");
        console.log("NEW CARD ON-CHAIN:");
        console.log("  Name:", newInfo.name);
        console.log("  Startup ID:", Number(newInfo.startupId));
        console.log("  Rarity:", RARITY_NAMES[newRarity], "(enum=" + newRarity + ")");
        console.log("  Multiplier:", Number(newInfo.multiplier) + "x");
        console.log("  Edition:", Number(newInfo.edition));
        console.log("");

        if (newRarity === 1) {
            console.log("SUCCESS: Common -> Rare merge works correctly!");
        } else if (newRarity === 0) {
            console.log("BUG CONFIRMED: Common -> Common! Merge logic is broken.");
        } else {
            console.log("UNEXPECTED: Got rarity " + RARITY_NAMES[newRarity] + " (expected Rare)");
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error("Error:", e.message || e);
        process.exit(1);
    });
