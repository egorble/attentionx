// Wallet context — supports both Privy and RISE Wallet (wagmi)
import React, { createContext, useContext, ReactNode, useEffect, useState, useCallback, useRef } from 'react';
import { BrowserProvider, ethers, Eip1193Provider } from 'ethers';
import { getReadProvider } from '../lib/contracts';
import { getActiveNetwork } from '../lib/networks';
import { useNetwork } from './NetworkContext';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useAccount, useConnect, useDisconnect, useConnectors, useSignMessage } from 'wagmi';
import { RISE_CONNECTOR_ID } from '../lib/wagmiConfig';

// ── Interface ─────────────────────────────────────────────────────────────────

interface WalletContextType {
    isConnected: boolean;
    address: string | null;
    balance: bigint;
    balanceLoading: boolean;
    chainId: number | null;
    isCorrectChain: boolean;
    isConnecting: boolean;
    error: string | null;
    connect: () => void;
    connectRiseWallet: () => void;
    disconnect: () => void;
    switchChain: () => Promise<void>;
    getSigner: () => Promise<ethers.Signer | null>;
    signMessage: (message: string) => Promise<string | null>;
    refreshBalance: () => void;
    formatAddress: (address: string) => string;
    formatBalance: (wei: bigint, decimals?: number) => string;
    walletProvider: Eip1193Provider | null;
}

const WalletContext = createContext<WalletContextType | null>(null);

// ── Pure helpers ──────────────────────────────────────────────────────────────

