import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // @tauri-apps/plugin-deep-link is not installed as npm dep (Tauri-only);
      // provide a stub so tests can resolve the import
      '@tauri-apps/plugin-deep-link': path.resolve(__dirname, './src/test/__mocks__/tauri-deep-link.ts'),
    },
  },
  server: {
    port: 13325,
    strictPort: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
})
