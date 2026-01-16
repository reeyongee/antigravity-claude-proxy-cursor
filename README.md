# Cursor Antigravity Proxy (Optimized for Cursor)

This is a specialized fork of the **Antigravity Claude Proxy**, designed specifically to give **Cursor IDE** users access to advanced models like **Claude 3.5 Sonnet** and **Gemini 1.5 Pro** via Google's Cloud Code.

## ❤️ Credits & Appreciation

This project is a fork of the incredible work by **[Badri Narayanan](https://github.com/badri-s2001/antigravity-claude-proxy)**. Full credit goes to him for reverse-engineering the Antigravity protocol and building the robust proxy server that makes this possible. We have simply refined the UI and defaults to make it a seamless experience for Cursor users.

Please consider starring the [original repository](https://github.com/badri-s2001/antigravity-claude-proxy) to show your support!

## 🚀 What This Version Does

*   **Cursor-First Experience:** The UI is stripped down and focused entirely on getting your Cursor connection string.
*   **1 Million Context Window:** We added a simple toggle to enable the massive 1M token context window for Gemini models.
*   **Simplified Setup:** No confusing CLI instructions—just a web dashboard to manage your connection.

## ⚡ Get Started in 3 Steps

### 1. Install & Start
Clone this repository (or download the zip) and run these two commands in your terminal:

```bash
npm install
npm start
```

### 2. Connect Your Account
The dashboard will open automatically at `http://localhost:8080`.
*   Click **"Add Account"**.
*   Sign in with your Google account.
*   (Optional) Enable **"1M Context Mode"** in the sidebar.

### 3. Configure Cursor
In Cursor IDE, go to **Settings > Models > OpenAI** (or **General > Models** in newer versions):
*   **Base URL:** `http://localhost:8080/v1`
*   **API Key:** `sk-antigravity` (or any random text)
*   **Model Name:** Add and select `claude-sonnet-4-5-thinking` or `gemini-3-pro-high`

**That's it!** You can now chat using these premium models for free.

---

*(For advanced usage, troubleshooting, or to use the CLI tool, please refer to the [original documentation](https://github.com/badri-s2001/antigravity-claude-proxy).)*
