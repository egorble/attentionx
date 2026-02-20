// scripts/upgrade.js
// Upgrade a single UUPS proxy contract's implementation
//
// Usage: node scripts/upgrade.js <network> <ContractName>
// Example: node scripts/upgrade.js rise MarketplaceV2

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

// Network configurations
const NETWORKS = {
    rise: {
        name: "RISE Testnet",
        chainId: 11155931,
        rpc: "https://testnet.riselabs.xyz",
        explorer: "https://explorer.testnet.riselabs.xyz"
    }
};

const VALID_CONTRACTS = ["UnicornX_NFT", "PackOpener", "TournamentManager", "MarketplaceV2"];

async function main() {
    const networkArg = process.argv[2];
    const contractName = process.argv[3];

    if (!networkArg || !contractName) {
        console.error("❌ Usage: node scripts/upgrade.js <network> <ContractName>");
        console.error(`   Networks: ${Object.keys(NETWORKS).join(", ")}`);
        console.error(`   Contracts: ${VALID_CONTRACTS.join(", ")}`);
        process.exit(1);
    }

    const network = NETWORKS[networkArg];
    if (!network) {
        console.error(`❌ Unknown network: ${networkArg}`);
        process.exit(1);
    }

    if (!VALID_CONTRACTS.includes(contractName)) {
        console.error(`❌ Unknown contract: ${contractName}`);
        console.error(`   Valid contracts: ${VALID_CONTRACTS.join(", ")}`);
        process.exit(1);
    }

    // Load deployment info
    const deploymentFile = path.join(__dirname, "..", `deployment-${networkArg}.json`);
    if (!fs.existsSync(deploymentFile)) {
        console.error(`❌ Deployment file not found: deployment-${networkArg}.json`);
        console.error("   Deploy first with: node scripts/deploy.js " + networkArg);
        process.exit(1);
    }

    const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
    const proxyAddress = deployment.proxies[contractName];
    const oldImplAddress = deployment.implementations[contractName];

    if (!proxyAddress) {
        console.error(`❌ No proxy address found for ${contractName} in deployment file`);
        process.exit(1);
    }

    console.log(`🔄 Upgrading ${contractName} on ${network.name}...\n`);
    console.log(`   Proxy address: ${proxyAddress} (permanent)`);
    console.log(`   Old implementation: ${oldImplAddress}`);
    console.log("");

    // Get private key
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        console.error("❌ PRIVATE_KEY environment variable not set!");
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(network.rpc);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log(`👤 Upgrader: ${wallet.address}`);
    const balance = await provider.getBalance(wallet.address);
    console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH`);
    console.log("");

    // Load new compiled artifact
    const buildDir = path.join(__dirname, "..", "build");
    const artifactPath = path.join(buildDir, `${contractName}.json`);

    if (!fs.existsSync(artifactPath)) {
        console.error(`❌ Build artifact not found: ${artifactPath}`);
        console.error("   Compile first with: node scripts/compile.js");
        process.exit(1);
    }

    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

    // Step 1: Deploy new implementation
    console.log("📦 Step 1: Deploying new implementation...");
    const implFactory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
    const newImpl = await implFactory.deploy();
    await newImpl.waitForDeployment();
    const newImplAddress = await newImpl.getAddress();
    console.log(`   New implementation: ${newImplAddress}`);
    console.log("");

    // Step 2: Call upgradeToAndCall on the proxy
    console.log("📦 Step 2: Upgrading proxy to new implementation...");
    const proxyContract = new ethers.Contract(proxyAddress, artifact.abi, wallet);

    // upgradeToAndCall(newImplementation, data) — pass empty data (no re-initialization)
    const tx = await proxyContract.upgradeToAndCall(newImplAddress, "0x");
    console.log(`   TX Hash: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`   ✅ Upgrade confirmed in block ${receipt.blockNumber}`);
    console.log("");

    // Step 2b: For UnicornX_NFT — re-initialize startups mapping to prevent rarity corruption
    // The startups mapping stores rarity/multiplier data used by mergeCards() and getCardInfo().
    // After a UUPS upgrade, storage layout changes can corrupt this mapping, causing:
    //   - RarityMismatch errors during merge (cards show correct rarity in UI but differ on-chain)
    //   - Wrong rarity on merged cards (e.g. Common instead of Rare)
    if (contractName === "UnicornX_NFT") {
        console.log("📦 Step 2b: Re-initializing startups data (NFT-specific)...");
        try {
            const reinitTx = await proxyContract.reinitializeStartups();
            console.log(`   TX Hash: ${reinitTx.hash}`);
            await reinitTx.wait();
            console.log("   ✅ Startups data re-initialized successfully");
        } catch (reinitError) {
            console.error(`   ⚠️  Failed to reinitialize startups: ${reinitError.message}`);
            console.error("   You may need to call reinitializeStartups() manually via admin.");
        }
        console.log("");
    }

    // Step 3: Update deployment file
    deployment.implementations[contractName] = newImplAddress;

    // Track upgrade history
    if (!deployment.upgradeHistory) deployment.upgradeHistory = [];
    deployment.upgradeHistory.push({
        contract: contractName,
        oldImplementation: oldImplAddress,
        newImplementation: newImplAddress,
        timestamp: new Date().toISOString(),
        txHash: tx.hash
    });

    fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
    console.log(`📁 Updated deployment-${networkArg}.json`);

    // Summary
    console.log("");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log(`🎉 ${contractName} UPGRADED SUCCESSFULLY!`);
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");
    console.log(`   Proxy (unchanged):     ${proxyAddress}`);
    console.log(`   Old implementation:     ${oldImplAddress}`);
    console.log(`   New implementation:     ${newImplAddress}`);
    console.log(`   Explorer: ${network.explorer}/tx/${tx.hash}`);
    console.log("");
}

main()
    .then(() => {
        console.log("✅ Upgrade script completed successfully");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ Upgrade failed:", error);
        process.exit(1);
    });
