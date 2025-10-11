/**
 * Class representing an IframeSyncClient.
 * Browser iframes that want to participate in state synchronization should instantiate this class.
 */
class IframeSyncClient {
    #channel;
    #recv;
    #clientName;

    /**
     * Create an IframeSyncClient.
     * @param {string} [clientName] - A unique client name. If not provided, one will be generated randomly.
     * @param {function} recv - A callback function to receive state updates.
     */
    constructor(clientName, recv) {
        this.#recv = recv;
        this.#channel = 'IframeSync';
        this.#clientName = clientName || [...Array(16)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');

        if (!window) {
          return;
        }
        window.addEventListener('message', (event) => {
            if (!event.data || event.data.channel !== this.#channel) {
                return;
            }

            const isOwnMessage = event.data.sourceClientName === this.#clientName;
            const isReadyReceived = event.data.type === 'readyReceived';

            if (['syncState', 'readyReceived'].includes(event.data.type) && typeof this.#recv === 'function') {
                this.#recv(event.data.payload, isOwnMessage, isReadyReceived);
            }
        });
    }

    /**
     * Notify the parent window that this client is ready to receive state updates.
     */
    ready() {
        if (!window || !window.parent) {
          return;
        }
        window.parent.postMessage({
            channel: this.#channel,
            type: 'ready',
            sourceClientName: this.#clientName
        }, '*');
    }

    /**
     * Send a state update to the broker, which will broadcast it to all other clients.
     * Partial updates are OK, as the broker will merge the update into the current state.
     * @param {Object} update - The state update to send.
     */
    stateChange(update) {
        if (!window || !window.parent) {
          return;
        }
        window.parent.postMessage({
            channel: this.#channel,
            type: 'stateChange',
            sourceClientName: this.#clientName,
            payload: update
        }, '*');
    }
}

/**
 * Class representing an IframeSyncBroker.
 */
class IframeSyncBroker {
    #channel;
    #state;
    #clientIframes;
    #debugMode;

    /**
     * Create an IframeSyncBroker.
     */
    constructor() {
        this.#channel = 'IframeSync';
        this.#state = {};
        this.#clientIframes = new Set();
        this.#debugMode = false;

        if (!window) {
          return;
        }
        window.addEventListener('message', (event) => this.#handleMessage(event));
    }

    /**
     * Handle incoming messages.
     * @param {MessageEvent} event - The message event.
     * @private
     */
    #handleMessage(event) {
        const { data, source: clientIframe } = event;
        if (!data || data.channel !== this.#channel) {
            return;
        }

        if (data.type === 'ready') {
            this.#clientIframes.add(clientIframe);
            this.#sendReadyReceived(clientIframe);
        } else if (data.type === 'stateChange' && data.payload) {
            this.#updateState(data.payload, data.sourceClientName);
        }
    }

    /**
     * Update the state with the provided update.
     * @param {Object} update - The state update.
     * @param {string} sourceClientName - The name of the client that sent the update.
     * @private
     */
    #updateState(update, sourceClientName) {
        const prevState = JSON.stringify(this.#state);
        Object.assign(this.#state, update);
        const newState = JSON.stringify(this.#state);

        if (prevState !== newState) {
            this.#debug();
            this.#broadcastState(sourceClientName);
        }
    }

    /**
     * Send the current state to a specific client iframe.
     * @param {Window} clientIframe - The client iframe to send the state to.
     * @param {string} sourceClientName - The name of the client that requested the state.
     * @private
     */
    #sendSyncState(clientIframe, sourceClientName) {
        if (clientIframe && typeof clientIframe.postMessage === 'function') {
            clientIframe.postMessage({
                channel: this.#channel,
                type: 'syncState',
                sourceClientName: sourceClientName, // Pass through the source
                payload: this.#state,
            }, '*');
        }
    }

    /**
     * Send the current state to a specific client iframe.
     * @param {Window} clientIframe - The client iframe to send the state to.
     * @param {string} sourceClientName - The name of the client that requested the state.
     * @private
     */
    #sendReadyReceived(clientIframe) {
        if (clientIframe && typeof clientIframe.postMessage === 'function') {
            clientIframe.postMessage({
                channel: this.#channel,
                type: 'readyReceived',
                payload: this.#state,
            }, '*');
        }
    }

    /**
     * Broadcast the current state to all client iframes.
     * @param {string} sourceClientName - The name of the client that sent the update.
     * @private
     */
    #broadcastState(sourceClientName) {
        this.#clientIframes.forEach((clientIframe) =>
            this.#sendSyncState(clientIframe, sourceClientName)
        );
    }

    /**
     * Log a debug message.
     * @private
     */
    #debug() {
        if (this.#debugMode === false) {
            return; // noop by default
        }

        const stateJson = JSON.stringify(this.#state, null, 2);
        if (this.#debugMode === true) {
            console.log('IframeSyncBroker state change', stateJson);
        } else if (typeof this.#debugMode === 'function') {
            this.#debugMode(stateJson);
        } else if (this.#debugMode instanceof HTMLElement) {
            this.#debugMode.innerText = stateJson;
        }
    }

    /**
     * Control debug behavior.
     * @param {boolean|Function|HTMLElement} mode - The debug mode.
     *   * false (default): no debug
     *   * true: console.log
     *   * function: call a provided function
     *   * HTML element: set the text of an element
     */
    setDebugMode(mode) {
        this.#debugMode = mode;
    }
}

// CommonJS export for Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { IframeSyncClient, IframeSyncBroker };
}
