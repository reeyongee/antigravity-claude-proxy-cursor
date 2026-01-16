/**
 * Cursor Settings Component
 * Full settings page for Cursor IDE configuration
 */

window.Components = window.Components || {};

window.Components.cursorSettings = function () {
    return {
        loading: false,
        error: null,
        copied: null,
        copiedAll: false,
        ngrokToken: '',

        config: {
            apiKey: '',
            baseUrl: '',
            model: 'gpt-4o',
            ngrokConnected: false
        },

        status: {
            ngrokInstalled: false,
            ngrokConfigured: false,
            ngrokRunning: false,
            hasAccounts: false,
            accountCount: 0
        },

        settings: {
            enable1MContext: false,
            // Standard OpenAI names that Cursor accepts - proxy remaps these
            availableModels: [
                'gpt-4o',           // -> gemini-3-pro-high
                'gpt-4o-mini',      // -> gemini-3-pro
                'gpt-4-turbo',      // -> gemini-2.5-pro
                'gpt-4',            // -> claude-sonnet-4-5-thinking
                'gpt-3.5-turbo'     // -> gemini-3-pro
            ]
        },

        get setupComplete() {
            return this.status.hasAccounts && this.status.ngrokRunning;
        },

        async init() {
            await this.loadConfig();
            await this.loadStatus();
            await this.loadSettings();

            // Refresh periodically
            setInterval(() => {
                this.loadConfig();
                this.loadStatus();
            }, 15000);
        },

        async loadConfig() {
            try {
                const resp = await fetch('/api/cursor/config');
                const data = await resp.json();

                if (data.status === 'ok' && data.cursor) {
                    this.config = {
                        apiKey: data.cursor.apiKey || '',
                        baseUrl: data.cursor.baseUrl || `http://localhost:${window.location.port || 8080}`,
                        model: data.cursor.model || 'gpt-4o',
                        ngrokConnected: data.ngrok?.connected || false
                    };
                }
            } catch (error) {
                console.error('Failed to load cursor config:', error);
            }
        },

        async loadStatus() {
            try {
                const resp = await fetch('/api/setup/status');
                const data = await resp.json();

                if (data.status === 'ok' && data.setup) {
                    this.status = data.setup.steps;
                }
            } catch (error) {
                console.error('Failed to load setup status:', error);
            }
        },

        async loadSettings() {
            try {
                const resp = await fetch('/api/cursor/settings');
                const data = await resp.json();

                if (data.status === 'ok') {
                    this.settings.enable1MContext = data.enable1MContext || false;
                }
            } catch (error) {
                // Settings endpoint might not exist yet
                console.warn('Could not load settings:', error);
            }
        },

        async saveSettings() {
            try {
                const resp = await fetch('/api/cursor/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(this.settings)
                });
                const data = await resp.json();

                if (data.status === 'ok') {
                    this.showToast('Settings saved!', 'success');
                    // Reload config to get updated model
                    await this.loadConfig();
                } else {
                    this.error = data.error || 'Failed to save settings';
                }
            } catch (error) {
                this.error = 'Failed to save settings: ' + error.message;
            }
        },

        async configureNgrok() {
            if (!this.ngrokToken) return;

            this.loading = true;
            this.error = null;

            try {
                const resp = await fetch('/api/setup/ngrok', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ authToken: this.ngrokToken })
                });
                const data = await resp.json();

                if (data.status === 'ok') {
                    this.showToast('ngrok configured successfully!', 'success');
                    this.ngrokToken = '';
                    await this.loadStatus();
                    await this.loadConfig();
                } else {
                    this.error = data.error || 'Failed to configure ngrok';
                }
            } catch (error) {
                this.error = 'Network error: ' + error.message;
            } finally {
                this.loading = false;
            }
        },

        async addAccount() {
            this.loading = true;
            this.error = null;

            try {
                const resp = await fetch('/api/auth/url');
                const data = await resp.json();

                if (data.status === 'ok' && data.url) {
                    window.open(data.url, '_blank');
                    this.showToast('Complete sign-in in the new window', 'info');

                    // Poll for account addition
                    let attempts = 0;
                    const poll = setInterval(async () => {
                        attempts++;
                        await this.loadStatus();

                        if (this.status.accountCount > 0) {
                            clearInterval(poll);
                            this.loading = false;
                            this.showToast('Account connected!', 'success');
                        } else if (attempts > 60) {
                            clearInterval(poll);
                            this.loading = false;
                        }
                    }, 2000);
                } else {
                    this.error = data.error || 'Failed to get auth URL';
                    this.loading = false;
                }
            } catch (error) {
                this.error = 'Network error: ' + error.message;
                this.loading = false;
            }
        },

        async regenerateApiKey() {
            if (!confirm('Are you sure? You will need to update your Cursor settings with the new key.')) {
                return;
            }

            try {
                const resp = await fetch('/api/cursor/regenerate-key', {
                    method: 'POST'
                });
                const data = await resp.json();

                if (data.status === 'ok') {
                    this.showToast('API key regenerated!', 'success');
                    await this.loadConfig();
                } else {
                    this.error = data.error || 'Failed to regenerate key';
                }
            } catch (error) {
                this.error = 'Failed to regenerate key: ' + error.message;
            }
        },

        async copy(text, field) {
            try {
                await navigator.clipboard.writeText(text);
                this.copied = field;
                setTimeout(() => this.copied = null, 2000);
                this.showToast(`Copied ${field}!`, 'success');
            } catch (error) {
                console.error('Failed to copy:', error);
            }
        },

        async copyAll() {
            const settings = `API Key: ${this.config.apiKey}
Base URL: ${this.config.baseUrl}
Model: ${this.config.model}`;

            try {
                await navigator.clipboard.writeText(settings);
                this.copiedAll = true;
                setTimeout(() => this.copiedAll = false, 2000);
                this.showToast('All settings copied!', 'success');
            } catch (error) {
                console.error('Failed to copy:', error);
            }
        },

        showToast(message, type = 'info') {
            if (window.Alpine && Alpine.store('global')) {
                Alpine.store('global').showToast(message, type);
            }
        }
    };
};

