/**
 * Shared Server State Manager
 * Centralizes runtime state for the server, webui, and tunnel
 */

import { config } from './config.js';

// Initial state derived from config
let serverState = {
    apiKey: config.apiKey,
    port: config.port,
    ngrokUrl: null,
    needsSetup: false,
    isReady: false,
    enable1MContext: false, // Default to false
    running: true
};

/**
 * Get the current server state
 */
export function getServerState() {
    return { ...serverState };
}

/**
 * Update the server state
 * @param {Object} updates - Partial state updates
 */
export function updateServerState(updates) {
    serverState = { ...serverState, ...updates };
}

/**
 * Get a specific state value
 */
export function getState(key) {
    return serverState[key];
}
