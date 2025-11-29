import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: []
    })
  ],
  // No proxy needed - using standalone Express proxy server on port 3001
  // Run with: npm run dev:all (starts both proxy and vite)
})
