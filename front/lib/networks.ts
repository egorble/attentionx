// Network registry — single chain: RISE Testnet

export interface NetworkConfig {
    id: string;
    name: string;
    shortName: string;
    chainId: number;
    rpcUrl: string;
    explorerUrl: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    contracts: {
        AttentionX_NFT: string;
        PackNFT: string;
        PackOpener: string;
        TournamentManager: string;
        MarketplaceV2: string;
    };
    apiBase: string;
    metadataBase: string;   // prefix for metadata server routes
    packPrice: bigint;      // default pack price in wei (avoids RPC call on load)
    icon: string;
    deployed: boolean;
}

export const NETWORKS: Record<string, NetworkConfig> = {
    rise: {
        id: 'rise',
        name: 'RISE Testnet',
        shortName: 'RISE',
        chainId: 11155931,
        rpcUrl: 'https://testnet.riselabs.xyz',
        explorerUrl: 'https://explorer.testnet.riselabs.xyz',
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        contracts: {
            AttentionX_NFT: '0x93faD2BA6C77C1A9853E5b2E1B1714e7BEb1E238',
            PackNFT: '0xF4A09F2AaE4166C850153Ae24C67C1B29865b3e6',
            PackOpener: '0x85C031EbBBf859B2b376622a74D8fEe74753bDC0',
            TournamentManager: '0x59948cdE98f923A4653fBc5A0Fae594EE5a680cB',
            MarketplaceV2: '0xA7f02B767e5E86f70271D3D1D8B73342aC7034DE',
        },
        apiBase: '/api',
        metadataBase: '/metadata',
        packPrice: BigInt('10000000000000000'),    // 0.01 ETH
        icon: '',
        deployed: true,
    },
};

// Module-level active network state — always 'rise'
let _activeId: string = 'rise';

export function getActiveNetwork(): NetworkConfig {
    return NETWORKS[_activeId] || NETWORKS.rise;
}

export function setActiveNetwork(id: string) {
    if (!NETWORKS[id]) return;
    _activeId = id;
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem('attentionx:network', id);
    }
}

export function getActiveNetworkId(): string {
    return _activeId;
}

export function getAllNetworks(): NetworkConfig[] {
    return Object.values(NETWORKS);
}

/** Short currency symbol for the active network (e.g. "ETH") */
export function currencySymbol(): string {
    return getActiveNetwork().nativeCurrency.symbol;
}
