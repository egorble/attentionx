/**
 * AttentionX Server Configuration
 * Single source of truth for all contract addresses and chain config.
 * Both server/index.js and server/jobs/daily-scorer.js import from here.
 * When contracts are redeployed, update ONLY this file and restart the server.
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load admin key from scripts/.env (for tournament finalization)
function loadAdminKey() {
    if (process.env.ADMIN_PRIVATE_KEY) return process.env.ADMIN_PRIVATE_KEY;
    const envPath = join(__dirname, '..', 'scripts', '.env');
    if (existsSync(envPath)) {
        const content = readFileSync(envPath, 'utf-8');
        const match = content.match(/PRIVATE_KEY=(.+)/);
        if (match) return match[1].trim();
    }
    return null;
}

export const ADMIN_PRIVATE_KEY = loadAdminKey();

// Load admin API key (for HTTP endpoint auth, separate from blockchain signing key)
function loadAdminApiKey() {
    if (process.env.ADMIN_API_KEY) return process.env.ADMIN_API_KEY;
    const envPath = join(__dirname, '..', 'scripts', '.env');
    if (existsSync(envPath)) {
        const content = readFileSync(envPath, 'utf-8');
        const match = content.match(/ADMIN_API_KEY=(.+)/);
        if (match) return match[1].trim();
    }
    return null;
}

export const ADMIN_API_KEY = loadAdminApiKey();

// Load all security env vars from scripts/.env into process.env
function loadEnvVars() {
    const envPath = join(__dirname, '..', 'scripts', '.env');
    if (!existsSync(envPath)) return;
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const key = line.substring(0, eq).trim();
        const val = line.substring(eq + 1).trim();
        if (!process.env[key]) process.env[key] = val;
    }
}
loadEnvVars();

// Single chain: RISE Testnet
const CHAIN_CONFIGS = {
    rise: {
        RPC_URL: 'https://testnet.riselabs.xyz',
        CHAIN_ID: 11155931,
        EXPLORER: 'https://explorer.testnet.riselabs.xyz',
        SERVER_PORT: 3007,
    },
};

const CONTRACT_CONFIGS = {
    rise: {
        UnicornX_NFT: '0xd75293a06Ebce94a3A2C07431fC3f2CF16eaE304',
        PackOpener: '0x3676c7D4f9C04C9e225d1F589921F6afc0Af4BFC',
        TournamentManager: '0x70d8596574223719341f6DDf334B5C486f82a1D6',
        MarketplaceV2: '0x606d031ca8477Ece0b074F8af4E1b3464e250225',
    },
};

export const NETWORK_NAME = process.env.CHAIN_NETWORK || 'rise';
export const CHAIN = CHAIN_CONFIGS[NETWORK_NAME] || CHAIN_CONFIGS.rise;
export const CONTRACTS = CONTRACT_CONFIGS[NETWORK_NAME] || CONTRACT_CONFIGS.rise;

// DB filename
export const DB_FILENAME = 'attentionx.db';

// Expose all network configs for the unified scorer
export { CHAIN_CONFIGS, CONTRACT_CONFIGS };

/** All supported network IDs */
export const ALL_NETWORKS = Object.keys(CHAIN_CONFIGS);

/** Get absolute DB path for a given network */
export function dbPathForNetwork(networkName) {
    return join(__dirname, 'db', 'attentionx.db');
}

/** Get schema.sql path */
export function schemaPath() {
    return join(__dirname, 'db', 'schema.sql');
}
