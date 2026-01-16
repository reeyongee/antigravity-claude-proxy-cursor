/**
 * Environment Configuration Manager
 * Handles .env file for simplified configuration
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';

const ENV_FILE = path.join(process.cwd(), '.env');
const ENV_EXAMPLE_FILE = path.join(process.cwd(), '.env.example');

/**
 * Load environment variables from .env file
 */
export function loadEnvFile() {
    if (!fs.existsSync(ENV_FILE)) {
        return {};
    }

    try {
        const content = fs.readFileSync(ENV_FILE, 'utf8');
        const vars = {};

        content.split('\n').forEach(line => {
            line = line.trim();
            if (line && !line.startsWith('#')) {
                const [key, ...valueParts] = line.split('=');
                if (key) {
                    let value = valueParts.join('=');
                    // Remove quotes if present
                    if ((value.startsWith('"') && value.endsWith('"')) ||
                        (value.startsWith("'") && value.endsWith("'"))) {
                        value = value.slice(1, -1);
                    }
                    vars[key.trim()] = value;
                }
            }
        });

        return vars;
    } catch (error) {
        logger.error('[Config] Error loading .env file:', error.message);
        return {};
    }
}

/**
 * Save environment variables to .env file
 */
export function saveEnvFile(vars) {
    try {
        const lines = [
            '# Cursor Antigravity Proxy Configuration',
            '# Generated automatically - modify as needed',
            ''
        ];

        for (const [key, value] of Object.entries(vars)) {
            if (value !== undefined && value !== null) {
                // Quote values with spaces
                const quotedValue = value.includes(' ') ? `"${value}"` : value;
                lines.push(`${key}=${quotedValue}`);
            }
        }

        fs.writeFileSync(ENV_FILE, lines.join('\n') + '\n');
        logger.info('[Config] Saved configuration to .env');
        return true;
    } catch (error) {
        logger.error('[Config] Error saving .env file:', error.message);
        return false;
    }
}

/**
 * Get a configuration value (env var takes precedence over .env file)
 */
export function getConfig(key, defaultValue = null) {
    // Process env takes precedence
    if (process.env[key]) {
        return process.env[key];
    }

    // Fall back to .env file
    const envVars = loadEnvFile();
    return envVars[key] || defaultValue;
}

/**
 * Set a configuration value (saves to .env file)
 */
export function setConfig(key, value) {
    const envVars = loadEnvFile();
    envVars[key] = value;
    return saveEnvFile(envVars);
}

/**
 * Generate a random API key
 */
export function generateApiKey() {
    return 'sk-proxy-' + crypto.randomBytes(24).toString('hex');
}

/**
 * Initialize configuration - creates defaults if needed
 * Returns true if setup is complete, false if setup wizard needed
 */
export function initializeConfig() {
    const envVars = loadEnvFile();
    let needsSave = false;
    let needsSetup = false;

    // Auto-generate API key if not set
    if (!envVars.PROXY_API_KEY && !process.env.PROXY_API_KEY) {
        envVars.PROXY_API_KEY = generateApiKey();
        needsSave = true;
        logger.info('[Config] Generated new API key');
    }

    // Check if ngrok token is configured
    if (!envVars.NGROK_AUTH_TOKEN && !process.env.NGROK_AUTH_TOKEN) {
        needsSetup = true;
    }

    // Set defaults
    if (!envVars.PORT && !process.env.PORT) {
        envVars.PORT = '8080';
        needsSave = true;
    }

    if (!envVars.DEFAULT_MODEL) {
        envVars.DEFAULT_MODEL = 'gemini-3-pro-high';
        needsSave = true;
    }

    if (needsSave) {
        saveEnvFile(envVars);
    }

    // Load into process.env
    for (const [key, value] of Object.entries(envVars)) {
        if (!process.env[key]) {
            process.env[key] = value;
        }
    }

    return {
        needsSetup,
        apiKey: envVars.PROXY_API_KEY || process.env.PROXY_API_KEY,
        ngrokToken: envVars.NGROK_AUTH_TOKEN || process.env.NGROK_AUTH_TOKEN,
        port: parseInt(envVars.PORT || process.env.PORT || '8080'),
        defaultModel: envVars.DEFAULT_MODEL || process.env.DEFAULT_MODEL || 'gemini-3-pro-high'
    };
}

/**
 * Get full configuration for display
 */
export function getFullConfig() {
    const envVars = loadEnvFile();

    return {
        apiKey: envVars.PROXY_API_KEY || process.env.PROXY_API_KEY || null,
        ngrokToken: envVars.NGROK_AUTH_TOKEN || process.env.NGROK_AUTH_TOKEN ? '***configured***' : null,
        port: parseInt(envVars.PORT || process.env.PORT || '8080'),
        defaultModel: envVars.DEFAULT_MODEL || process.env.DEFAULT_MODEL || 'gemini-3-pro-high',
        hasNgrokToken: !!(envVars.NGROK_AUTH_TOKEN || process.env.NGROK_AUTH_TOKEN)
    };
}

/**
 * Create .env.example if it doesn't exist
 */
export function createEnvExample() {
    if (fs.existsSync(ENV_EXAMPLE_FILE)) {
        return;
    }

    const example = `# Cursor Antigravity Proxy Configuration
# Copy this file to .env and modify as needed

# API key for protecting your proxy (auto-generated if not set)
PROXY_API_KEY=

# ngrok auth token (get from https://dashboard.ngrok.com/get-started/your-authtoken)
NGROK_AUTH_TOKEN=

# Server port (default: 8080)
PORT=8080

# Default model for Cursor
DEFAULT_MODEL=gemini-3-pro-high
`;

    try {
        fs.writeFileSync(ENV_EXAMPLE_FILE, example);
        logger.info('[Config] Created .env.example');
    } catch (error) {
        logger.error('[Config] Error creating .env.example:', error.message);
    }
}
