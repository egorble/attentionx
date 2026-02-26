// scripts/set-pack-price.js
// Update the pack price on the deployed PackOpener contract
//
// Usage: node scripts/set-pack-price.js <newPriceEth>
// Example: node scripts/set-pack-price.js 0.0009

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const RPC = "https://testnet.riselabs.xyz";
const DEPLOYMENT_FILE = path.join(__dirname, "..", "deployment-rise.json");

const PACK_OPENER_ABI = [
    "function currentPackPrice() view returns (uint256)",
    "function setPackPrice(uint256 newPrice) external",
];

async function main() {
    const priceArg = process.argv[2];
    if (!priceArg) {
        console.error("❌ Usage: node scripts/set-pack-price.js <newPriceEth>");
        console.error("   Example: node scripts/set-pack-price.js 0.0009");
        process.exit(1);
    }

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        console.error("❌ PRIVATE_KEY not set in scripts/.env");
        process.exit(1);
    }

    // Get contract address from deployment file
    let packOpenerAddress;
    if (fs.existsSync(DEPLOYMENT_FILE)) {
        const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
        packOpenerAddress = deployment.contracts?.PackOpener?.proxy || deployment.PackOpener;
    }
    if (!packOpenerAddress) {
        // Fallback to hardcoded address
        packOpenerAddress = "0x85C031EbBBf859B2b376622a74D8fEe74753bDC0";
    }

    const provider = new ethers.JsonRpcProvider(RPC);
    const wallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(packOpenerAddress, PACK_OPENER_ABI, wallet);

    const newPrice = ethers.parseEther(priceArg);
    const oldPrice = await contract.currentPackPrice();

    console.log(`📦 PackOpener: ${packOpenerAddress}`);
    console.log(`👛 Caller: ${wallet.address}`);
    console.log(`💰 Current price: ${ethers.formatEther(oldPrice)} ETH`);
    console.log(`🎯 New price:     ${ethers.formatEther(newPrice)} ETH`);
    console.log("");

    console.log("⏳ Sending transaction...");
    const tx = await contract.setPackPrice(newPrice);
    console.log(`📋 Tx hash: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`✅ Confirmed in block ${receipt.blockNumber}`);

    const confirmedPrice = await contract.currentPackPrice();
    console.log(`✅ Price on-chain: ${ethers.formatEther(confirmedPrice)} ETH`);
}

main().catch((err) => {
    console.error("❌ Error:", err.message);
    process.exit(1);
});
