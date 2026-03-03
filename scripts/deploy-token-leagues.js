// scripts/deploy-token-leagues.js
// Deploy TokenLeagues contract via UUPS Proxy on RISE Testnet
// Usage: node scripts/deploy-token-leagues.js

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const NETWORK = {
    name: "RISE Testnet",
    chainId: 11155931,
    rpc: "https://testnet.riselabs.xyz",
    explorer: "https://explorer.testnet.riselabs.xyz",
};

const TREASURY_ADDRESS = "0x233c8C54F25734B744E522bdC1Eed9cbc8C97D0c";
const ENTRY_FEE = ethers.parseEther("0.001"); // 0.001 ETH

async function deployProxy(wallet, implArtifact, proxyArtifact, initArgs, contractName) {
    console.log(`   Deploying ${contractName} implementation...`);
    const implFactory = new ethers.ContractFactory(implArtifact.abi, implArtifact.bytecode, wallet);
    const impl = await implFactory.deploy();
    await impl.waitForDeployment();
    const implAddress = await impl.getAddress();
    console.log(`   Implementation: ${implAddress}`);

    const iface = new ethers.Interface(implArtifact.abi);
    const initData = iface.encodeFunctionData("initialize", initArgs);

    console.log(`   Deploying ${contractName} proxy...`);
    const proxyFactory = new ethers.ContractFactory(proxyArtifact.abi, proxyArtifact.bytecode, wallet);
    const proxy = await proxyFactory.deploy(implAddress, initData);
    await proxy.waitForDeployment();
    const proxyAddress = await proxy.getAddress();
    console.log(`   Proxy: ${proxyAddress}`);

    const proxyContract = new ethers.Contract(proxyAddress, implArtifact.abi, wallet);
    return { contract: proxyContract, proxyAddress, implAddress };
}

async function main() {
    console.log('Deploying TokenLeagues to RISE Testnet...\n');

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        console.error("PRIVATE_KEY not set in scripts/.env");
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(NETWORK.rpc);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log(`Deployer: ${wallet.address}`);
    const balance = await provider.getBalance(wallet.address);
    console.log(`Balance: ${ethers.formatEther(balance)} ETH\n`);

    // Load compiled artifacts
    const buildDir = path.join(__dirname, "..", "build");
    const TokenLeagues = JSON.parse(fs.readFileSync(path.join(buildDir, "TokenLeagues.json"), "utf8"));
    const ERC1967Proxy = JSON.parse(fs.readFileSync(path.join(buildDir, "ERC1967Proxy.json"), "utf8"));

    console.log(`Treasury: ${TREASURY_ADDRESS}`);
    console.log(`Entry fee: ${ethers.formatEther(ENTRY_FEE)} ETH\n`);

    // Deploy: initialize(treasury, entryFee, initialOwner)
    const result = await deployProxy(
        wallet,
        TokenLeagues,
        ERC1967Proxy,
        [TREASURY_ADDRESS, ENTRY_FEE, wallet.address],
        "TokenLeagues"
    );

    console.log(`\nTokenLeagues deployed!`);
    console.log(`   Proxy: ${result.proxyAddress}`);
    console.log(`   Implementation: ${result.implAddress}`);
    console.log(`   Explorer: ${NETWORK.explorer}/address/${result.proxyAddress}\n`);

    // Verify initialization
    const entryFee = await result.contract.entryFee();
    const treasury = await result.contract.treasury();
    console.log(`Verification:`);
    console.log(`   Entry fee: ${ethers.formatEther(entryFee)} ETH`);
    console.log(`   Treasury: ${treasury}`);

    // Update deployment file
    const deploymentFile = path.join(__dirname, "..", "deployment-rise.json");
    let deployment = {};
    if (fs.existsSync(deploymentFile)) {
        deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
    }
    deployment.proxies = deployment.proxies || {};
    deployment.implementations = deployment.implementations || {};
    deployment.proxies.TokenLeagues = result.proxyAddress;
    deployment.implementations.TokenLeagues = result.implAddress;
    deployment.tokenLeaguesDeployedAt = new Date().toISOString();
    fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
    console.log(`\nDeployment info saved to deployment-rise.json`);

    console.log(`\nNext steps:`);
    console.log(`   1. Update front/lib/networks.ts with: TokenLeagues: '${result.proxyAddress}'`);
    console.log(`   2. Update front/lib/contracts.ts with TokenLeagues ABI`);
    console.log(`   3. Update server/config.js with: TokenLeagues: '${result.proxyAddress}'`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Deployment failed:", error);
        process.exit(1);
    });
