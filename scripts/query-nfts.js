const { ethers } = require('ethers');

const RPC_URL = 'https://testnet.riselabs.xyz';
const CONTRACT_ADDRESS = '0x35066391f772dcb7C13A0a94E721d2A91F85FBC3';

const ABI = [
  'function totalSupply() external view returns (uint256)',
  'function getCardInfo(uint256 tokenId) external view returns (tuple(uint256 startupId, uint256 edition, uint8 rarity, uint256 multiplier, bool isLocked, string name))',
  'function ownerOf(uint256 tokenId) external view returns (address)',
];

const RARITY_NAMES = ['Common', 'Rare', 'Epic', 'EpicRare', 'Legendary'];

function shortenAddress(addr) {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function queryToken(contract, id, retries) {
  retries = retries || 2;
  for (var attempt = 0; attempt <= retries; attempt++) {
    try {
      var results = await Promise.all([
        contract.getCardInfo(id),
        contract.ownerOf(id),
      ]);
      var cardInfo = results[0];
      var owner = results[1];
      var rarityName = RARITY_NAMES[Number(cardInfo.rarity)] || 'Unknown';
      return {
        tokenId: id,
        startupId: Number(cardInfo.startupId),
        name: cardInfo.name,
        rarity: rarityName,
        multiplier: Number(cardInfo.multiplier),
        edition: Number(cardInfo.edition),
        isLocked: cardInfo.isLocked,
        owner: owner,
      };
    } catch (err) {
      if (err.code === 'CALL_EXCEPTION' && err.data && err.data.length > 2) {
        return null;
      }
      if (attempt < retries) {
        await sleep(300);
      } else {
        return null;
      }
    }
  }
  return null;
}

async function main() {
  var provider = new ethers.JsonRpcProvider(RPC_URL);
  var contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

  console.log('Querying AttentionX_NFT contract:', CONTRACT_ADDRESS);
  console.log('RPC:', RPC_URL);
  console.log('');

  var totalSupply = Number(await contract.totalSupply());
  console.log('Total living tokens (totalSupply):', totalSupply);

  var MAX_SCAN = totalSupply * 2 + 20;
  console.log('Scanning token IDs 1 to', MAX_SCAN);
  console.log('');

  var tokens = [];
  var rarityCounts = { Common: 0, Rare: 0, Epic: 0, EpicRare: 0, Legendary: 0 };
  var burnedCount = 0;
  var BATCH_SIZE = 3;

  for (var batchStart = 1; batchStart <= MAX_SCAN; batchStart += BATCH_SIZE) {
    var batchEnd = Math.min(batchStart + BATCH_SIZE - 1, MAX_SCAN);
    var promises = [];

    for (var tokenId = batchStart; tokenId <= batchEnd; tokenId++) {
      promises.push(queryToken(contract, tokenId));
    }

    var batchResults = await Promise.all(promises);
    for (var i = 0; i < batchResults.length; i++) {
      if (batchResults[i]) {
        tokens.push(batchResults[i]);
        rarityCounts[batchResults[i].rarity] = (rarityCounts[batchResults[i].rarity] || 0) + 1;
      } else {
        burnedCount++;
      }
    }

    if (tokens.length >= totalSupply) {
      var maxFound = Math.max.apply(null, tokens.map(function(t) { return t.tokenId; }));
      if (batchEnd > maxFound + 15) {
        break;
      }
    }

    await sleep(150);
  }

  tokens.sort(function(a, b) { return a.tokenId - b.tokenId; });

  console.log('='.repeat(110));
  console.log(
    'TokenID'.padEnd(9) +
    'Name'.padEnd(25) +
    'Rarity'.padEnd(12) +
    'Mult'.padEnd(7) +
    'Edition'.padEnd(9) +
    'Locked'.padEnd(8) +
    'StartupID'.padEnd(11) +
    'Owner'
  );
  console.log('-'.repeat(110));

  for (var j = 0; j < tokens.length; j++) {
    var t = tokens[j];
    console.log(
      String(t.tokenId).padEnd(9) +
      t.name.slice(0, 23).padEnd(25) +
      t.rarity.padEnd(12) +
      (t.multiplier + 'x').padEnd(7) +
      String(t.edition).padEnd(9) +
      (t.isLocked ? 'YES' : 'no').padEnd(8) +
      String(t.startupId).padEnd(11) +
      shortenAddress(t.owner)
    );
  }

  console.log('='.repeat(110));
  console.log('');

  console.log('--- Summary ---');
  console.log('Total living tokens:', tokens.length);
  console.log('Burned/non-existent IDs:', burnedCount);
  if (tokens.length > 0) {
    console.log('Token ID range:', tokens[0].tokenId, '-', tokens[tokens.length - 1].tokenId);
  }
  console.log('');
  console.log('By rarity:');
  var rarities = Object.keys(rarityCounts);
  for (var k = 0; k < rarities.length; k++) {
    if (rarityCounts[rarities[k]] > 0) {
      console.log('  ' + rarities[k] + ': ' + rarityCounts[rarities[k]]);
    }
  }

  var ownerSet = {};
  var ownerCounts = {};
  for (var m = 0; m < tokens.length; m++) {
    ownerSet[tokens[m].owner.toLowerCase()] = true;
    ownerCounts[tokens[m].owner] = (ownerCounts[tokens[m].owner] || 0) + 1;
  }
  console.log('');
  console.log('Unique owners:', Object.keys(ownerSet).length);
  console.log('');
  console.log('Owners breakdown:');
  var sorted = Object.entries(ownerCounts).sort(function(a, b) { return b[1] - a[1]; });
  for (var n = 0; n < sorted.length; n++) {
    console.log('  ' + shortenAddress(sorted[n][0]) + ' (' + sorted[n][0] + '): ' + sorted[n][1] + ' tokens');
  }
}

main().catch(function(err) {
  console.error('Fatal error:', err.message);
  process.exit(1);
});