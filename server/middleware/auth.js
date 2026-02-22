/**
 * Authentication & validation middleware for AttentionX API.
 * - Wallet signature verification (proves wallet ownership)
 * - Admin API key authentication
 * - Input validators
 */

import { ethers } from 'ethers';

/**
 * Middleware: verifies wallet signature on write requests.
 * Expects body: { address, signature, message }
 * Message format: "Welcome to AttentionX! Have fun!\n\nWallet: <address>\nTimestamp: <ts>"
 * Timestamp must be within 5 minutes. Recovered signer must match claimed address.
 */
export function verifyWalletSignature(req, res, next) {
    try {
        const { address, signature, message } = req.body;

        if (!address || !signature || !message) {
            return res.status(401).json({
                success: false,
                error: 'Missing address, signature, or message'
            });
        }

        if (!isValidAddress(address)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid Ethereum address format'
            });
        }

        // Parse message — extract Wallet and Timestamp lines
        const walletMatch = message.match(/Wallet:\s*(0x[0-9a-fA-F]{40})/);
        const timestampMatch = message.match(/Timestamp:\s*(\d+)/);

        if (!walletMatch || !timestampMatch) {
            return res.status(401).json({
                success: false,
                error: 'Invalid message format'
            });
        }

        const msgAddress = walletMatch[1];
        const timestamp = parseInt(timestampMatch[1], 10);

        // Address in message must match claimed address
        if (msgAddress.toLowerCase() !== address.toLowerCase()) {
            return res.status(401).json({
                success: false,
                error: 'Address mismatch in signed message'
            });
        }

        // Timestamp within 5 minutes
        const now = Math.floor(Date.now() / 1000);
        if (isNaN(timestamp) || Math.abs(now - timestamp) > 300) {
            return res.status(401).json({
                success: false,
                error: 'Signature expired (>5 minutes old)'
            });
        }

        // Verify signature
        const recoveredAddress = ethers.verifyMessage(message, signature);
        if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
            return res.status(401).json({
                success: false,
                error: 'Signature verification failed'
            });
        }

        req.verifiedAddress = address.toLowerCase();
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            error: 'Signature verification error'
        });
    }
}

/**
 * Middleware: checks X-Admin-Key header against ADMIN_API_KEY env var.
 */
export function requireAdmin(req, res, next) {
    const adminKey = process.env.ADMIN_API_KEY;

    if (!adminKey) {
        return res.status(503).json({
            success: false,
            error: 'Admin authentication not configured'
        });
    }

    const providedKey = req.headers['x-admin-key'];
    if (!providedKey || providedKey !== adminKey) {
        return res.status(403).json({
            success: false,
            error: 'Invalid or missing admin key'
        });
    }

    next();
}

// ============ Validators ============

export function isValidAddress(address) {
    return typeof address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(address);
}

export function isValidTournamentId(id) {
    const n = parseInt(id, 10);
    return Number.isInteger(n) && n > 0;
}

export function isValidDate(date) {
    return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date));
}

export function isValidUsername(username) {
    return typeof username === 'string'
        && username.length >= 3
        && username.length <= 20
        && /^[a-zA-Z0-9_\-. ]+$/.test(username);
}