function formatAddress(address: string): string {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatBalance(wei: bigint, decimals = 4): string {
    const eth = Number(ethers.formatEther(wei));
    return eth.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
}

function parseCaip2ChainId(caip2: string | undefined): number | null {
    if (!caip2) return null;
    const parts = caip2.split(':');
    const n = parseInt(parts[parts.length - 1]);
    return isNaN(n) ? null : n;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: ReactNode }) {
    const { activeNetwork } = useNetwork();

    // ── Privy state ───────────────────────────────────────────────────────────
    const { ready, authenticated: privyAuthenticated, login, logout: privyLogout } = usePrivy();
    const { wallets } = useWallets();
    const privyWallet = wallets[0] ?? null;

    // ── RISE Wallet (wagmi) state ─────────────────────────────────────────────
    const { address: riseAddress, isConnected: riseIsConnected, connector: riseConnector, chainId: riseChainId } = useAccount();
    const { connect: wagmiConnect } = useConnect();
    const { disconnect: wagmiDisconnect } = useDisconnect();
    const connectors = useConnectors();
    const { signMessageAsync: wagmiSignMessage } = useSignMessage();

    // ── Local state ───────────────────────────────────────────────────────────
    const [walletProvider, setWalletProvider] = useState<Eip1193Provider | null>(null);
    const [privyChainId, setPrivyChainId] = useState<number | null>(null);
    const [balance, setBalance] = useState<bigint>(0n);
    const [balanceLoading, setBalanceLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const chainListenerRef = useRef<((hex: string) => void) | null>(null);
    const prevProviderRef = useRef<any>(null);

    // ── Derived state — RISE Wallet takes priority over Privy ─────────────────
    const address: string | null = riseIsConnected ? (riseAddress ?? null) : (privyWallet?.address ?? null);
    const isConnected = riseIsConnected || (privyAuthenticated && !!privyWallet);
    const isConnecting = !ready && !riseIsConnected;
    const chainId = riseIsConnected ? (riseChainId ?? null) : privyChainId;
    const isCorrectChain = chainId === activeNetwork.chainId;

    // ── RISE Wallet: sync EIP-1193 provider ───────────────────────────────────
    useEffect(() => {
        if (!riseIsConnected || !riseConnector) {
            // Clear stale provider when RISE disconnects
            if (!riseIsConnected) setWalletProvider(null);
            return;
        }
        // Clear potentially stale Privy provider immediately
        setWalletProvider(null);
        let cancelled = false;
        const fetchProvider = async () => {
            try {
                const eip1193 = await (riseConnector as any).getProvider();
                if (!cancelled && eip1193) {
                    setWalletProvider(eip1193 as Eip1193Provider);
                }
            } catch { /* connector doesn't expose getProvider */ }
        };
        fetchProvider();
        return () => { cancelled = true; };
    }, [riseIsConnected, riseConnector?.id]);

    // ── Privy: sync EIP-1193 provider (only when RISE not active) ─────────────
    useEffect(() => {
        if (riseIsConnected) return; // RISE Wallet takes precedence

        if (!privyWallet) {
            if (prevProviderRef.current && chainListenerRef.current) {
                prevProviderRef.current.removeListener?.('chainChanged', chainListenerRef.current);
            }
            setWalletProvider(null);
            setPrivyChainId(null);
            return;
        }

        let cancelled = false;

        privyWallet.getEthereumProvider().then(eip1193 => {
            if (cancelled) return;

            if (prevProviderRef.current && chainListenerRef.current) {
                prevProviderRef.current.removeListener?.('chainChanged', chainListenerRef.current);
            }

            setPrivyChainId(parseCaip2ChainId(privyWallet.chainId));

            const onChain = (hex: string) => {
                setPrivyChainId(parseInt(typeof hex === 'string' ? hex : String(hex), 16));
            };
            eip1193.on?.('chainChanged', onChain);
            chainListenerRef.current = onChain;
            prevProviderRef.current = eip1193;

            setWalletProvider(eip1193 as Eip1193Provider);
        }).catch(() => {
            if (!cancelled) setWalletProvider(null);
        });

        return () => { cancelled = true; };
    }, [privyWallet?.address, riseIsConnected]);

    // ── Balance polling ───────────────────────────────────────────────────────
    const updateBalance = useCallback(async (addr: string) => {
        try {
            const provider = getReadProvider();
            const bal = await provider.getBalance(addr);
            setBalance(bal);
        } catch {
            // keep previous balance on error
        } finally {
            setBalanceLoading(false);
        }
    }, [activeNetwork]);

    useEffect(() => {
        if (!address) {
            setBalance(0n);
            setBalanceLoading(false);
            return;
        }
        setBalance(0n);
        setBalanceLoading(true);
        updateBalance(address);
        const interval = setInterval(() => updateBalance(address), 10_000);
        return () => clearInterval(interval);
    }, [address, updateBalance, activeNetwork]);

    const refreshBalance = useCallback(() => {
        if (address) updateBalance(address);
    }, [address, updateBalance]);

    // ── Connect via Privy ─────────────────────────────────────────────────────
    const connect = useCallback(() => {
        setError(null);
        login();
    }, [login]);

    // ── Connect via RISE Wallet ───────────────────────────────────────────────
    const connectRiseWallet = useCallback(() => {
        setError(null);
        const riseConnectorInst = connectors.find(c => c.id === RISE_CONNECTOR_ID);
        if (riseConnectorInst) {
            wagmiConnect({ connector: riseConnectorInst });
        }
    }, [wagmiConnect, connectors]);

    // ── Disconnect both ───────────────────────────────────────────────────────
    const disconnect = useCallback(async () => {
        setError(null);
        if (riseIsConnected) wagmiDisconnect();
        if (privyAuthenticated) await privyLogout();
    }, [riseIsConnected, wagmiDisconnect, privyAuthenticated, privyLogout]);

    // ── Switch chain ──────────────────────────────────────────────────────────
    const switchChain = useCallback(async () => {
        const net = getActiveNetwork();

        // RISE Wallet: use wagmi switchChain via the provider
        if (riseIsConnected && walletProvider) {
            try {
                const hexChainId = '0x' + net.chainId.toString(16);
                await walletProvider.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: hexChainId }],
                });
                return;
            } catch { /* ignore, chain may already match */ }
        }

        if (!privyWallet) return;
        try {
            await privyWallet.switchChain(net.chainId);
            setPrivyChainId(net.chainId);
        } catch {
            const eip1193 = walletProvider;
            if (!eip1193) return;
            const hexChainId = '0x' + net.chainId.toString(16);
            try {
                await eip1193.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: hexChainId,
                        chainName: net.name,
                        nativeCurrency: net.nativeCurrency,
                        rpcUrls: [net.rpcUrl],
                        blockExplorerUrls: [net.explorerUrl],
                    }],
                });
                await privyWallet.switchChain(net.chainId);
                setPrivyChainId(net.chainId);
            } catch { /* user rejected */ }
        }
    }, [riseIsConnected, privyWallet, walletProvider]);

    // ── signMessage — wallet-aware message signing ────────────────────────────
    // For RISE Wallet uses wagmi's signMessageAsync (routes through the connector
    // directly, no need to obtain an EIP-1193 provider manually).
    // For Privy falls back to the embedded wallet signer.
    const signMessage = useCallback(async (message: string): Promise<string | null> => {
        if (riseIsConnected) {
            try {
                return await wagmiSignMessage({ message });
            } catch {
                return null;
            }
        }
        if (!privyWallet) return null;
        try {
            const eip1193 = await privyWallet.getEthereumProvider();
            const signer = await new BrowserProvider(eip1193 as any).getSigner();
            return await signer.signMessage(message);
        } catch {
            return null;
        }
    }, [riseIsConnected, wagmiSignMessage, privyWallet]);

    // ── getSigner (with retry — provider may lag behind isConnected) ─────────
    const getSignerOnce = useCallback(async (): Promise<ethers.Signer | null> => {
        // When RISE Wallet is active — NEVER fall through to Privy.
        if (riseIsConnected) {
            // Try cached walletProvider first
            if (walletProvider) {
                try {
                    return await new BrowserProvider(walletProvider as any).getSigner();
                } catch { /* try direct below */ }
            }
            // walletProvider may not be cached yet — ask connector directly
            if (riseConnector) {
                try {
                    const eip1193 = await (riseConnector as any).getProvider();
                    if (eip1193) return await new BrowserProvider(eip1193 as any).getSigner();
                } catch { /* connector doesn't expose provider */ }
            }
            return null;
        }
        if (!privyWallet) return null;
        try {
            const eip1193 = await privyWallet.getEthereumProvider();
            return await new BrowserProvider(eip1193 as any).getSigner();
        } catch {
            return null;
        }
    }, [riseIsConnected, walletProvider, riseConnector, privyWallet]);

    const getSigner = useCallback(async (): Promise<ethers.Signer | null> => {
        // First attempt
        const signer = await getSignerOnce();
        if (signer) return signer;
        // Provider may not be ready yet (Privy async init) — retry after short delay
        await new Promise(r => setTimeout(r, 600));
        return getSignerOnce();
    }, [getSignerOnce]);

    // ── Context value ─────────────────────────────────────────────────────────
    const value: WalletContextType = {
        isConnected,
        address,
        balance,
        balanceLoading,
        chainId,
        isCorrectChain,
        isConnecting,
        error,
        connect,
        connectRiseWallet,
        disconnect,
        switchChain,
        getSigner,
        signMessage,
        refreshBalance,
        formatAddress,
        formatBalance,
        walletProvider,
    };

    return (
        <WalletContext.Provider value={value}>
            {children}
        </WalletContext.Provider>
    );
}

export function useWalletContext() {
    const context = useContext(WalletContext);
    if (!context) {
        throw new Error('useWalletContext must be used within WalletProvider');
    }
    return context;
}