// Also keep the simple dashboard version
window.Components.cursorConfig = function () {
    return {
        apiKey: '',
        baseUrl: '',
        model: 'gpt-4o',
        ngrokConnected: false,
        copied: null,
        copiedAll: false,
        dropdownOpen: false,

        // Standard OpenAI names that Cursor accepts - proxy remaps these
        availableModels: [
            'gpt-4o',           // -> gemini-3-pro-high
            'gpt-4o-mini',      // -> gemini-3-pro
            'gpt-4-turbo',      // -> gemini-2.5-pro
            'gpt-4',            // -> claude-sonnet-4-5-thinking
            'gpt-3.5-turbo'     // -> gemini-3-pro
        ],

        async init() {
            await this.loadConfig();
            setInterval(() => this.loadConfig(), 30000);
        },

        async loadConfig() {
            try {
                const resp = await fetch('/api/cursor/config');
                const data = await resp.json();

                if (data.status === 'ok' && data.cursor) {
                    this.apiKey = data.cursor.apiKey || '';
                    this.baseUrl = data.cursor.baseUrl || `http://localhost:${window.location.port || 8080}`;
                    // We don't use data.cursor.model anymore for display, we show the list
                    this.ngrokConnected = data.ngrok?.connected || false;
                }
            } catch (error) {
                console.error('Failed to load cursor config:', error);
                this.baseUrl = `http://localhost:${window.location.port || 8080}`;
            }
        },

        async copy(text, field) {
            try {
                await navigator.clipboard.writeText(text);
                this.copied = field;
                setTimeout(() => this.copied = null, 2000);

                if (window.Alpine && Alpine.store('global')) {
                    Alpine.store('global').showToast(`Copied ${field}!`, 'success');
                }
            } catch (error) {
                console.error('Failed to copy:', error);
            }
        },

        toggleDropdown() {
            this.dropdownOpen = !this.dropdownOpen;
        },

        async copyAll() {
            const settings = `API Key: ${this.apiKey}
Base URL: ${this.baseUrl}
Model: ${this.availableModels[0]}`; // Default to first available model for copy-all

            try {
                await navigator.clipboard.writeText(settings);
                this.copiedAll = true;
                setTimeout(() => this.copiedAll = false, 2000);

                if (window.Alpine && Alpine.store('global')) {
                    Alpine.store('global').showToast('All settings copied!', 'success');
                }
            } catch (error) {
                console.error('Failed to copy:', error);
            }
        }
    };
};

// Register with Alpine
document.addEventListener('alpine:init', () => {
    Alpine.data('cursorSettings', window.Components.cursorSettings);
    Alpine.data('cursorConfig', window.Components.cursorConfig);
});
