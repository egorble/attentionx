// scripts/deploy.js
// Deployment script for AttentionX Smart Contracts via UUPS Proxy on RISE

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
        explorer: "https://explorer.testnet.riselabs.xyz",
        currency: "ETH"
    }
};

/**
 * Deploy an implementation contract + ERC1967Proxy, calling initialize() via proxy.
 */
async function deployProxy(wallet, implArtifact, proxyArtifact, initArgs, contractName) {
    // 1. Deploy implementation (no constructor args — _disableInitializers runs in constructor)
    console.log(`   Deploying ${contractName} implementation...`);
    const implFactory = new ethers.ContractFactory(implArtifact.abi, implArtifact.bytecode, wallet);
    const impl = await implFactory.deploy();
    await impl.waitForDeployment();
    const implAddress = await impl.getAddress();
    console.log(`   Implementation: ${implAddress}`);

    // 2. Encode initialize() call
    const iface = new ethers.Interface(implArtifact.abi);
    const initData = iface.encodeFunctionData("initialize", initArgs);

    // 3. Deploy ERC1967Proxy(implementation, initData)
    console.log(`   Deploying ${contractName} proxy...`);
    const proxyFactory = new ethers.ContractFactory(proxyArtifact.abi, proxyArtifact.bytecode, wallet);
    const proxy = await proxyFactory.deploy(implAddress, initData);
    await proxy.waitForDeployment();
    const proxyAddress = await proxy.getAddress();
    console.log(`   Proxy: ${proxyAddress}`);

    // Return contract instance connected to proxy (using implementation ABI)
    const proxyContract = new ethers.Contract(proxyAddress, implArtifact.abi, wallet);

    return {
        contract: proxyContract,
        proxyAddress,
        implAddress
    };
}

