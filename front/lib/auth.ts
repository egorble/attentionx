import { ethers } from 'ethers';

/**
 * Create a signed auth payload for API requests.
 * Human-readable message shown in wallet, with embedded auth data.
 * The backend verifies the signature to prove wallet ownership.
 */
export async function createSignedAuth(
    signer: ethers.Signer,
    address: string
): Promise<{ message: string; signature: string }> {
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `Welcome to AttentionX! Have fun!\n\nWallet: ${address.toLowerCase()}\nTimestamp: ${timestamp}`;
    const signature = await signer.signMessage(message);
    return { message, signature };
}
