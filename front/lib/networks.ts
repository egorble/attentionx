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
        UnicornX_NFT: string;
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
            UnicornX_NFT: '0xd75293a06Ebce94a3A2C07431fC3f2CF16eaE304',
            PackOpener: '0x3676c7D4f9C04C9e225d1F589921F6afc0Af4BFC',
            TournamentManager: '0x70d8596574223719341f6DDf334B5C486f82a1D6',
            MarketplaceV2: '0x606d031ca8477Ece0b074F8af4E1b3464e250225',
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
