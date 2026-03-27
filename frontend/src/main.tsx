import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
