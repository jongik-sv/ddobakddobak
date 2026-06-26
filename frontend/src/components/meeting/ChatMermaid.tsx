import { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { MermaidRenderer } from './mermaidBlock'

const ZMIN = 0.5, ZMAX = 4, ZSTEP = 0.25, ZDEFAULT = 1.5
const clampZoom = (z: number) => Math.min(ZMAX, Math.max(ZMIN, Math.round(z * 100) / 100))

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
  const [zoom, setZoom] = useState(ZDEFAULT)
  const fallback = <CodeFallback code={code} />

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label="다이어그램 확대"
        title="클릭하면 확대"
        className="overflow-x-auto max-w-full my-1 cursor-zoom-in rounded hover:bg-black/5"
        onClick={() => { setZoom(ZDEFAULT); setOpen(true) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setZoom(ZDEFAULT); setOpen(true)
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
          className="w-full max-w-5xl max-h-[90vh] overflow-auto rounded-xl bg-card p-4 shadow-2xl"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="축소"
                onClick={() => setZoom((z) => clampZoom(z - ZSTEP))}
                disabled={zoom <= ZMIN}
                className="px-2 py-0.5 text-sm rounded border border-border text-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
              >
                −
              </button>
              <span className="text-xs tabular-nums w-12 text-center text-muted-foreground">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                aria-label="확대"
                onClick={() => setZoom((z) => clampZoom(z + ZSTEP))}
                disabled={zoom >= ZMAX}
                className="px-2 py-0.5 text-sm rounded border border-border text-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ＋
              </button>
              <button
                type="button"
                aria-label="리셋"
                onClick={() => setZoom(ZDEFAULT)}
                className="ml-1 px-2 py-0.5 text-xs rounded border border-border text-muted-foreground hover:bg-accent"
              >
                리셋
              </button>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="닫기"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              닫기 <span aria-hidden="true">✕</span>
            </button>
          </div>
          <div className="overflow-auto">
            <MermaidRenderer code={code} zoom={zoom} fallback={fallback} />
          </div>
        </Dialog>
      )}
    </>
  )
}
