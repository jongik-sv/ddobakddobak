import { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { MermaidRenderer } from './mermaidBlock'

// 잘못된 mermaid 또는 렌더 실패 시 원문을 보여주는 폴백 — ChatMarkdown의 pre 스타일과 동일.
function CodeFallback({ code }: { code: string }) {
  return (
    <pre className="bg-gray-800 text-gray-100 rounded p-2 overflow-x-auto text-xs my-1">
      <code className="bg-transparent p-0 font-mono">{code}</code>
    </pre>
  )
}

export function ChatMermaid({ code }: { code: string }) {
  const [open, setOpen] = useState(false)
  const fallback = <CodeFallback code={code} />

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label="다이어그램 확대"
        title="클릭하면 확대"
        className="overflow-x-auto max-w-full my-1 cursor-zoom-in rounded hover:bg-black/5"
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <MermaidRenderer code={code} zoom={1} fallback={fallback} />
      </div>
      {open && (
        <Dialog
          onClose={() => setOpen(false)}
          closeOnBackdrop
          ariaLabel="다이어그램 확대 보기"
          className="w-full max-w-5xl max-h-[90vh] overflow-auto rounded-xl bg-white p-4 shadow-2xl"
        >
          <div className="flex justify-end mb-2">
            <button
              aria-label="닫기"
              onClick={() => setOpen(false)}
              className="text-sm text-gray-500 hover:text-gray-800"
            >
              닫기 <span aria-hidden="true">✕</span>
            </button>
          </div>
          <div className="overflow-auto">
            <MermaidRenderer code={code} zoom={1.6} fallback={fallback} />
          </div>
        </Dialog>
      )}
    </>
  )
}
