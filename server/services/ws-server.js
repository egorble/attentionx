/**
 * WebSocket Server — pushes real-time Token Leagues data to frontend clients.
 *
 * Channels:
 * - "prices"      → token prices every 3-5s
 * - "cycle"       → cycle state (time left, status)
 * - "leaderboard" → live leaderboard every 5s
 * - "cycle-result" → final results when cycle ends
 * - "tokens"      → live token performance (% change from cycle start)
 *
 * Usage:
 *   import { wsServer } from './ws-server.js';
 *   wsServer.attach(httpServer);
 *   wsServer.start(priceEngine, cycleManager);
 */

import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';

const PRICE_BROADCAST_INTERVAL = 3000; // 3s
const HEARTBEAT_INTERVAL = 30000;      // 30s ping

class WSServer extends EventEmitter {
    constructor() {
        super();
        this.wss = null;
        this.clients = new Set();
        this.priceEngine = null;
        this.cycleManager = null;
        this.priceBroadcastInterval = null;
        this.heartbeatInterval = null;
    }

    /**
     * Attach to an HTTP server
     * @param {http.Server} server
     */
    attach(server) {
        this.wss = new WebSocketServer({
            server,
            path: '/ws/token-leagues',
        });

        this.wss.on('connection', (ws, req) => {
            const clientId = Math.random().toString(36).substring(7);
            ws._clientId = clientId;
            ws._subscriptions = new Set(['prices', 'cycle', 'leaderboard', 'tokens']);
            ws.isAlive = true;

            this.clients.add(ws);
            console.log(`[WS] Client connected (${this.clients.size} total)`);

            // Send initial state immediately
            this._sendInitialState(ws);

            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    this._handleMessage(ws, msg);
                } catch (err) {
                    console.warn(`[WS] Client ${clientId}: message parse error: ${err.message}`);
                }
            });

            ws.on('pong', () => { ws.isAlive = true; });

            ws.on('close', () => {
                this.clients.delete(ws);
                console.log(`[WS] Client disconnected (${this.clients.size} total)`);
            });

            ws.on('error', (err) => {
                console.error(`[WS] Client ${clientId} error: ${err.message}`);
                this.clients.delete(ws);
            });
        });

        // Heartbeat to detect dead connections
        this.heartbeatInterval = setInterval(() => {
            let terminated = 0;
            for (const ws of this.clients) {
                if (!ws.isAlive) {
                    ws.terminate();
                    this.clients.delete(ws);
                    terminated++;
                    continue;
                }
                ws.isAlive = false;
                ws.ping();
            }
            if (terminated > 0) {
                console.log(`[WS] Heartbeat: terminated ${terminated} dead connection(s) (${this.clients.size} remaining)`);
            }
        }, HEARTBEAT_INTERVAL);

        console.log('[WS] Server attached at /ws/token-leagues');
    }

    /**
     * Start broadcasting (needs priceEngine + cycleManager)
     */
    start(priceEngine, cycleManager) {
        this.priceEngine = priceEngine;
        this.cycleManager = cycleManager;

        // Broadcast prices periodically
        this.priceBroadcastInterval = setInterval(() => {
            if (this.clients.size === 0) return;
            this.broadcast('prices', this.priceEngine.getPrices());
            this.broadcast('tokens', this.cycleManager.getLiveTokenPerformance());
        }, PRICE_BROADCAST_INTERVAL);
    }

    /**
     * Broadcast to all connected clients subscribed to a channel
     */
    broadcast(channel, data) {
        if (!this.wss || this.clients.size === 0) return;

        const message = JSON.stringify({ channel, data, timestamp: Date.now() });

        let sent = 0;
        let errors = 0;
        for (const ws of this.clients) {
            if (ws.readyState === 1 && ws._subscriptions.has(channel)) {
                try {
                    ws.send(message);
                    sent++;
                } catch (err) {
                    errors++;
                    console.warn(`[WS] Broadcast send error to client ${ws._clientId}: ${err.message}`);
                }
            }
        }
        if (errors > 0) {
            console.warn(`[WS] Broadcast '${channel}': ${sent} sent, ${errors} errors`);
        }
    }

    // ─── Private ───

    _sendInitialState(ws) {
        try {
            // Send current prices
            if (this.priceEngine) {
                this._send(ws, 'prices', this.priceEngine.getPrices());
            }

            // Send current cycle info
            if (this.cycleManager) {
                const cycle = this.cycleManager.getCurrentCycle();
                if (cycle) {
                    this._send(ws, 'cycle', cycle);
                }

                // Send live leaderboard
                const lb = this.cycleManager.getLiveLeaderboard();
                if (lb.length > 0) {
                    this._send(ws, 'leaderboard', lb);
                }

                // Send token performance
                this._send(ws, 'tokens', this.cycleManager.getLiveTokenPerformance());
            }
        } catch (err) {
            console.error(`[WS] Error sending initial state to client ${ws._clientId}: ${err.message}`);
        }
    }

    _handleMessage(ws, msg) {
        // Subscribe/unsubscribe to channels
        if (msg.method === 'subscribe' && msg.channel) {
            ws._subscriptions.add(msg.channel);
        } else if (msg.method === 'unsubscribe' && msg.channel) {
            ws._subscriptions.delete(msg.channel);
        }
    }

    _send(ws, channel, data) {
        if (ws.readyState !== 1) return;
        try {
            ws.send(JSON.stringify({ channel, data, timestamp: Date.now() }));
        } catch (err) {
            console.warn(`[WS] Send error to client ${ws._clientId} on '${channel}': ${err.message}`);
        }
    }

    stop() {
        if (this.priceBroadcastInterval) clearInterval(this.priceBroadcastInterval);
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        for (const ws of this.clients) {
            ws.terminate();
        }
        this.clients.clear();
    }
}

// Singleton
export const wsServer = new WSServer();
