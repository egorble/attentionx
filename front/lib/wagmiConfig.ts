// Wagmi config for RISE Wallet connector
import { Chains } from 'rise-wallet';
import { riseWallet } from 'rise-wallet/wagmi';
import { createConfig, http } from 'wagmi';

export const RISE_CONNECTOR_ID = 'com.risechain.wallet';

export const rwConnector = riseWallet();

export const wagmiConfig = createConfig({
    chains: [Chains.all[0]], // RISE Testnet
    connectors: [rwConnector],
    transports: {
        [Chains.all[0].id]: http('https://testnet.riselabs.xyz'),
    },
});