async function main() {
    // Get network from command line
    const networkArg = process.argv[2] || "rise";
    const network = NETWORKS[networkArg];

    if (!network) {
        console.error(`❌ Unknown network: ${networkArg}`);
        console.error(`   Available networks: ${Object.keys(NETWORKS).join(", ")}`);
        process.exit(1);
    }

    console.log('🚀 Deploying AttentionX Smart Contracts (UUPS Proxy) to RISE...\n');
    console.log(`📍 Network: ${network.name}`);
    console.log(`   Chain ID: ${network.chainId}`);
    console.log(`   RPC: ${network.rpc}`);
    console.log("");

    // Get private key from environment
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        console.error("❌ PRIVATE_KEY environment variable not set!");
        console.error("   Usage: PRIVATE_KEY=0x... node scripts/deploy.js rise");
        process.exit(1);
    }

    // Initialize Provider and Wallet
    const provider = new ethers.JsonRpcProvider(network.rpc);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log(`👤 Deployer: ${wallet.address}`);
    const balance = await provider.getBalance(wallet.address);
    console.log(`💰 Balance: ${ethers.formatEther(balance)} ${network.currency || 'ETH'}`);
    console.log("");

    // Load compiled contracts
    const buildDir = path.join(__dirname, "..", "build");

    const AttentionX_NFT = JSON.parse(
        fs.readFileSync(path.join(buildDir, "AttentionX_NFT.json"), "utf8")
    );
    const PackNFT = JSON.parse(
        fs.readFileSync(path.join(buildDir, "PackNFT.json"), "utf8")
    );
    const PackOpener = JSON.parse(
        fs.readFileSync(path.join(buildDir, "PackOpener.json"), "utf8")
    );
    const TournamentManager = JSON.parse(
        fs.readFileSync(path.join(buildDir, "TournamentManager.json"), "utf8")
    );
    const MarketplaceV2 = JSON.parse(
        fs.readFileSync(path.join(buildDir, "MarketplaceV2.json"), "utf8")
    );
    const TokenLeagues = JSON.parse(
        fs.readFileSync(path.join(buildDir, "TokenLeagues.json"), "utf8")
    );
    const ERC1967Proxy = JSON.parse(
        fs.readFileSync(path.join(buildDir, "ERC1967Proxy.json"), "utf8")
    );

    // Config
    const TREASURY_ADDRESS = "0x233c8C54F25734B744E522bdC1Eed9cbc8C97D0c";

    console.log("⚙️  Configuration:");
    console.log("   Treasury:", TREASURY_ADDRESS);
    console.log("   Deploy mode: UUPS Proxy (upgradeable)");
    console.log("");

    // ============ Step 1: Deploy AttentionX_NFT (Proxy) ============
    console.log('📦 Step 1: Deploying AttentionX_NFT...');
    const nft = await deployProxy(wallet, AttentionX_NFT, ERC1967Proxy, [wallet.address], "AttentionX_NFT");
    console.log(`✅ AttentionX_NFT proxy: ${nft.proxyAddress}`);
    console.log(`   Explorer: ${network.explorer}/address/${nft.proxyAddress}`);
    console.log("");

    // ============ Step 2: Deploy PackNFT (Proxy) ============
    console.log("📦 Step 2: Deploying PackNFT...");
    const packNft = await deployProxy(wallet, PackNFT, ERC1967Proxy, [wallet.address], "PackNFT");
    console.log(`✅ PackNFT proxy: ${packNft.proxyAddress}`);
    console.log("");

    // ============ Step 3: Deploy TournamentManager (Proxy) ============
    console.log("📦 Step 3: Deploying TournamentManager...");
    const tournament = await deployProxy(wallet, TournamentManager, ERC1967Proxy, [nft.proxyAddress], "TournamentManager");
    console.log(`✅ TournamentManager proxy: ${tournament.proxyAddress}`);
    console.log("");

    // ============ Step 4: Deploy PackOpener (Proxy) ============
    console.log("📦 Step 4: Deploying PackOpener...");
    const pack = await deployProxy(wallet, PackOpener, ERC1967Proxy, [nft.proxyAddress, TREASURY_ADDRESS, wallet.address], "PackOpener");
    console.log(`✅ PackOpener proxy: ${pack.proxyAddress}`);
    console.log("");

    // ============ Step 5: Deploy MarketplaceV2 (Proxy) ============
    console.log("📦 Step 5: Deploying MarketplaceV2...");
    const marketplace = await deployProxy(wallet, MarketplaceV2, ERC1967Proxy, [nft.proxyAddress, wallet.address], "MarketplaceV2");
    console.log(`✅ MarketplaceV2 proxy: ${marketplace.proxyAddress}`);
    console.log("");

    // ============ Step 6: Deploy TokenLeagues (Proxy) ============
    console.log("📦 Step 6: Deploying TokenLeagues...");
    const ENTRY_FEE = ethers.parseEther("0.001"); // 0.001 ETH
    const tokenLeagues = await deployProxy(wallet, TokenLeagues, ERC1967Proxy,
        [TREASURY_ADDRESS, ENTRY_FEE, wallet.address], "TokenLeagues");
    console.log(`✅ TokenLeagues proxy: ${tokenLeagues.proxyAddress}`);
    console.log("");

    // ============ Step 7: Configuration ============
    console.log("🛠️ Step 7: Configuring Contracts...");

    // 1. Set PackOpener as authorized minter on AttentionX_NFT (cards)
    console.log("   Setting PackOpener as authorized card minter...");
    const tx1 = await nft.contract.setAuthorizedMinter(pack.proxyAddress, true);
    await tx1.wait();
    console.log("   ✅ PackOpener is now authorized card minter");

    // 2. Set TournamentManager as authorized locker
    console.log("   Setting TournamentManager as authorized locker...");
    const tx2 = await nft.contract.setAuthorizedLocker(tournament.proxyAddress, true);
    await tx2.wait();
    console.log("   ✅ TournamentManager is now authorized locker");

    // 3. Set TournamentManager reference in PackOpener for prize pool distribution
    console.log("   Setting TournamentManager in PackOpener...");
    const tx3 = await pack.contract.setTournamentManager(tournament.proxyAddress);
    await tx3.wait();
    console.log("   ✅ TournamentManager set in PackOpener");

    // 4. Set PackOpener reference in TournamentManager
    console.log("   Setting PackOpener in TournamentManager...");
    const tx4 = await tournament.contract.setPackOpener(pack.proxyAddress);
    await tx4.wait();
    console.log("   ✅ PackOpener set in TournamentManager");

    // 5. Set PackOpener as authorized minter & burner on PackNFT
    console.log("   Setting PackOpener as authorized pack minter...");
    const tx5 = await packNft.contract.setAuthorizedMinter(pack.proxyAddress, true);
    await tx5.wait();
    console.log("   ✅ PackOpener is now authorized pack minter");

    console.log("   Setting PackOpener as authorized pack burner...");
    const tx6 = await packNft.contract.setAuthorizedBurner(pack.proxyAddress, true);
    await tx6.wait();
    console.log("   ✅ PackOpener is now authorized pack burner");

    // 6. Set PackNFT reference in PackOpener
    console.log("   Setting PackNFT contract in PackOpener...");
    const tx7 = await pack.contract.setPackNftContract(packNft.proxyAddress);
    await tx7.wait();
    console.log("   ✅ PackNFT set in PackOpener");

    // 7. Set PackNFT in MarketplaceV2 for pack trading
    console.log("   Setting PackNFT contract in MarketplaceV2...");
    const tx8 = await marketplace.contract.setPackNftContract(packNft.proxyAddress);
    await tx8.wait();
    console.log("   ✅ PackNFT set in MarketplaceV2");

    console.log("");

    // ============ Summary ============
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("🎉 DEPLOYMENT COMPLETE (UUPS Proxy)!");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");
    console.log("📋 Proxy Addresses (permanent — use these everywhere):");
    console.log('   AttentionX_NFT:       ', nft.proxyAddress);
    console.log("   PackNFT:            ", packNft.proxyAddress);
    console.log("   PackOpener:         ", pack.proxyAddress);
    console.log("   TournamentManager:  ", tournament.proxyAddress);
    console.log("   MarketplaceV2:      ", marketplace.proxyAddress);
    console.log("   TokenLeagues:       ", tokenLeagues.proxyAddress);
    console.log("");
    console.log("📋 Implementation Addresses (upgradeable):");
    console.log('   AttentionX_NFT:       ', nft.implAddress);
    console.log("   PackNFT:            ", packNft.implAddress);
    console.log("   PackOpener:         ", pack.implAddress);
    console.log("   TournamentManager:  ", tournament.implAddress);
    console.log("   MarketplaceV2:      ", marketplace.implAddress);
    console.log("   TokenLeagues:       ", tokenLeagues.implAddress);
    console.log("");

    // Save deployment info
    const deploymentInfo = {
        network: networkArg,
        networkName: network.name,
        chainId: network.chainId,
        explorer: network.explorer,
        timestamp: new Date().toISOString(),
        deployer: wallet.address,
        deployMode: "UUPS Proxy",
        proxies: {
            AttentionX_NFT: nft.proxyAddress,
            PackNFT: packNft.proxyAddress,
            PackOpener: pack.proxyAddress,
            TournamentManager: tournament.proxyAddress,
            MarketplaceV2: marketplace.proxyAddress,
            TokenLeagues: tokenLeagues.proxyAddress
        },
        implementations: {
            AttentionX_NFT: nft.implAddress,
            PackNFT: packNft.implAddress,
            PackOpener: pack.implAddress,
            TournamentManager: tournament.implAddress,
            MarketplaceV2: marketplace.implAddress,
            TokenLeagues: tokenLeagues.implAddress
        },
        configuration: {
            owner: wallet.address,
            treasury: TREASURY_ADDRESS
        }
    };

    const deploymentFile = path.join(__dirname, "..", `deployment-${networkArg}.json`);
    fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
    console.log(`📁 Deployment info saved to: deployment-${networkArg}.json`);
    console.log("");

    console.log("📝 Next Steps:");
    console.log("   1. Update front/lib/contracts.ts with proxy addresses above");
    console.log("   2. Test pack purchase on testnet");
    console.log("   3. To upgrade a contract: node scripts/upgrade.js rise <ContractName>");
    console.log("");

    return deploymentInfo;
}

// Run deployment
main()
    .then(() => {
        console.log("✅ Deployment script completed successfully");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    });
