const { ethers } = require("ethers");

const RPC_URL = "https://testnet.riselabs.xyz";
const CONTRACT_ADDRESS = "0x612ca7a970547087d2a4871eb313BEfd674073D8";

const RARITY_NAMES = {
  0: "Common",
  1: "Rare",
  2: "Epic",
  3: "EpicRare",
  4: "Legendary",
};

const ABI = [
  "function totalSupply() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
];

const GET_CARD_INFO_SELECTOR = "0x970129be";

function shortenAddress(addr) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function rarityLabel(r) {
  return RARITY_NAMES[r] || ("Rarity_" + r);
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function retryCall(fn, maxRetries, delayMs) {
  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      // Check if it's a "token doesn't exist" error (not retryable)
      var msg = err.message || "";
      if (msg.includes("ERC721") || msg.includes("nonexistent") || msg.includes("invalid token") ||
          msg.includes("custom error") || msg.includes("execution reverted")) {
        throw err; // Not retryable
      }
      await sleep(delayMs * (attempt + 1));
    }
  }
}

async function getCardInfo(provider, tokenId) {
  var encoder = ethers.AbiCoder.defaultAbiCoder();
  var data = GET_CARD_INFO_SELECTOR + encoder.encode(["uint256"], [tokenId]).slice(2);
  var result = await provider.call({
    to: CONTRACT_ADDRESS,
    data: data,
  });
  var decoded = encoder.decode(
    ["(uint256,uint8,uint256,uint256,bool,string)"],
    result
  );
  var struct = decoded[0];
  return {
    startupId: Number(struct[0]),
    rarity: Number(struct[1]),
    multiplier: Number(struct[2]),
    edition: Number(struct[3]),
    isLocked: struct[4],
    name: struct[5],
  };
}

