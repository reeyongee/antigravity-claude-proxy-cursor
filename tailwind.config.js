/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./public/**/*.{html,js}"  // Simplified: already covers all subdirectories
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif']
      },
      colors: {
        space: {
          950: '#2d3047', // Space Indigo (Base)
          900: '#588b8b', // Dark Cyan
          850: '#93b7be', // Light Blue
          800: '#1e2030', // Deep Indigo
          border: '#93b7be'
        },
        neon: {
          purple: '#a855f7',
          cyan: '#06b6d4',
          green: '#22c55e',
          yellow: '#eab308',
          red: '#ef4444'
        },
        custom: {
          'dark-cyan': '#588b8bff',
          'white': '#ffffffff',
          'peach-fuzz': '#ffd5c2ff',
          'tiger-orange': '#f28f3bff',
          'rosy-copper': '#c8553dff',
          'space-indigo': '#2d3047ff',
          'light-blue': '#93b7beff',
        }
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('daisyui')
  ],
  daisyui: {
    themes: [{
      antigravity: {
        "primary": "#f28f3b",    // tiger-orange
        "secondary": "#93b7be",  // light-blue
        "accent": "#c8553d",     // rosy-copper
        "neutral": "#2d3047",    // space-indigo
        "base-100": "#2d3047",   // space-indigo (Main BG)
        "base-200": "#588b8b",   // dark-cyan (Secondary BG)
        "base-content": "#ffffff", // white
        "info": "#93b7be",       // light-blue
        "success": "#588b8b",    // dark-cyan (using palette)
        "warning": "#ffd5c2",    // peach-fuzz
        "error": "#c8553d",      // rosy-copper
      }
    }],
    logs: false  // Disable console logs in production
  }
}
