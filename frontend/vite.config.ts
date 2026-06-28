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
  define: {
    // react-draggable(react-rnd 드래그 의존)이 handleDragStart에서 브라우저에 없는
    // process.env.DRAGGABLE_DEBUG를 읽어 "ReferenceError: process is not defined" → 드래그가 죽음
    // (리사이즈는 re-resizable라 정상). 빌드/최적화 시 false로 치환해 에러 제거 → 드래그 복구.
    'process.env.DRAGGABLE_DEBUG': 'false',
  },
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
    // HMR: 모바일 dev면 LAN IP로, 아니면 기본(페이지 origin = vite 13325 직접).
    // 데스크톱 Tauri(devUrl=http://localhost:13325)·LAN 브라우저(http://<ip>:13325)는 vite에 직접 접속하므로
    // 기본 HMR이 맞다. clientPort:13443(caddy)은 TLS 전용+localhost 미listen이라 http 페이지에서
    // ws://localhost:13443 연결이 실패→무한 재시도 폭주를 유발했었다.
    hmr: process.env.TAURI_DEV_HOST
      ? { protocol: 'ws', host: process.env.TAURI_DEV_HOST, port: 13325 }
      : true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
})
