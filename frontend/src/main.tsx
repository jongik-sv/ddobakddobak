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
