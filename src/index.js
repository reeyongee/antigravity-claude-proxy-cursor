/**
 * Cursor Antigravity Proxy
 * Entry point - starts the proxy server with ngrok and opens browser
 */

import app from './server.js';
import { DEFAULT_PORT } from './constants.js';
import { logger } from './utils/logger.js';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

import { startTunnel, getTunnelUrl, isNgrokInstalled, isNgrokConfigured } from './ngrok/tunnel.js';
import { initializeConfig, getFullConfig, createEnvExample } from './setup/env-config.js';

const execAsync = promisify(exec);

// Parse command line arguments
const args = process.argv.slice(2);
const isDebug = args.includes('--debug') || process.env.DEBUG === 'true';
const isFallbackEnabled = args.includes('--fallback') || process.env.FALLBACK === 'true';
const skipBrowser = args.includes('--no-browser');
const skipNgrok = args.includes('--no-ngrok');

// Initialize logger
logger.setDebug(isDebug);

// Export fallback flag for server to use
export const FALLBACK_ENABLED = isFallbackEnabled;

// Create .env.example if needed
createEnvExample();

// Initialize configuration
const config = initializeConfig();
const PORT = config.port || process.env.PORT || DEFAULT_PORT;

import { getServerState, updateServerState } from './state.js';

// Initialize shared state
updateServerState({
    port: PORT,
    apiKey: config.apiKey,
    needsSetup: config.needsSetup,
    isReady: false
});

// Export for WebUI (re-export from state module)
export { getServerState, updateServerState };

/**
 * Open URL in default browser
 */
async function openBrowser(url) {
    try {
        const platform = process.platform;
        let command;

        if (platform === 'darwin') {
            command = `open "${url}"`;
        } else if (platform === 'win32') {
            command = `start "" "${url}"`;
        } else {
            command = `xdg-open "${url}"`;
        }

        await execAsync(command);
        logger.info('[Browser] Opened:', url);
    } catch (error) {
        logger.warn('[Browser] Could not open browser automatically:', error.message);
        logger.info('[Browser] Please open manually:', url);
    }
}

/**
 * Print minimal startup banner
 */
function printStartupBanner(ngrokUrl) {
    console.clear();

    const state = getServerState();
    const apiKey = state.apiKey || 'Not configured';
    const localUrl = `http://localhost:${PORT}`;

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║               🚀 Cursor Antigravity Proxy                             ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Status: ✅ Running                                          ║
║                                                              ║
║  Local URL:   ${(localUrl + ' '.repeat(45)).slice(0, 45)}║
${ngrokUrl ? `║  Public URL:  ${(ngrokUrl + ' '.repeat(45)).slice(0, 45)}║` : '║  Public URL:  Not configured (run setup)                    ║'}
║                                                              ║
╠══════════════════════════════════════════════════════════════╣
║  📋 Your Cursor Settings:                                    ║
║                                                              ║
║  API Key:     ${(apiKey.slice(0, 40) + ' '.repeat(45)).slice(0, 45)}║
║  Base URL:    ${((ngrokUrl || localUrl) + ' '.repeat(45)).slice(0, 45)}║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

    if (state.needsSetup) {
        logger.warn('Setup required - browser will open to configuration wizard');
    } else {
        logger.success('Ready! Copy settings above into Cursor IDE');
    }
}

/**
 * Main startup sequence
 */
async function startup() {
    // Start HTTP server
    const server = app.listen(PORT, async () => {
        logger.info(`[Server] Started on port ${PORT}`);

        let ngrokUrl = null;

        // Start ngrok if not skipped
        if (!skipNgrok) {
            try {
                // Check if ngrok is installed
                if (!await isNgrokInstalled()) {
                    logger.warn('[ngrok] Not installed. Install with: brew install ngrok');
                    logger.warn('[ngrok] Continuing without tunnel - Cursor will need manual localhost setup');
                } else if (!await isNgrokConfigured() && !config.ngrokToken) {
                    logger.warn('[ngrok] Not configured. Setup wizard will help you configure it.');
                    updateServerState({ needsSetup: true });
                } else {
                    // If we have a token in .env, configure ngrok first
                    if (config.ngrokToken) {
                        const { configureNgrok } = await import('./ngrok/tunnel.js');
                        await configureNgrok(config.ngrokToken);
                    }

                    // Start tunnel
                    ngrokUrl = await startTunnel(PORT);
                    updateServerState({ ngrokUrl });
                }
            } catch (error) {
                if (error.message === 'NGROK_NOT_CONFIGURED') {
                    updateServerState({ needsSetup: true });
                    logger.warn('[ngrok] Auth token not configured. Setup wizard will help you.');
                } else {
                    logger.error('[ngrok] Error starting tunnel:', error.message);
                }
            }
        }

        // Update state
        updateServerState({ isReady: true });

        // Get fresh state for banner and browser check
        const state = getServerState();

        // Print banner
        printStartupBanner(ngrokUrl);

        // Open browser
        if (!skipBrowser) {
            const browserUrl = state.needsSetup
                ? `http://localhost:${PORT}/setup`
                : `http://localhost:${PORT}`;

            // Small delay to ensure server is ready
            setTimeout(() => openBrowser(browserUrl), 500);
        }
    });

    // Handle shutdown
    const shutdown = () => {
        logger.info('[Server] Shutting down...');
        server.close();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

// Start the server
startup().catch(error => {
    logger.error('[Startup] Fatal error:', error);
    process.exit(1);
});
