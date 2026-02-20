// scripts/reinitialize-startups.js
// Verify and fix the UnicornX_NFT startups mapping after UUPS upgrades
//
// Usage: node scripts/reinitialize-startups.js [network]
// Example: node scripts/reinitialize-startups.js rise

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const NETWORKS = {
    rise: {
        rpc: "https://testnet.riselabs.xyz",
    },
};

const EXPECTED_STARTUPS = {
    1:  { name: "Openclaw",           rarity: 4, multiplier: 10 }, // Legendary
    2:  { name: "Lovable",            rarity: 4, multiplier: 10 },
    3:  { name: "Cursor",             rarity: 4, multiplier: 10 },
    4:  { name: "OpenAI",             rarity: 4, multiplier: 10 },
    5:  { name: "Anthropic",          rarity: 4, multiplier: 10 },
    6:  { name: "Browser Use",        rarity: 2, multiplier: 5 },  // Epic
    7:  { name: "Dedalus Labs",       rarity: 2, multiplier: 5 },
    8:  { name: "Autumn",             rarity: 2, multiplier: 5 },
    9:  { name: "Axiom",              rarity: 1, multiplier: 3 },  // Rare
    10: { name: "Multifactor",        rarity: 1, multiplier: 3 },
    11: { name: "Dome",               rarity: 1, multiplier: 3 },
    12: { name: "GrazeMate",          rarity: 1, multiplier: 3 },
    13: { name: "Tornyol Systems",    rarity: 1, multiplier: 3 },
    14: { name: "Pocket",             rarity: 0, multiplier: 1 },  // Common
    15: { name: "Caretta",            rarity: 0, multiplier: 1 },
    16: { name: "AxionOrbital Space", rarity: 0, multiplier: 1 },
    17: { name: "Freeport Markets",   rarity: 0, multiplier: 1 },
    18: { name: "Ruvo",               rarity: 0, multiplier: 1 },
    19: { name: "Lightberry",         rarity: 0, multiplier: 1 },
};

const RARITY_NAMES = ['Common', 'Rare', 'Epic', 'EpicRare', 'Legendary'];

const NFT_ABI = [
    "function startups(uint256 id) view returns (string name, uint8 rarity, uint256 multiplier)",
    "function getCardInfo(uint256 tokenId) view returns (tuple(uint256 startupId, uint256 edition, uint8 rarity, uint256 multiplier, bool isLocked, string name))",
    "function reinitializeStartups() external",
    "function totalSupply() view returns (uint256)",
];

async function main() {
    const networkArg = process.argv[2] || "rise";
    const network = NETWORKS[networkArg];
    if (!network) {
        console.error(`Unknown network: ${networkArg}`);
        process.exit(1);
    }

    const deploymentFile = path.join(__dirname, "..", `deployment-${networkArg}.json`);
    if (!fs.existsSync(deploymentFile)) {
        console.error(`Deployment file not found: deployment-${networkArg}.json`);
        process.exit(1);
    }

    const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
    const nftAddress = deployment.proxies.UnicornX_NFT;

    console.log(`\n🔍 Verifying startups mapping on ${networkArg}...`);
    console.log(`   NFT Contract: ${nftAddress}\n`);

    const provider = new ethers.JsonRpcProvider(network.rpc);
    const contract = new ethers.Contract(nftAddress, NFT_ABI, provider);

    // Check total supply
    const totalSupply = Number(await contract.totalSupply());
    console.log(`   Total supply: ${totalSupply} NFTs\n`);

    // Verify each startup
    let hasIssues = false;
    console.log("   ID | Expected              | On-Chain              | Status");
    console.log("   ---|------------------------|------------------------|-------");

    for (let id = 1; id <= 19; id++) {
        const expected = EXPECTED_STARTUPS[id];
        try {
            const result = await contract.startups(id);
            const onChainName = result.name || result[0];
            const onChainRarity = Number(result.rarity ?? result[1]);
            const onChainMultiplier = Number(result.multiplier ?? result[2]);

            const nameOk = onChainName === expected.name;
            const rarityOk = onChainRarity === expected.rarity;
            const multiplierOk = onChainMultiplier === expected.multiplier;
            const allOk = nameOk && rarityOk && multiplierOk;

            if (!allOk) hasIssues = true;

            const status = allOk ? "✅" : "❌";
            const onChainStr = `${onChainName || '(empty)'} ${RARITY_NAMES[onChainRarity] || '?'} ${onChainMultiplier}x`;
            const expectedStr = `${expected.name} ${RARITY_NAMES[expected.rarity]} ${expected.multiplier}x`;

            console.log(`   ${String(id).padStart(2)} | ${expectedStr.padEnd(22)} | ${onChainStr.padEnd(22)} | ${status}`);
        } catch (e) {
            hasIssues = true;
            console.log(`   ${String(id).padStart(2)} | ${expected.name.padEnd(22)} | ERROR: ${e.message.slice(0, 20)} | ❌`);
        }
    }

    console.log("");

    if (!hasIssues) {
        console.log("✅ All startups data is correct! No action needed.\n");
        return;
    }

    console.log("❌ Startups data has issues! Needs reinitializeStartups() call.\n");

    // Check if we have a private key to fix it
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        console.log("   To fix: set PRIVATE_KEY env var and re-run, or call reinitializeStartups() from admin wallet.");
        return;
    }

    const wallet = new ethers.Wallet(privateKey, provider);
    console.log(`   Fixing with wallet: ${wallet.address}`);

    const adminContract = new ethers.Contract(nftAddress, NFT_ABI, wallet);
    try {
        const tx = await adminContract.reinitializeStartups();
        console.log(`   TX: ${tx.hash}`);
        await tx.wait();
        console.log("   ✅ reinitializeStartups() succeeded!\n");

        // Verify again
        console.log("   Verifying fix...");
        const check = await adminContract.startups(9);
        const checkRarity = Number(check.rarity ?? check[1]);
        if (checkRarity === 1) {
            console.log("   ✅ Startup #9 (Axiom) is now Rare — fix confirmed!\n");
        } else {
            console.log(`   ⚠️ Startup #9 rarity is ${RARITY_NAMES[checkRarity]} — may need further investigation\n`);
        }
    } catch (e) {
        console.error(`   ❌ Failed: ${e.message}`);
        console.error("   Make sure you're using an admin wallet (owner or SECOND_ADMIN).\n");
    }
}

main().catch(console.error);
