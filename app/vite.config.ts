import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { visualizer } from 'rollup-plugin-visualizer'

// Monotonic build number derived from the git commit count. Increases on every
// commit, independent of the marketing version in package.json (which is bumped
// only on a prod release). Falls back to 'dev' outside a git checkout.
function buildNumber(): string {
  try {
    return execSync('git rev-list --count HEAD').toString().trim()
  } catch {
    return 'dev'
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  define: {
    __BUILD_NUMBER__: JSON.stringify(buildNumber()),
  },
  plugins: [
    react(),
    viteStaticCopy({
      targets: []
    }),
    // Bundle size analyzer - generates stats.html in dist/
    visualizer({
      filename: './dist/stats.html',
      open: false, // Set to true to auto-open after build
      gzipSize: true,
      brotliSize: true,
      template: 'treemap', // Options: treemap, sunburst, network
    }),
  ],
  // Build optimizations
  build: {
    // Generate source maps for production debugging
    sourcemap: true,
    // Rollup options for chunk splitting
    rollupOptions: {
      output: {
        // Manual chunk splitting for better caching
        manualChunks: {
          // Vendor libraries
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-ui': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-select'],
          'vendor-forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-i18n': ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
          'vendor-charts': ['recharts'],
          'vendor-video': ['video.js'],
        },
      },
    },
  },
  // No proxy needed - using standalone Express proxy server on port 3001
  // Run with: npm run dev:all (starts both proxy and vite)
})
