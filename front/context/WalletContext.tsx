// Wallet context with EIP-6963 discovery + WalletConnect for mobile
import React, { createContext, useContext, ReactNode, useEffect, useState, useCallback, useRef } from 'react';
import { BrowserProvider, ethers, Eip1193Provider } from 'ethers';
import { getProvider, getReadProvider, getChainConfig } from '../lib/contracts';
import { getActiveNetwork } from '../lib/networks';
import { useNetwork } from './NetworkContext';
import EthereumProvider from '@walletconnect/ethereum-provider';
import WalletModal, { DetectedWallet } from '../components/WalletModal';

const WC_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '';

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
    disconnect: () => void;
    switchChain: () => Promise<void>;
    getSigner: () => Promise<ethers.Signer | null>;
    refreshBalance: () => void;
    formatAddress: (address: string) => string;
    formatBalance: (wei: bigint, decimals?: number) => string;
    walletProvider: Eip1193Provider | null;
}

const WalletContext = createContext<WalletContextType | null>(null);

const STORAGE_KEY = 'attentionx:wallet:connected';
const WALLET_TYPE_KEY = 'attentionx:wallet:type'; // 'injected:<rdns>' or 'walletconnect'

function formatAddress(address: string): string {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatBalance(wei: bigint, decimals = 4): string {
    const xtz = Number(ethers.formatEther(wei));
    return xtz.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

export function WalletProvider({ children }: { children: ReactNode }) {
    const { activeNetwork } = useNetwork(); // reactive — re-renders when network toggles
    const [address, setAddress] = useState<string | null>(null);
    const [chainId, setChainId] = useState<number | null>(null);
    const [balance, setBalance] = useState<bigint>(0n);
    const [balanceLoading, setBalanceLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isConnecting, setIsConnecting] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [detectedWallets, setDetectedWallets] = useState<DetectedWallet[]>([]);
    const activeProviderRef = useRef<any>(null);
    const wcProviderRef = useRef<InstanceType<typeof EthereumProvider> | null>(null);
    const listenersRef = useRef<{ onAccounts: (a: string[]) => void; onChain: (h: string) => void; onDisconnect: () => void } | null>(null);
    const switchingChainRef = useRef(false); // Guard: ignore disconnect events during chain switch

    const isConnected = !!address;
    const isCorrectChain = chainId === activeNetwork.chainId;

    // Discover wallets via EIP-6963
    useEffect(() => {
        const wallets: DetectedWallet[] = [];
        const handler = (event: any) => {
            const detail = event.detail as DetectedWallet;
            if (!wallets.some(w => w.info.rdns === detail.info.rdns)) {
                wallets.push(detail);
                setDetectedWallets([...wallets]);
            }
        };
        window.addEventListener('eip6963:announceProvider', handler);
        window.dispatchEvent(new Event('eip6963:requestProvider'));
        return () => window.removeEventListener('eip6963:announceProvider', handler);
    }, []);

    // Update balance via read-only JSON-RPC provider (always uses active network's RPC, not wallet chain)
    const updateBalance = useCallback(async (addr: string) => {
        try {
            const provider = getReadProvider();
            const bal = await provider.getBalance(addr);
            setBalance(bal);
        } catch (e) {
        } finally {
            setBalanceLoading(false);
        }
    }, [activeNetwork]);

    // Read chain ID
    const readChainId = useCallback(async (provider: any) => {
        if (!provider) return;
        try {
            const hexChainId = await provider.request({ method: 'eth_chainId' });
            setChainId(parseInt(hexChainId, 16));
        } catch { /* ignore */ }
    }, []);

    // Handle accounts
    const handleAccounts = useCallback((accounts: string[]) => {
        if (accounts.length > 0) {
            setAddress(accounts[0]);
            localStorage.setItem(STORAGE_KEY, 'true');
        } else {
            setAddress(null);
            setBalance(0n);
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(WALLET_TYPE_KEY);
        }
    }, []);

    // Clean up old listeners
    const cleanupListeners = useCallback(() => {
        if (listenersRef.current && activeProviderRef.current) {
            activeProviderRef.current.removeListener?.('accountsChanged', listenersRef.current.onAccounts);
            activeProviderRef.current.removeListener?.('chainChanged', listenersRef.current.onChain);
            activeProviderRef.current.removeListener?.('disconnect', listenersRef.current.onDisconnect);
        }
        listenersRef.current = null;
    }, []);

    // Set up event listeners on a provider
    const setupListeners = useCallback((provider: any) => {
        cleanupListeners();

        const onAccounts = (accounts: string[]) => handleAccounts(accounts);
        const onChain = (hexChainId: string) => setChainId(parseInt(typeof hexChainId === 'string' ? hexChainId : String(hexChainId), 16));
        const onDisconnect = () => {
            // Some wallets emit 'disconnect' during wallet_switchEthereumChain — ignore it
            if (switchingChainRef.current) return;
            setAddress(null);
            setBalance(0n);
            setChainId(null);
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(WALLET_TYPE_KEY);
        };

        provider.on?.('accountsChanged', onAccounts);
        provider.on?.('chainChanged', onChain);
        provider.on?.('disconnect', onDisconnect);

        listenersRef.current = { onAccounts, onChain, onDisconnect };
        activeProviderRef.current = provider;
    }, [handleAccounts, cleanupListeners]);

    // Open connect modal
    const connect = useCallback(() => {
        setError(null);
        setShowModal(true);
    }, []);

    // Connect with injected wallet (EIP-6963 or window.ethereum)
    const connectInjected = useCallback(async (provider: any, rdns: string) => {
        setIsConnecting(true);
        setError(null);
        try {
            const accounts = await provider.request({ method: 'eth_requestAccounts' });
            setupListeners(provider);
            localStorage.setItem(WALLET_TYPE_KEY, `injected:${rdns}`);
            handleAccounts(accounts);
            await readChainId(provider);
            setShowModal(false);
        } catch (e: any) {
            if (e.code === 4001) {
                setError('Connection rejected');
            } else {
                setError(e.message || 'Failed to connect');
            }
        } finally {
            setIsConnecting(false);
        }
    }, [handleAccounts, readChainId, setupListeners]);

    // Connect with WalletConnect
    const connectWalletConnect = useCallback(async () => {
        if (!WC_PROJECT_ID) {
            setError('WalletConnect project ID not configured');
            return;
        }
        setIsConnecting(true);
        setError(null);
        try {
            const net = getActiveNetwork();
            const wcProvider = await EthereumProvider.init({
                projectId: WC_PROJECT_ID,
                chains: [net.chainId],
                rpcMap: { [net.chainId]: net.rpcUrl },
                showQrModal: true,
                metadata: {
                    name: 'AttentionX',
                    description: 'Fantasy YC Trading Card Game',
                    url: window.location.origin,
                    icons: [`${window.location.origin}/attentionx.png`],
                },
            });

            wcProviderRef.current = wcProvider;
            await wcProvider.connect();

            setupListeners(wcProvider);
            localStorage.setItem(WALLET_TYPE_KEY, 'walletconnect');

            const accounts = wcProvider.accounts;
            handleAccounts(accounts);
            setChainId(wcProvider.chainId);
            setShowModal(false);
        } catch (e: any) {
            if (e.message?.includes('User rejected') || e.code === 4001) {
                setError('Connection rejected');
            } else {
                setError(e.message || 'Failed to connect');
            }
        } finally {
            setIsConnecting(false);
        }
    }, [handleAccounts, setupListeners]);

    // Disconnect
    const disconnect = useCallback(async () => {
        cleanupListeners();
        // Disconnect WC session if active
        if (wcProviderRef.current) {
            try { await wcProviderRef.current.disconnect(); } catch { /* ignore */ }
            wcProviderRef.current = null;
        }
        activeProviderRef.current = null;
        setAddress(null);
        setBalance(0n);
        setChainId(null);
        setError(null);
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(WALLET_TYPE_KEY);
    }, [cleanupListeners]);

    // Switch chain (uses active network config dynamically)
    const switchChain = useCallback(async () => {
        const provider = activeProviderRef.current || (window as any)?.ethereum;
        if (!provider) return;
        const net = getActiveNetwork();
        const hexChainId = '0x' + net.chainId.toString(16);

        // Skip if wallet is already on the target chain
        try {
            const currentHex = await provider.request({ method: 'eth_chainId' });
            if (parseInt(currentHex, 16) === net.chainId) {
                setChainId(net.chainId);
                return;
            }
        } catch { /* proceed with switch */ }

        // Guard: some wallets emit 'disconnect' during chain switch — suppress it
        switchingChainRef.current = true;
        try {
            // Try switch first (works when chain is already in wallet)
            await provider.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: hexChainId }],
            });
        } catch (switchError: any) {
            // User rejected — don't do anything
            if (switchError.code === 4001) {
                // noop
            }
            // 4902 = chain not in wallet → need to add it.
            // Some wallets (OKX) also throw -32603 or other codes — check inner error too.
            else {
                const innerCode = switchError?.data?.originalError?.code ?? switchError?.data?.code;
                const is4902 = switchError.code === 4902 || innerCode === 4902;

                if (is4902) {
                    try {
                        await provider.request({
                            method: 'wallet_addEthereumChain',
                            params: [{
                                chainId: hexChainId,
                                chainName: net.name,
                                nativeCurrency: net.nativeCurrency,
                                rpcUrls: [net.rpcUrl],
                                blockExplorerUrls: [net.explorerUrl],
                            }],
                        });
                    } catch { /* user rejected or wallet error */ }
                }
                // Any other error code: wallet knows the chain but has a quirk — ignore
            }
        } finally {
            // Release guard after a short delay (disconnect events may fire async)
            setTimeout(() => { switchingChainRef.current = false; }, 2000);
        }
        // Always sync chain ID state from wallet
        await readChainId(provider);
    }, [readChainId]);

    // Get signer
    const getSigner = useCallback(async (): Promise<ethers.Signer | null> => {
        const provider = activeProviderRef.current || (window as any)?.ethereum;
        if (!provider || !isConnected) return null;
        try {
            const browserProvider = new BrowserProvider(provider as Eip1193Provider);
            return await browserProvider.getSigner();
        } catch (e) {
            return null;
        }
    }, [isConnected]);

    const refreshBalance = useCallback(() => {
        if (address) updateBalance(address);
    }, [address, updateBalance]);

    // Auto-reconnect
    useEffect(() => {
        const wasConnected = localStorage.getItem(STORAGE_KEY);
        if (!wasConnected) return;

        const savedType = localStorage.getItem(WALLET_TYPE_KEY);

        // WalletConnect auto-reconnect
        if (savedType === 'walletconnect' && WC_PROJECT_ID) {
            const net = getActiveNetwork();
            EthereumProvider.init({
                projectId: WC_PROJECT_ID,
                chains: [net.chainId],
                rpcMap: { [net.chainId]: net.rpcUrl },
                showQrModal: false,
                metadata: {
                    name: 'AttentionX',
                    description: 'Fantasy YC Trading Card Game',
                    url: window.location.origin,
                    icons: [`${window.location.origin}/attentionx.png`],
                },
            }).then(wcProvider => {
                if (wcProvider.session) {
                    wcProviderRef.current = wcProvider;
                    setupListeners(wcProvider);
                    handleAccounts(wcProvider.accounts);
                    setChainId(wcProvider.chainId);
                } else {
                    localStorage.removeItem(STORAGE_KEY);
                    localStorage.removeItem(WALLET_TYPE_KEY);
                }
            }).catch(() => { });
            return;
        }

        // Injected wallet auto-reconnect
        const timer = setTimeout(() => {
            let provider: any = null;

            if (savedType?.startsWith('injected:')) {
                const rdns = savedType.replace('injected:', '');
                if (rdns !== 'injected') {
                    const wallet = detectedWallets.find(w => w.info.rdns === rdns);
                    if (wallet) provider = wallet.provider;
                }
            }

            if (!provider && (window as any)?.ethereum) {
                provider = (window as any).ethereum;
            }

            if (!provider) return;

            provider.request({ method: 'eth_accounts' })
                .then(async (accounts: string[]) => {
                    if (accounts.length > 0) {
                        setupListeners(provider);
                        handleAccounts(accounts);
                        await readChainId(provider);
                        // Auto-switch to correct chain if wallet is on wrong network
                        const net = getActiveNetwork();
                        try {
                            const currentHex = await provider.request({ method: 'eth_chainId' });
                            if (parseInt(currentHex, 16) !== net.chainId) {
                                const hexChainId = '0x' + net.chainId.toString(16);
                                try {
                                    await provider.request({
                                        method: 'wallet_switchEthereumChain',
                                        params: [{ chainId: hexChainId }],
                                    });
                                } catch (switchErr: any) {
                                    if (switchErr.code === 4902 || switchErr?.data?.originalError?.code === 4902) {
                                        await provider.request({
                                            method: 'wallet_addEthereumChain',
                                            params: [{
                                                chainId: hexChainId,
                                                chainName: net.name,
                                                nativeCurrency: net.nativeCurrency,
                                                rpcUrls: [net.rpcUrl],
                                                blockExplorerUrls: [net.explorerUrl],
                                            }],
                                        }).catch(() => {});
                                    }
                                }
                                await readChainId(provider);
                            }
                        } catch { /* ignore */ }
                    } else {
                        localStorage.removeItem(STORAGE_KEY);
                        localStorage.removeItem(WALLET_TYPE_KEY);
                    }
                })
                .catch(() => { });
        }, 150);

        return () => clearTimeout(timer);
    }, [detectedWallets, handleAccounts, readChainId, setupListeners]);

    // Balance polling (restarts when network or address changes)
    useEffect(() => {
        if (address) {
            setBalance(0n);
            setBalanceLoading(true);
            updateBalance(address);
            const interval = setInterval(() => updateBalance(address), 10000);
            return () => clearInterval(interval);
        } else {
            setBalance(0n);
            setBalanceLoading(false);
        }
    }, [address, updateBalance, activeNetwork]);

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
        disconnect,
        switchChain,
        getSigner,
        refreshBalance,
        formatAddress,
        formatBalance,
        walletProvider: (activeProviderRef.current || null) as Eip1193Provider | null,
    };

    return (
        <WalletContext.Provider value={value}>
            {children}
            <WalletModal
                isOpen={showModal}
                onClose={() => { setShowModal(false); setIsConnecting(false); }}
                wallets={detectedWallets}
                onSelectInjected={connectInjected}
                onSelectWalletConnect={connectWalletConnect}
                isConnecting={isConnecting}
                hasWalletConnect={!!WC_PROJECT_ID}
            />
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
