// scripts/check-tokens.js
// Diagnostic: check what the contract really says about each token
// Usage: node scripts/check-tokens.js [network] [tokenIds...]
// Example: node scripts/check-tokens.js rise 29 37 45
// Or without token IDs to check ALL tokens

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const NETWORKS = {
    rise: { rpc: "https://testnet.riselabs.xyz" },
};

const RARITY_NAMES = ['Common', 'Rare', 'Epic', 'EpicRare', 'Legendary'];

const EXPECTED_STARTUP_RARITY = {
    1: 4, 2: 4, 3: 4, 4: 4, 5: 4,       // Legendary
    6: 2, 7: 2, 8: 2,                     // Epic
    9: 1, 10: 1, 11: 1, 12: 1, 13: 1,    // Rare
    14: 0, 15: 0, 16: 0, 17: 0, 18: 0, 19: 0, // Common
};

const NFT_ABI = [
    "function getCardInfo(uint256 tokenId) view returns (tuple(uint256 startupId, uint256 edition, uint8 rarity, uint256 multiplier, bool isLocked, string name))",
    "function tokenToStartup(uint256 tokenId) view returns (uint256)",
    "function totalSupply() view returns (uint256)",
    "function ownerOf(uint256 tokenId) view returns (address)",
];

async function main() {
    const networkArg = process.argv[2] || "rise";
    const network = NETWORKS[networkArg];
    if (!network) { console.error(`Unknown network: ${networkArg}`); process.exit(1); }

    const deploymentFile = path.join(__dirname, "..", `deployment-${networkArg}.json`);
    const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
    const nftAddress = deployment.proxies.UnicornX_NFT;

    const provider = new ethers.JsonRpcProvider(network.rpc);
    const contract = new ethers.Contract(nftAddress, NFT_ABI, provider);

    const totalSupply = Number(await contract.totalSupply());
    console.log(`\n🔍 Token diagnostics on ${networkArg}`);
    console.log(`   Contract: ${nftAddress}`);
    console.log(`   Total supply: ${totalSupply}\n`);

    // Determine which tokens to check
    let tokenIds = process.argv.slice(3).map(Number).filter(n => n > 0);
    if (tokenIds.length === 0) {
        // Check all tokens from 1 to totalSupply + some buffer for burned
        const maxId = totalSupply + 20; // buffer for burned tokens
        tokenIds = Array.from({ length: maxId }, (_, i) => i + 1);
    }

    console.log("   Token | Startup ID | Name                | On-Chain Rarity | Expected Rarity | Match | Owner");
    console.log("   ------|------------|---------------------|-----------------|-----------------|-------|------");

    let issues = 0;
    for (const tokenId of tokenIds) {
        try {
            const info = await contract.getCardInfo(tokenId);
            const startupId = Number(info.startupId);
            const onChainRarity = Number(info.rarity);
            const multiplier = Number(info.multiplier);
            const name = info.name || '(empty)';
            const expectedRarity = EXPECTED_STARTUP_RARITY[startupId];

            let owner = '?';
            try { owner = await contract.ownerOf(tokenId); owner = owner.slice(0, 6) + '...' + owner.slice(-4); } catch {}

            const match = onChainRarity === expectedRarity;
            if (!match) issues++;

            const status = match ? "✅" : "❌";
            console.log(
                `   ${String(tokenId).padStart(5)} | ` +
                `${String(startupId).padStart(10)} | ` +
                `${name.padEnd(19)} | ` +
                `${(RARITY_NAMES[onChainRarity] || '?').padEnd(15)} | ` +
                `${(RARITY_NAMES[expectedRarity] || '?').padEnd(15)} | ` +
                `${status.padEnd(5)} | ${owner}`
            );
        } catch (e) {
            // Token likely doesn't exist (burned or not minted yet)
            if (process.argv.length > 3) {
                // Only show errors for explicitly requested tokens
                console.log(`   ${String(tokenId).padStart(5)} | -- burned or non-existent --`);
            }
        }
    }

    console.log("");
    if (issues > 0) {
        console.log(`❌ Found ${issues} tokens with rarity mismatch!`);
        console.log("   This means getCardInfo() returns a rarity that doesn't match the startup ID.");
        console.log("   The startups mapping may need reinitializeStartups(), or tokenToStartup is corrupted.\n");
    } else {
        console.log("✅ All tokens have correct rarity for their startup ID.\n");
    }
}

main().catch(console.error);
