/**
 * ngrok Tunnel Manager
 * Automatically starts and manages ngrok tunnel for Cursor IDE access
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

let ngrokProcess = null;
let currentTunnelUrl = null;

/**
 * Check if ngrok is installed
 */
export async function isNgrokInstalled() {
    try {
        await execAsync('ngrok --version');
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if ngrok auth token is configured
 */
export async function isNgrokConfigured() {
    try {
        const { stdout } = await execAsync('ngrok config check');
        return !stdout.includes('authtoken');
    } catch {
        // If config check fails, try to see if we have a token
        try {
            const homeDir = process.env.HOME || process.env.USERPROFILE;
            const fs = await import('fs');
            const configPath = process.platform === 'darwin'
                ? `${homeDir}/Library/Application Support/ngrok/ngrok.yml`
                : `${homeDir}/.config/ngrok/ngrok.yml`;

            if (fs.existsSync(configPath)) {
                const content = fs.readFileSync(configPath, 'utf8');
                return content.includes('authtoken:') && !content.includes('authtoken: ""');
            }
        } catch {
            return false;
        }
        return false;
    }
}

/**
 * Configure ngrok with auth token
 */
/**
 * Configure ngrok with auth token
 */
export async function configureNgrok(authToken) {
    return new Promise((resolve) => {
        // Use spawn to avoid shell command injection
        const child = spawn('ngrok', ['config', 'add-authtoken', authToken]);

        child.on('error', (err) => {
            logger.error('[ngrok] Failed to configure auth token:', err.message);
            resolve(false);
        });

        child.on('close', (code) => {
            if (code === 0) {
                logger.info('[ngrok] Auth token configured successfully');
                resolve(true);
            } else {
                logger.error(`[ngrok] Config command failed with code ${code}`);
                resolve(false);
            }
        });
    });
}

/**
 * Start ngrok tunnel
 * @param {number} port - Local port to tunnel
 * @returns {Promise<string>} - Public ngrok URL
 */
export async function startTunnel(port = 8080) {
    if (currentTunnelUrl) {
        logger.info('[ngrok] Tunnel already running:', currentTunnelUrl);
        return currentTunnelUrl;
    }

    // Check if ngrok is installed
    if (!await isNgrokInstalled()) {
        throw new Error('ngrok is not installed. Please install it: brew install ngrok (macOS) or https://ngrok.com/download');
    }

    // Check if ngrok is configured
    if (!await isNgrokConfigured()) {
        throw new Error('NGROK_NOT_CONFIGURED');
    }

    return new Promise((resolve, reject) => {
        logger.info(`[ngrok] Starting tunnel to localhost:${port}...`);

        // Start ngrok process
        ngrokProcess = spawn('ngrok', ['http', port.toString(), '--host-header=localhost:' + port], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        ngrokProcess.on('error', (err) => {
            logger.error('[ngrok] Process error:', err.message);
            reject(err);
        });

        ngrokProcess.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                logger.warn(`[ngrok] Process exited with code ${code}`);
            }
            currentTunnelUrl = null;
            ngrokProcess = null;
        });

        // Poll ngrok API for tunnel URL
        const pollForUrl = async (attempts = 0) => {
            if (attempts > 30) {
                reject(new Error('Timeout waiting for ngrok tunnel'));
                return;
            }

            try {
                const response = await fetch('http://localhost:4040/api/tunnels');
                const data = await response.json();

                if (data.tunnels && data.tunnels.length > 0) {
                    // Prefer https tunnel
                    const httpsTunnel = data.tunnels.find(t => t.public_url.startsWith('https://'));
                    currentTunnelUrl = httpsTunnel?.public_url || data.tunnels[0].public_url;
                    logger.info('[ngrok] Tunnel established:', currentTunnelUrl);
                    resolve(currentTunnelUrl);
                    return;
                }
            } catch {
                // ngrok API not ready yet
            }

            setTimeout(() => pollForUrl(attempts + 1), 500);
        };

        // Start polling after a short delay
        setTimeout(() => pollForUrl(), 1000);
    });
}

/**
 * Stop ngrok tunnel
 */
export async function stopTunnel() {
    if (ngrokProcess) {
        logger.info('[ngrok] Stopping tunnel...');
        ngrokProcess.kill('SIGTERM');
        ngrokProcess = null;
        currentTunnelUrl = null;
    }
}

/**
 * Get current tunnel URL
 */
export function getTunnelUrl() {
    return currentTunnelUrl;
}

/**
 * Get ngrok status
 */
export async function getNgrokStatus() {
    try {
        const response = await fetch('http://localhost:4040/api/tunnels');
        const data = await response.json();

        if (data.tunnels && data.tunnels.length > 0) {
            const tunnel = data.tunnels.find(t => t.public_url.startsWith('https://')) || data.tunnels[0];
            return {
                running: true,
                url: tunnel.public_url,
                metrics: tunnel.metrics
            };
        }
    } catch {
        // ngrok not running or API not available
    }

    return {
        running: false,
        url: null,
        metrics: null
    };
}

// Cleanup on process exit
process.on('exit', () => {
    if (ngrokProcess) {
        ngrokProcess.kill('SIGTERM');
    }
});

process.on('SIGINT', () => {
    stopTunnel();
    process.exit(0);
});

process.on('SIGTERM', () => {
    stopTunnel();
    process.exit(0);
});
