// transport.js - Complete PostMessage Transport Implementation
// Helper functions
function withTimeout(promise, timeoutMs, errorMessage = "Operation timed out") {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
        )
    ]);
}

function generateSessionId() {
    return Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15);
}

function isSetupMessage(data) {
    return data && typeof data === 'object' &&
        ['MCP_SETUP_HANDSHAKE', 'MCP_SETUP_HANDSHAKE_REPLY', 'MCP_SETUP_COMPLETE'].includes(data.type);
}

function isTransportMessage(data) {
    return data && typeof data === 'object' &&
        ['MCP_TRANSPORT_HANDSHAKE', 'MCP_TRANSPORT_HANDSHAKE_REPLY',
            'MCP_TRANSPORT_ACCEPTED'].includes(data.type);
}

function isMCPMessage(data) {
    return data && typeof data === 'object' && data.type === 'MCP_MESSAGE';
}

// PostMessageInnerControl
export class PostMessageInnerControl {
    constructor(allowedOrigins, windowRef = window.parent) {
        this.allowedOrigins = allowedOrigins;
        this.windowRef = windowRef;
        this._pinnedOrigin = undefined;
        this.messageCallbacks = new Set();
        this.destroyed = false;
        this.messageHandler = null;
    }

    get pinnedOrigin() {
        return this._pinnedOrigin;
    }

    postMessage(msg) {
        if (this.destroyed) {
            throw new Error("WindowControl has been destroyed");
        }
        const targetOrigin = this._pinnedOrigin || "*";
        this.windowRef.postMessage(msg, targetOrigin);
    }

    onMessage(callback) {
        if (this.destroyed) {
            throw new Error("WindowControl has been destroyed");
        }
        if (!this.messageHandler) {
            this.messageHandler = (event) => {
                if (event.source !== this.windowRef) {
                    return;
                }
                if (!this._pinnedOrigin) {
                    if (this.allowedOrigins.includes('*') || this.allowedOrigins.includes(event.origin)) {
                        this._pinnedOrigin = event.origin;
                        console.log(`[PostMessage] Pinned origin: ${event.origin}`);
                    } else {
                        console.warn(`[PostMessage] Rejected message from disallowed origin: ${event.origin}`);
                        return;
                    }
                } else if (event.origin !== this._pinnedOrigin) {
                    return;
                }
                this.messageCallbacks.forEach(cb => {
                    try {
                        cb(event);
                    } catch (error) {
                        console.error('[PostMessage] Error in message callback:', error);
                    }
                });
            };
            window.addEventListener('message', this.messageHandler);
        }
        this.messageCallbacks.add(callback);
        return () => {
            this.messageCallbacks.delete(callback);
            if (this.messageCallbacks.size === 0 && this.messageHandler) {
                window.removeEventListener('message', this.messageHandler);
                this.messageHandler = null;
            }
        };
    }

    destroy() {
        this.destroyed = true;
        this.messageCallbacks.clear();
        if (this.messageHandler) {
            window.removeEventListener('message', this.messageHandler);
            this.messageHandler = null;
        }
    }
}

// InnerFrameTransport
export class InnerFrameTransport {
    constructor(control) {
        this.control = control;
        this.sessionId = null;
        this.closed = false;
        this.onclose = null;
        this.onerror = null;
        this.onmessage = null;
    }

    async prepareToConnect() {
        if (this.closed) {
            throw new Error("Transport already closed");
        }
        console.log('[InnerTransport] Starting transport handshake...');
        return withTimeout(
            new Promise((resolve, reject) => {
                let handshakeComplete = false;
                const unsubscribe = this.control.onMessage((event) => {
                    if (handshakeComplete) return;
                    const data = event.data;
                    if (isTransportMessage(data)) {
                        if (data.type === "MCP_TRANSPORT_HANDSHAKE_REPLY") {
                            console.log('[InnerTransport] Received handshake reply');
                            this.sessionId = data.sessionId;
                            handshakeComplete = true;
                            cleanup();
                            this.control.postMessage({
                                type: "MCP_TRANSPORT_ACCEPTED",
                            });
                            resolve({
                                origin: this.control.pinnedOrigin,
                                sessionId: this.sessionId,
                            });
                        }
                    }
                });
                const cleanup = () => unsubscribe();
                this.control.postMessage({
                    type: "MCP_TRANSPORT_HANDSHAKE",
                    protocolVersion: "1.0",
                });
                console.log('[InnerTransport] Sent transport handshake');
            }),
            30000,
            "Transport handshake timeout"
        );
    }

    async start() {
        // MCP Client expects this method - just return since we handle connection in prepareToConnect
        return;
    }

    async send(message) {
        if (this.closed) {
            throw new Error("Transport is closed");
        }
        this.control.postMessage({
            type: "MCP_MESSAGE",
            message: message,
        });
    }

    onMessage(callback) {
        return this.control.onMessage((event) => {
            console.log('[InnerTransport] Received event:', event.data);
            if (isMCPMessage(event.data)) {
                console.log('[InnerTransport] Forwarding MCP message to client:', event.data.message);
                callback(event.data.message);
            }
        });
    }

    async close() {
        if (this.closed) return;
        this.closed = true;
        this.control.destroy();
        if (this.onclose) {
            this.onclose();
        }
    }
}
