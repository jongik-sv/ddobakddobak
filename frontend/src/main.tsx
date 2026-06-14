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

// dev 한정: Cmd/Ctrl+R 로 웹뷰 리로드 (Tauri는 기본 미바인딩이라 안 먹는다).
// 프로덕션에선 실사용 중(녹음 등) 실수로 새로고침해 상태가 날아가는 사고를 막기 위해 제외한다.
if (import.meta.env.DEV) {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault()
      location.reload()
    }
  })
}

// 모바일(Tauri)에서는 API/WS가 루프백 브릿지를 경유한다. apiClient의 prefixUrl이
// 모듈 로드 시점(getApiBaseUrl())에 고정되므로, App(및 transitive import) 평가 전에
// 브릿지 포트를 캐시하고 전달 대상을 설정한다. 데스크톱/웹에서는 즉시 통과한다.
async function boot() {
  // [BBDBG] 임시 계측 — AudioContext가 sampleRate:16000을 존중하는지 + logcat 채널 확인 (제거 예정)
  try {
    const { bbdbg } = await import('./lib/bbdbg')
    const _c = new AudioContext({ sampleRate: 16000 })
    bbdbg('boot ctx16k.sampleRate=' + _c.sampleRate)
    void _c.close()
  } catch (e) {
    const { bbdbg } = await import('./lib/bbdbg')
    bbdbg('boot probe fail: ' + String(e))
  }
  await initMobileBridge()
  const { default: App } = await import('./App.tsx')
  createRoot(document.getElementById('root')!).render(
    <BrowserRouter>
      <App />
    </BrowserRouter>,
  )
}

void boot()
