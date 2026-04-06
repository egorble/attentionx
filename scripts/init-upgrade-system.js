// scripts/init-upgrade-system.js
// Calls initializeUpgradeSystem() on the AttentionX_NFT proxy to set default upgrade chances

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

async function main() {
    const RPC = "https://testnet.riselabs.xyz";
    const provider = new ethers.JsonRpcProvider(RPC);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    // Load proxy address from deployment file
    const deploymentFile = path.join(__dirname, "..", "deployment-rise.json");
    const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
    const proxyAddress = deployment.proxies.AttentionX_NFT;

    console.log(`Proxy address: ${proxyAddress}`);
    console.log(`Caller: ${wallet.address}`);

    const abi = [
        "function initializeUpgradeSystem()",
        "function upgradeChance(uint8 level) view returns (uint16)"
    ];

    const contract = new ethers.Contract(proxyAddress, abi, wallet);

    // initializeUpgradeSystem() was already called successfully.
    // Now just verify the results.

    // Verify by calling upgradeChance(1)
    console.log("\nVerifying upgradeChance(1)...");
    const chance = await contract.upgradeChance(1);
    console.log(`upgradeChance(1) = ${chance.toString()}`);

    if (chance.toString() === "8000") {
        console.log("SUCCESS: upgradeChance(1) returns 8000 (80%) as expected.");
    } else {
        console.log(`WARNING: Expected 8000 but got ${chance.toString()}`);
    }

    // Also check other levels for completeness
    for (let level = 2; level <= 5; level++) {
        const c = await contract.upgradeChance(level);
        console.log(`upgradeChance(${level}) = ${c.toString()}`);
    }
}

main()
    .then(() => {
        console.log("\nDone.");
        process.exit(0);
    })
    .catch((error) => {
        console.error("Error:", error);
        process.exit(1);
    });
