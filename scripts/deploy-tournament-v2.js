/**
 * Deploy only TournamentManager v2 (allows entry during active phase).
 * Keeps existing NFT, PackOpener, and Marketplace contracts.
 * Reconfigures cross-contract references.
 */

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const RPC = "https://testnet.riselabs.xyz";
const EXPLORER = "https://explorer.testnet.riselabs.xyz";

// Existing contracts (keep these)
const NFT_ADDRESS = "0xD3C4633257733dA9597b193cDaAA06bCBCbA0BF0";
const PACK_OPENER_ADDRESS = "0x8A35cbe95CD07321CE4f0C73dC2518AAc5b28554";

async function main() {
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        console.error("PRIVATE_KEY not set in scripts/.env");
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(RPC);
    const wallet = new ethers.Wallet(privateKey, provider);
    console.log(`Deployer: ${wallet.address}`);
    const balance = await provider.getBalance(wallet.address);
    console.log(`Balance: ${ethers.formatEther(balance)} ETH\n`);

    // Load compiled TournamentManager
    const buildDir = path.join(__dirname, "..", "build");
    const TournamentManager = JSON.parse(
        fs.readFileSync(path.join(buildDir, "TournamentManager.json"), "utf8")
    );

    // 1. Deploy new TournamentManager
    console.log("Deploying TournamentManager v2...");
    const factory = new ethers.ContractFactory(
        TournamentManager.abi,
        TournamentManager.bytecode,
        wallet
    );
    const contract = await factory.deploy(NFT_ADDRESS);
    await contract.waitForDeployment();
    const newAddress = await contract.getAddress();
    console.log(`TournamentManager v2: ${newAddress}`);
    console.log(`Explorer: ${EXPLORER}/address/${newAddress}\n`);

    // 2. Set PackOpener in new TournamentManager
    console.log("Setting PackOpener in TournamentManager...");
    const tx1 = await contract.setPackOpener(PACK_OPENER_ADDRESS);
    await tx1.wait();
    console.log("Done\n");

    // 3. Update NFT contract: authorize new TournamentManager as locker
    console.log("Authorizing new TournamentManager as locker on NFT...");
    const nftABI = [
        "function setAuthorizedLocker(address locker, bool authorized) external"
    ];
    const nft = new ethers.Contract(NFT_ADDRESS, nftABI, wallet);
    const tx2 = await nft.setAuthorizedLocker(newAddress, true);
    await tx2.wait();
    console.log("Done\n");

    // 4. Update PackOpener: point to new TournamentManager
    console.log("Updating PackOpener to use new TournamentManager...");
    const packABI = [
        "function setTournamentManager(address _tournamentManager) external"
    ];
    const pack = new ethers.Contract(PACK_OPENER_ADDRESS, packABI, wallet);
    const tx3 = await pack.setTournamentManager(newAddress);
    await tx3.wait();
    console.log("Done\n");

    // 5. Create tournament on new contract (same as current #3)
    console.log("Creating tournament on new contract...");
    // Registration: now, start: now, end: 7 days from now
    // Both registration and active entry allowed
    const now = Math.floor(Date.now() / 1000);
    const regStart = now - 3600; // 1 hour ago (already open)
    const startTime = now;       // starts now (active immediately)
    const endTime = now + 7 * 24 * 3600; // 7 days

    const tx4 = await contract.createTournament(regStart, startTime, endTime);
    const receipt = await tx4.wait();
    console.log(`Tournament created. TX: ${receipt.hash}\n`);

    // 6. Set active tournament in PackOpener
    console.log("Setting active tournament in PackOpener...");
    const packABI2 = [
        "function setActiveTournament(uint256 tournamentId) external"
    ];
    const pack2 = new ethers.Contract(PACK_OPENER_ADDRESS, packABI2, wallet);
    const tx5 = await pack2.setActiveTournament(1); // first tournament on new contract
    await tx5.wait();
    console.log("Done\n");

    console.log("=".repeat(50));
    console.log("DEPLOYMENT COMPLETE");
    console.log("=".repeat(50));
    console.log(`\nNew TournamentManager: ${newAddress}`);
    console.log(`NFT (unchanged):       ${NFT_ADDRESS}`);
    console.log(`PackOpener (unchanged): ${PACK_OPENER_ADDRESS}`);
    console.log(`\nUpdate these files with the new TournamentManager address:`);
    console.log(`  - front/lib/contracts.ts`);
    console.log(`  - server/index.js`);
    console.log(`  - server/jobs/daily-scorer.js`);
}

main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error("Deployment failed:", err);
        process.exit(1);
    });
