// scripts/compile.js
// Compile Solidity contracts using solc

const solc = require("solc");
const fs = require("fs");
const path = require("path");

// Directories
const CONTRACTS_DIR = path.join(__dirname, "..", "contracts");
const BUILD_DIR = path.join(__dirname, "..", "build");
const NODE_MODULES = path.join(__dirname, "..", "node_modules");

// Create build directory
if (!fs.existsSync(BUILD_DIR)) {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
}

console.log("🔨 Compiling AttentionX Smart Contracts with solc...\n");

// Contract files to compile
const contractFiles = [
    "AttentionX_NFT.sol",
    "PackNFT.sol",
    "PackOpener.sol",
    "TournamentManager.sol",
    "MarketplaceV2.sol",
    "ERC1967Proxy.sol"
];

// Read contract sources
const sources = {};

// Import resolver for OpenZeppelin
function findImports(importPath) {
    try {
        let resolvedPath;

        if (importPath.startsWith("@openzeppelin/")) {
            resolvedPath = path.join(NODE_MODULES, importPath);
        } else {
            resolvedPath = path.join(CONTRACTS_DIR, importPath);
        }

        const content = fs.readFileSync(resolvedPath, "utf8");
        return { contents: content };
    } catch (error) {
        return { error: `File not found: ${importPath}` };
    }
}

// Load contract sources
for (const file of contractFiles) {
    const filePath = path.join(CONTRACTS_DIR, file);
    sources[file] = { content: fs.readFileSync(filePath, "utf8") };
    console.log(`📄 Loaded: ${file}`);
}

// Compiler input
const input = {
    language: "Solidity",
    sources: sources,
    settings: {
        optimizer: {
            enabled: true,
            runs: 200
        },
        viaIR: true,
        evmVersion: "shanghai", // Osaka not yet in solc, use shanghai
        outputSelection: {
            "*": {
                "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"]
            }
        }
    }
};

console.log("\n⏳ Compiling...\n");

// Compile
const output = JSON.parse(
    solc.compile(JSON.stringify(input), { import: findImports })
);

// Check for errors
if (output.errors) {
    let hasError = false;
    for (const error of output.errors) {
        if (error.severity === "error") {
            console.error(`❌ Error: ${error.formattedMessage}`);
            hasError = true;
        } else {
            console.warn(`⚠️  Warning: ${error.formattedMessage}`);
        }
    }
    if (hasError) {
        console.error("\n❌ Compilation failed!");
        process.exit(1);
    }
}

// Process compiled contracts
const compiledContracts = {};

// Map .sol file -> contract name to extract (ERC1967Proxy is imported from OZ)
const contractNameMap = {
    "ERC1967Proxy.sol": "ERC1967Proxy"
};

for (const file of contractFiles) {
    const contractName = contractNameMap[file] || file.replace(".sol", "");

    if (output.contracts && output.contracts[file] && output.contracts[file][contractName]) {
        const contract = output.contracts[file][contractName];

        compiledContracts[contractName] = {
            abi: contract.abi,
            bytecode: "0x" + contract.evm.bytecode.object,
            deployedBytecode: "0x" + contract.evm.deployedBytecode.object
        };

        // Save individual contract artifacts
        const artifactPath = path.join(BUILD_DIR, `${contractName}.json`);
        fs.writeFileSync(
            artifactPath,
            JSON.stringify(compiledContracts[contractName], null, 2)
        );

        console.log(`✅ Compiled: ${contractName}`);
        console.log(`   ABI entries: ${contract.abi.length}`);
        console.log(`   Bytecode size: ${(contract.evm.bytecode.object.length / 2).toLocaleString()} bytes`);
    } else if (output.contracts) {
        // For files that re-export (like ERC1967Proxy.sol), search all compiled outputs
        let found = false;
        for (const [sourceFile, contracts] of Object.entries(output.contracts)) {
            if (contracts[contractName]) {
                const contract = contracts[contractName];
                compiledContracts[contractName] = {
                    abi: contract.abi,
                    bytecode: "0x" + contract.evm.bytecode.object,
                    deployedBytecode: "0x" + contract.evm.deployedBytecode.object
                };

                const artifactPath = path.join(BUILD_DIR, `${contractName}.json`);
                fs.writeFileSync(
                    artifactPath,
                    JSON.stringify(compiledContracts[contractName], null, 2)
                );

                console.log(`✅ Compiled: ${contractName} (from ${sourceFile})`);
                console.log(`   ABI entries: ${contract.abi.length}`);
                console.log(`   Bytecode size: ${(contract.evm.bytecode.object.length / 2).toLocaleString()} bytes`);
                found = true;
                break;
            }
        }
        if (!found) {
            console.warn(`⚠️  Could not find compiled output for: ${contractName}`);
        }
    }
}

// Save combined artifacts
const allArtifacts = {
    timestamp: new Date().toISOString(),
    compiler: "solc 0.8.20",
    contracts: compiledContracts
};

fs.writeFileSync(
    path.join(BUILD_DIR, "contracts.json"),
    JSON.stringify(allArtifacts, null, 2)
);

console.log("\n═══════════════════════════════════════════════════════════════");
console.log("🎉 COMPILATION COMPLETE!");
console.log("═══════════════════════════════════════════════════════════════");
console.log(`\n📁 Build artifacts saved to: ${BUILD_DIR}`);
console.log("\nFiles generated:");
console.log("   - AttentionX_NFT.json");
console.log("   - PackNFT.json");
console.log("   - PackOpener.json");
console.log("   - TournamentManager.json");
console.log("   - MarketplaceV2.json");
console.log("   - ERC1967Proxy.json");
console.log("   - contracts.json (combined)");
console.log("");