async function main() {
  var provider = new ethers.JsonRpcProvider(RPC_URL);
  var contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

  console.log("=== AttentionX NFT Query ===");
  console.log("Contract: " + CONTRACT_ADDRESS);
  console.log("RPC: " + RPC_URL);
  console.log();

  // Step 1: Determine total supply
  var totalLiving = 0;
  try {
    var supply = await contract.totalSupply();
    totalLiving = Number(supply);
    console.log("totalSupply(): " + totalLiving);
  } catch (e) {
    console.log("totalSupply() not available.");
    totalLiving = 0;
  }
  console.log();

  // Step 2: Scan ALL IDs sequentially with retries
  var scanMax = totalLiving > 0 ? Math.ceil(totalLiving * 2) : 300;
  console.log("Scanning token IDs 0.." + scanMax + " with retry logic...\n");

  var livingTokens = [];
  var burnedOrMissing = [];
  var consecutiveNotExist = 0;

  for (var tokenId = 0; tokenId <= scanMax; tokenId++) {
    var owner = null;
    var exists = false;

    try {
      owner = await retryCall(function () {
        return contract.ownerOf(tokenId);
      }, 3, 500);
      exists = true;
    } catch (err) {
      // Token doesn't exist or was burned
      burnedOrMissing.push(tokenId);
      consecutiveNotExist++;

      // Stop if we found all expected tokens and hit a gap
      if (totalLiving > 0 && livingTokens.length >= totalLiving && consecutiveNotExist > 30) {
        break;
      }
      continue;
    }

    consecutiveNotExist = 0;

    // Get card info with retries
    var cardInfo = null;
    try {
      var tid = tokenId; // capture for closure
      cardInfo = await retryCall(function () {
        return getCardInfo(provider, tid);
      }, 3, 500);
    } catch (cardErr) {
      cardInfo = {
        startupId: -1,
        rarity: -1,
        multiplier: 0,
        edition: 0,
        isLocked: false,
        name: "DECODE_ERROR",
      };
    }

    livingTokens.push({
      tokenId: tokenId,
      startupId: cardInfo.startupId,
      name: cardInfo.name,
      rarity: cardInfo.rarity,
      rarityName: rarityLabel(cardInfo.rarity),
      multiplier: cardInfo.multiplier,
      edition: cardInfo.edition,
      isLocked: cardInfo.isLocked,
      owner: owner,
    });

    if (livingTokens.length % 10 === 0 || livingTokens.length === totalLiving) {
      process.stdout.write("  Found " + livingTokens.length + "/" + totalLiving + " (at ID " + tokenId + ")     \r");
    }

    // Stop early once we have all
    if (totalLiving > 0 && livingTokens.length >= totalLiving) {
      console.log("\n  Found all " + totalLiving + " living tokens (last ID: " + tokenId + ").");
      break;
    }

    // Small delay every 20 tokens to avoid rate limiting
    if (tokenId % 20 === 0 && tokenId > 0) {
      await sleep(200);
    }
  }

  livingTokens.sort(function (a, b) { return a.tokenId - b.tokenId; });

  console.log("\nScan complete. Found " + livingTokens.length + " living tokens.");
  if (burnedOrMissing.length > 0 && burnedOrMissing.length < 20) {
    console.log("Burned/missing IDs: " + burnedOrMissing.join(", "));
  } else if (burnedOrMissing.length > 0) {
    console.log("Burned/missing IDs: " + burnedOrMissing.length + " total");
  }
  console.log();

  if (livingTokens.length === 0) {
    console.log("No tokens found.");
    return;
  }

  // Step 3: Print formatted table
  var header = [
    "TokenID".padEnd(8),
    "StartupID".padEnd(10),
    "Name".padEnd(25),
    "Rarity".padEnd(12),
    "Mult".padEnd(6),
    "Ed".padEnd(4),
    "Lock".padEnd(5),
    "Owner".padEnd(14),
  ].join(" | ");

  var separator = "-".repeat(header.length);

  console.log("=== LIVING NFT TOKENS ===");
  console.log(separator);
  console.log(header);
  console.log(separator);

  for (var i = 0; i < livingTokens.length; i++) {
    var t = livingTokens[i];
    var row = [
      String(t.tokenId).padEnd(8),
      String(t.startupId).padEnd(10),
      t.name.padEnd(25),
      t.rarityName.padEnd(12),
      String(t.multiplier).padEnd(6),
      String(t.edition).padEnd(4),
      (t.isLocked ? "Yes" : "No").padEnd(5),
      shortenAddress(t.owner).padEnd(14),
    ].join(" | ");
    console.log(row);
  }

  console.log(separator);

  // Step 4: Summaries
  console.log("\n=== SUMMARY BY RARITY ===");
  var rarityCounts = {};
  for (var i = 0; i < livingTokens.length; i++) {
    var t = livingTokens[i];
    rarityCounts[t.rarityName] = (rarityCounts[t.rarityName] || 0) + 1;
  }
  var rarityEntries = Object.entries(rarityCounts).sort(function (a, b) { return b[1] - a[1]; });
  for (var i = 0; i < rarityEntries.length; i++) {
    console.log("  " + rarityEntries[i][0].padEnd(12) + ": " + rarityEntries[i][1]);
  }

  console.log("\n=== SUMMARY BY STARTUP ===");
  var startupCounts = {};
  for (var i = 0; i < livingTokens.length; i++) {
    var t = livingTokens[i];
    var key = t.name + " (ID: " + t.startupId + ")";
    startupCounts[key] = (startupCounts[key] || 0) + 1;
  }
  var startupEntries = Object.entries(startupCounts).sort(function (a, b) { return b[1] - a[1]; });
  for (var i = 0; i < startupEntries.length; i++) {
    console.log("  " + startupEntries[i][0].padEnd(35) + ": " + startupEntries[i][1]);
  }

  console.log("\n=== SUMMARY BY OWNER ===");
  var ownerCounts = {};
  for (var i = 0; i < livingTokens.length; i++) {
    var t = livingTokens[i];
    ownerCounts[t.owner] = (ownerCounts[t.owner] || 0) + 1;
  }
  var ownerEntries = Object.entries(ownerCounts).sort(function (a, b) { return b[1] - a[1]; });
  for (var i = 0; i < ownerEntries.length; i++) {
    console.log("  " + shortenAddress(ownerEntries[i][0]).padEnd(14) + " (" + ownerEntries[i][0] + "): " + ownerEntries[i][1] + " tokens");
  }

  // Step 5: Total
  console.log("\n=== TOTAL LIVING TOKENS: " + livingTokens.length + " ===");
}

main().catch(function (err) {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
