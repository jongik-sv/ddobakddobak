import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { initMobileBridge } from './config'

// Tauri WebView: 입력 필드 외에서 Backspace 뒤로가기 방지
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Backspace') return
  const target = e.target as HTMLElement
  const isEditable =
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  if (!isEditable) e.preventDefault()
})

// 모바일(Tauri)에서는 API/WS가 루프백 브릿지를 경유한다. apiClient의 prefixUrl이
// 모듈 로드 시점(getApiBaseUrl())에 고정되므로, App(및 transitive import) 평가 전에
// 브릿지 포트를 캐시하고 전달 대상을 설정한다. 데스크톱/웹에서는 즉시 통과한다.
// TEMP PROBE(에뮬 Silero 검증용): 온디바이스 Silero VAD를 WebView에서 직접 호출해
// 동작을 확인하기 위한 디버그 훅. vite build(debug APK도 production 모드)에선 DEV가
// false라 unconditional로 노출한다. 검증 후 제거 예정(auto-decisions A14).
import('./stt/sileroVadLoader')
  .then(({ loadSileroVad }) => {
    ;(window as unknown as Record<string, unknown>).__loadSileroVad = loadSileroVad
  })
  .catch(() => {})

async function boot() {
  await initMobileBridge()
  const { default: App } = await import('./App.tsx')
  createRoot(document.getElementById('root')!).render(
    <BrowserRouter>
      <App />
    </BrowserRouter>,
  )
}

void boot()
