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
    // Tauri 모바일 dev: 폰이 LAN으로 dev 서버에 접근하므로 TAURI_DEV_HOST(맥 LAN IP)에 바인딩.
    // 미설정 시 0.0.0.0(전 인터페이스) — localhost(데스크톱)와 LAN(다른 PC 브라우저) 모두 접근 가능.
    host: process.env.TAURI_DEV_HOST || true,
    port: 13325,
    strictPort: true,
    // Caddy 리버스 프록시(LAN HTTPS) 및 Tauri dev가 전달하는 Host 헤더 허용
    allowedHosts: true,
    // HMR: 모바일 dev면 LAN IP로, 아니면 Caddy HTTPS 포트로
    hmr: process.env.TAURI_DEV_HOST
      ? { protocol: 'ws', host: process.env.TAURI_DEV_HOST, port: 13325 }
      : { clientPort: 13443 },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
})
