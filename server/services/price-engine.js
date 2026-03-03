/**
 * Price Engine — connects to RISEx WebSocket for real-time token prices.
 *
 * Architecture:
 * - Primary: WebSocket orderbook subscription → mid-price = (best_bid + best_ask) / 2
 * - Fallback: REST poll /v1/markets every 10s if WS is disconnected
 * - Emits 'price-update' on EventEmitter when any price changes
 *
 * Usage:
 *   import { priceEngine } from './price-engine.js';
 *   priceEngine.start();
 *   const prices = priceEngine.getPrices(); // { 1: { price, change24h, symbol }, ... }
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// All 25 RISEx markets → token IDs for Token Leagues
const TOKENS = [
    { id: 1,  symbol: 'BTC',   marketId: 1  },
    { id: 2,  symbol: 'ETH',   marketId: 2  },
    { id: 3,  symbol: 'BNB',   marketId: 3  },
    { id: 4,  symbol: 'SOL',   marketId: 4  },
    { id: 5,  symbol: 'DOGE',  marketId: 5  },
    { id: 6,  symbol: 'XRP',   marketId: 6  },
    { id: 7,  symbol: 'LINK',  marketId: 7  },
    { id: 8,  symbol: 'ZEC',   marketId: 8  },
    { id: 9,  symbol: 'LTC',   marketId: 9  },
    { id: 10, symbol: 'AAVE',  marketId: 10 },
    { id: 11, symbol: 'TAO',   marketId: 11 },
    { id: 12, symbol: 'PUMP',  marketId: 12 },
    { id: 13, symbol: 'PENGU', marketId: 13 },
    { id: 14, symbol: 'PEPE',  marketId: 14 },
    { id: 15, symbol: 'HYPE',  marketId: 15 },
    { id: 16, symbol: 'XMR',   marketId: 16 },
    { id: 17, symbol: 'MNT',   marketId: 17 },
    { id: 18, symbol: 'SPY',   marketId: 18 },
    { id: 19, symbol: 'TSLA',  marketId: 19 },
    { id: 20, symbol: 'COIN',  marketId: 20 },
    { id: 21, symbol: 'HOOD',  marketId: 21 },
    { id: 22, symbol: 'NVDA',  marketId: 22 },
    { id: 23, symbol: 'LIT',   marketId: 23 },
    { id: 24, symbol: 'XAU',   marketId: 24 },
    { id: 25, symbol: 'XAG',   marketId: 25 },
];

export const TOKEN_LIST = TOKENS;

const WS_URL = 'wss://ws.testnet.rise.trade/ws';
const REST_URL = 'https://api.testnet.rise.trade/v1/markets';
const RECONNECT_BASE = 3000;   // 3s initial
const RECONNECT_MAX = 60000;   // 60s max
const REST_POLL_INTERVAL = 10000;
const HISTORY_MAX_POINTS = 54000;     // ~15 hours at 1s intervals
const HISTORY_RECORD_INTERVAL = 1000; // record every 1s
const HISTORY_SAVE_INTERVAL = 30000;  // save to disk every 30s
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'price-history.json');
const STATUS_LOG_INTERVAL = 60000; // log status every 60s

class PriceEngine extends EventEmitter {
    constructor() {
        super();
        this.prices = new Map(); // tokenId → { price, change24h, symbol, marketId, updatedAt }
        this.history = new Map(); // tokenId → [{ time, price }]  (circular buffer)
        this.ws = null;
        this.wsConnected = false;
        this.restInterval = null;
        this.reconnectTimeout = null;
        this._reconnectDelay = RECONNECT_BASE;
        this._reconnectAttempt = 0;
        this._historyInterval = null;
        this._saveInterval = null;
        this._statusInterval = null;
        this._started = false;
        this._wsMessageCount = 0;
        this._wsErrorCount = 0;
        this._restFetchCount = 0;
        this._restErrorCount = 0;

        // Initialize price map + history
        for (const t of TOKENS) {
            this.prices.set(t.id, {
                price: 0,
                change24h: 0,
                symbol: t.symbol,
                marketId: t.marketId,
                updatedAt: 0,
            });
            this.history.set(t.id, []);
        }

        // Load saved history from disk
        this._loadHistory();
    }

    start() {
        if (this._started) return;
        this._started = true;
        console.log('[PriceEngine] Starting...');

        // Fetch initial prices via REST immediately
        this._fetchREST();

        // Connect WebSocket
        this._connectWS();

        // REST fallback poll (always runs — WS prices override when available)
        this.restInterval = setInterval(() => this._fetchREST(), REST_POLL_INTERVAL);

        // Record price history every second
        this._historyInterval = setInterval(() => this._recordHistory(), HISTORY_RECORD_INTERVAL);

        // Save history to disk periodically
        this._saveInterval = setInterval(() => this._saveHistory(), HISTORY_SAVE_INTERVAL);

        // Periodic status log
        this._statusInterval = setInterval(() => this._logStatus(), STATUS_LOG_INTERVAL);
    }

    stop() {
        this._started = false;
        if (this.ws) { this.ws.close(); this.ws = null; }
        if (this.restInterval) { clearInterval(this.restInterval); this.restInterval = null; }
        if (this._historyInterval) { clearInterval(this._historyInterval); this._historyInterval = null; }
        if (this._saveInterval) { clearInterval(this._saveInterval); this._saveInterval = null; }
        if (this._statusInterval) { clearInterval(this._statusInterval); this._statusInterval = null; }
        if (this.reconnectTimeout) { clearTimeout(this.reconnectTimeout); this.reconnectTimeout = null; }
        this._saveHistory(); // save on shutdown
        console.log('[PriceEngine] Stopped');
    }

    /** Get current prices for all tokens */
    getPrices() {
        const result = {};
        for (const [id, data] of this.prices) {
            result[id] = { ...data };
        }
        return result;
    }

    /** Get price for a specific token */
    getPrice(tokenId) {
        return this.prices.get(tokenId) || null;
    }

    /** Get snapshot of all prices as array (for cycle start/end) */
    getPriceSnapshot() {
        const snapshot = [];
        for (const t of TOKENS) {
            const data = this.prices.get(t.id);
            snapshot.push({
                tokenId: t.id,
                symbol: t.symbol,
                price: data?.price || 0,
            });
        }
        return snapshot;
    }

    /** Get price history for a specific token */
    getHistory(tokenId) {
        return this.history.get(tokenId) || [];
    }

    /** Get price history for all tokens (for WS broadcast) */
    getAllHistory() {
        const result = {};
        for (const [id, hist] of this.history) {
            result[id] = hist;
        }
        return result;
    }

    /** Record current prices into history buffer */
    _recordHistory() {
        const now = Math.floor(Date.now() / 1000);
        for (const t of TOKENS) {
            const data = this.prices.get(t.id);
            if (!data || data.price === 0) continue;
            const hist = this.history.get(t.id);
            // Avoid duplicate timestamps
            if (hist.length > 0 && hist[hist.length - 1].time === now) continue;
            hist.push({ time: now, price: data.price });
            if (hist.length > HISTORY_MAX_POINTS) hist.shift();
        }
    }

    // ─── Status Logging ───

    _logStatus() {
        const now = Date.now();
        let activeCount = 0;
        let staleCount = 0;
        let zeroCount = 0;
        for (const [, data] of this.prices) {
            if (data.price === 0) { zeroCount++; continue; }
            if (now - data.updatedAt > 30000) { staleCount++; } else { activeCount++; }
        }
        const totalHistory = Array.from(this.history.values()).reduce((sum, h) => sum + h.length, 0);
        console.log(`[PriceEngine] Status: ws=${this.wsConnected ? 'ON' : 'OFF'} | prices: ${activeCount} active, ${staleCount} stale, ${zeroCount} zero | history: ${totalHistory} pts | ws_msgs=${this._wsMessageCount} ws_errs=${this._wsErrorCount} rest_ok=${this._restFetchCount} rest_err=${this._restErrorCount}`);
        // Reset counters
        this._wsMessageCount = 0;
        this._wsErrorCount = 0;
        this._restFetchCount = 0;
        this._restErrorCount = 0;
    }

    // ─── History Persistence ───

    _loadHistory() {
        try {
            if (!fs.existsSync(HISTORY_FILE)) return;
            const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
            const saved = JSON.parse(raw);
            let totalLoaded = 0;
            for (const [idStr, points] of Object.entries(saved)) {
                const id = parseInt(idStr, 10);
                if (!this.history.has(id) || !Array.isArray(points)) continue;
                // Only keep points within max age
                const cutoff = Math.floor(Date.now() / 1000) - HISTORY_MAX_POINTS;
                const filtered = points.filter(p => p.time > cutoff);
                this.history.set(id, filtered);
                totalLoaded += filtered.length;
            }
            console.log(`[PriceEngine] Loaded ${totalLoaded} history points from disk`);
        } catch (err) {
            console.warn('[PriceEngine] Could not load history:', err.message);
        }
    }

    _saveHistory() {
        try {
            const dir = path.dirname(HISTORY_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const obj = {};
            for (const [id, hist] of this.history) {
                if (hist.length > 0) obj[id] = hist;
            }
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(obj));
        } catch (err) {
            console.warn('[PriceEngine] Could not save history:', err.message);
        }
    }

    // ─── WebSocket Connection ───

    _connectWS() {
        if (!this._started) return;

        try {
            this.ws = new WebSocket(WS_URL);

            this.ws.on('open', () => {
                this.wsConnected = true;
                this._reconnectDelay = RECONNECT_BASE;
                this._reconnectAttempt = 0;
                console.log('[PriceEngine] WebSocket connected');

                // Subscribe to orderbook for all market IDs
                for (const t of TOKENS) {
                    this.ws.send(JSON.stringify({
                        method: 'subscribe',
                        params: { channel: 'orderbook', market_id: t.marketId },
                    }));
                }
            });

            this.ws.on('message', (data) => {
                this._wsMessageCount++;
                try {
                    const msg = JSON.parse(data.toString());
                    this._handleWSMessage(msg);
                } catch (err) {
                    this._wsErrorCount++;
                    console.warn(`[PriceEngine] WS message parse error: ${err.message} | data: ${data.toString().substring(0, 200)}`);
                }
            });

            this.ws.on('close', () => {
                this.wsConnected = false;
                console.log('[PriceEngine] WebSocket disconnected, reconnecting...');
                this._scheduleReconnect();
            });

            this.ws.on('error', (err) => {
                console.error('[PriceEngine] WebSocket error:', err.message);
                this.wsConnected = false;
            });
        } catch (err) {
            console.error('[PriceEngine] WS connect error:', err.message);
            this._scheduleReconnect();
        }
    }

    _scheduleReconnect() {
        if (!this._started) return;
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        this._reconnectAttempt++;
        // Exponential backoff: 3s → 6s → 12s → 24s → 48s → 60s (capped)
        const jitter = Math.random() * 1000;
        const delay = Math.min(this._reconnectDelay + jitter, RECONNECT_MAX);
        console.log(`[PriceEngine] Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt #${this._reconnectAttempt})`);
        this.reconnectTimeout = setTimeout(() => this._connectWS(), delay);
        this._reconnectDelay = Math.min(this._reconnectDelay * 2, RECONNECT_MAX);
    }

    _handleWSMessage(msg) {
        // RISEx orderbook format:
        // { channel: "orderbook", data: { market_id: number, bids: [{ price, quantity, order_count }], asks: [...] } }
        if (!msg.data || msg.data.market_id == null) return;

        const marketId = typeof msg.data.market_id === 'string'
            ? parseInt(msg.data.market_id, 10) : msg.data.market_id;
        const token = TOKENS.find(t => t.marketId === marketId);
        if (!token) return;

        const bids = msg.data.bids;
        const asks = msg.data.asks;

        if (bids && bids.length > 0 && asks && asks.length > 0) {
            // Prices come as strings in wei (18 decimals), in objects { price, quantity }
            const bestBid = parseFloat(bids[0].price) / 1e18;
            const bestAsk = parseFloat(asks[0].price) / 1e18;
            const midPrice = (bestBid + bestAsk) / 2;

            if (midPrice > 0) {
                const existing = this.prices.get(token.id);
                existing.price = midPrice;
                existing.updatedAt = Date.now();
                this.emit('price-update', { tokenId: token.id, ...existing });
            }
        }
    }

    // ─── REST Fallback ───

    async _fetchREST() {
        try {
            const res = await fetch(REST_URL);
            if (!res.ok) {
                this._restErrorCount++;
                console.warn(`[PriceEngine] REST fetch failed: HTTP ${res.status} ${res.statusText}`);
                return;
            }
            const data = await res.json();

            // Response format: { data: { markets: [...] } }
            const markets = data?.data?.markets || data?.markets || (Array.isArray(data) ? data : []);

            let updated = 0;
            for (const market of markets) {
                const mId = typeof market.market_id === 'string'
                    ? parseInt(market.market_id, 10) : (market.market_id || market.id);
                const token = TOKENS.find(t => t.marketId === mId);
                if (!token) continue;

                const price = parseFloat(market.last_price || market.mark_price || 0);
                // change_24h is absolute price change — convert to percentage
                const absChange = parseFloat(market.change_24h || 0);
                const change = price > 0 ? (absChange / (price - absChange)) * 100 : 0;

                if (price > 0) {
                    const existing = this.prices.get(token.id);
                    // Only update from REST if WS hasn't updated recently (within 15s)
                    if (!this.wsConnected || Date.now() - existing.updatedAt > 15000) {
                        existing.price = price;
                        existing.change24h = change;
                        existing.updatedAt = Date.now();
                        updated++;
                    } else {
                        // Always update 24h change from REST (WS doesn't provide it)
                        existing.change24h = change;
                    }
                }
            }

            this._restFetchCount++;
            this.emit('price-update', null); // bulk update
        } catch (err) {
            this._restErrorCount++;
            console.error(`[PriceEngine] REST fetch error: ${err.message}`);
        }
    }
}

// Singleton
export const priceEngine = new PriceEngine();
