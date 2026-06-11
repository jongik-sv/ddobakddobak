/**
 * BlockNote 커스텀 Mermaid 블록 + 공유 스키마
 *
 * AI 회의록에 ```mermaid 코드블록이 포함되면 다이어그램으로 렌더링한다.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { createReactBlockSpec } from '@blocknote/react'
import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core'
import type { Block, BlockSchema, InlineContentSchema, StyleSchema } from '@blocknote/core'

// ── Mermaid 렌더러 ───────────────────────────────

let mermaidModule: typeof import('mermaid') | null = null
let mermaidLoading: Promise<typeof import('mermaid')> | null = null

function loadMermaid() {
  if (mermaidModule) return Promise.resolve(mermaidModule)
  if (!mermaidLoading) {
    mermaidLoading = import('mermaid').then((m) => {
      m.default.initialize({ startOnLoad: false, theme: 'default' })
      mermaidModule = m
      return m
    })
  }
  return mermaidLoading
}

function MermaidRenderer({ code, zoom }: { code: string; zoom: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const intrinsicWidthRef = useRef<number | null>(null)  // viewBox 자연폭 (zoom 1.0 기준)
  const [error, setError] = useState<string | null>(null)

  // svg 폭을 intrinsic × zoom 으로 적용. 높이는 [&>svg]:h-auto 로 비율 유지.
  const applyZoom = useCallback((z: number) => {
    const svgEl = containerRef.current?.querySelector('svg')
    const w = intrinsicWidthRef.current
    if (svgEl && w && w > 0) {
      svgEl.style.width = `${w * z}px`
      svgEl.style.maxWidth = 'none'
    }
  }, [])

  useEffect(() => {
    if (!code.trim() || !containerRef.current) return
    let cancelled = false

    loadMermaid().then(async ({ default: mermaid }) => {
      if (cancelled) return
      try {
        // 먼저 구문 검증 — 실패하면 render()를 호출하지 않아 DOM 오염 방지
        await mermaid.parse(code.trim())
        const id = `mmd-${Math.random().toString(36).slice(2, 9)}`
        const { svg } = await mermaid.render(id, code.trim())
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg
          // mermaid는 width="100%" + max-width:자연폭 으로 출력 → 컨테이너 폭에 스트레치돼
          // 도형 크기가 레이아웃 방향에 휘둘린다. viewBox의 intrinsic 폭을 기준으로 zoom 배율을
          // 곱해 고정하면, 폭을 넘으면 부모(overflow-x-auto)가 스크롤한다.
          const svgEl = containerRef.current.querySelector('svg')
          const vb = svgEl?.viewBox?.baseVal
          if (svgEl && vb && vb.width > 0) {
            svgEl.removeAttribute('width')   // width="100%" 제거
            svgEl.removeAttribute('height')
            intrinsicWidthRef.current = vb.width
            applyZoom(zoom)
          }
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
        // render가 실패한 경우 DOM에 남긴 잔여 요소 제거
        document.querySelectorAll('[id^="dmmd-"]').forEach((el) => el.remove())
      }
    })

    return () => { cancelled = true }
  }, [code, zoom, applyZoom])

  // zoom 변경 시엔 재렌더 없이 폭만 다시 적용 (code 동일하면 위 effect의 parse/render 생략됨)
  useEffect(() => { applyZoom(zoom) }, [zoom, applyZoom])

  if (error) {
    return null
  }

  return <div ref={containerRef} className="[&>svg]:h-auto w-fit mx-auto" />
}

// ── BlockNote 커스텀 블록 ─────────────────────────

// 콘텐츠(다이어그램) 확대/축소 배율. 컴포넌트 폭이 아니라 내부 SVG 크기를 조절한다.
const ZOOM_MIN = 0.4
const ZOOM_MAX = 3
const ZOOM_STEP = 0.2

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100))
}

export const MermaidBlock = createReactBlockSpec(
  {
    type: 'mermaid' as const,
    propSchema: {
      code: { default: '' },
      zoom: { default: 1 },
    },
    content: 'none',
  },
  {
    render: ({ block, editor }) => {
      const code = block.props.code as string
      const zoom = (block.props.zoom as number) || 1
      const [isEditing, setIsEditing] = useState(!code.trim())
      const [editCode, setEditCode] = useState(code)

      useEffect(() => { setEditCode(code) }, [code])

      const applyCode = useCallback(() => {
        editor.updateBlock(block, { props: { code: editCode } })
        if (editCode.trim()) setIsEditing(false)
      }, [editor, block, editCode])

      const setZoom = useCallback((z: number) => {
        editor.updateBlock(block, { props: { zoom: clampZoom(z) } })
      }, [editor, block])

      return (
        <div className="border rounded-lg overflow-visible my-1 bg-white transition-all duration-200 w-full">
          <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 border-b rounded-t-lg">
            <span className="text-xs font-medium text-gray-500">Mermaid 다이어그램</span>
            <div className="flex items-center gap-2">
              {code.trim() && !isEditing && (
                <div className="flex items-center border rounded bg-white overflow-hidden">
                  <button
                    onClick={() => setZoom(zoom - ZOOM_STEP)}
                    disabled={zoom <= ZOOM_MIN}
                    title="축소"
                    className="px-2 py-0.5 text-xs text-gray-500 hover:text-blue-600 disabled:opacity-30 disabled:hover:text-gray-500"
                  >
                    −
                  </button>
                  <button
                    onClick={() => setZoom(1)}
                    title="기본 보기 (100%)"
                    className="px-2 py-0.5 text-[10px] text-gray-500 hover:text-blue-600 border-x min-w-[44px]"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    onClick={() => setZoom(zoom + ZOOM_STEP)}
                    disabled={zoom >= ZOOM_MAX}
                    title="확대"
                    className="px-2 py-0.5 text-xs text-gray-500 hover:text-blue-600 disabled:opacity-30 disabled:hover:text-gray-500"
                  >
                    +
                  </button>
                </div>
              )}
              {editor.isEditable && code.trim() && (
                <button
                  onClick={() => setIsEditing(!isEditing)}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  {isEditing ? '미리보기' : '코드 편집'}
                </button>
              )}
            </div>
          </div>

          {code.trim() && !isEditing && (
            <div className="py-2 overflow-x-auto min-h-[240px]">
              <MermaidRenderer code={code} zoom={zoom} />
            </div>
          )}

          {editor.isEditable && (isEditing || !code.trim()) && (
            <div className="p-3">
              <textarea
                value={editCode}
                onChange={(e) => setEditCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    applyCode()
                  }
                }}
                placeholder={'graph LR\n  A[시작] --> B[끝]'}
                className="w-full min-h-[240px] font-mono text-sm p-2 border rounded bg-gray-50 resize-y outline-none focus:ring-1 focus:ring-blue-300"
              />
              <div className="flex justify-between items-center mt-2">
                <span className="text-xs text-gray-400">Cmd+Enter로 적용</span>
                <button
                  onClick={applyCode}
                  className="px-3 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700"
                >
                  적용
                </button>
              </div>
            </div>
          )}

          {!editor.isEditable && !code.trim() && (
            <div className="p-3 text-sm text-gray-400">빈 Mermaid 블록</div>
          )}
        </div>
      )
    },
    toExternalHTML: ({ block }) => {
      return (
        <pre>
          <code className="language-mermaid">{block.props.code as string}</code>
        </pre>
      )
    },
  },
)

// ── 공유 스키마 ─────────────────────────────────

export const editorSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    mermaid: MermaidBlock(),
  },
})

// ── Markdown ↔ Mermaid 블록 변환 ──────────────────

type AnyBlock = Block<BlockSchema, InlineContentSchema, StyleSchema>

/**
 * tryParseMarkdownToBlocks 결과에서 codeBlock[language=mermaid]를
 * 커스텀 mermaid 블록으로 변환한다.
 */
export function codeBlocksToMermaid(blocks: AnyBlock[]): AnyBlock[] {
  return blocks.map((block) => {
    if (block.type === 'codeBlock' && block.props?.language === 'mermaid') {
      const code = Array.isArray(block.content)
        ? (block.content as { type: string; text?: string }[])
            .map((c) => c.text ?? '')
            .join('')
        : ''
      return {
        id: block.id,
        type: 'mermaid',
        props: { code },
        content: undefined,
        children: block.children,
      } as unknown as AnyBlock
    }
    if (block.children?.length) {
      return { ...block, children: codeBlocksToMermaid(block.children) }
    }
    return block
  })
}

/**
 * mermaid 블록을 codeBlock[language=mermaid]로 복원하여
 * blocksToMarkdownLossy가 올바른 마크다운을 생성하도록 한다.
 */
export function mermaidToCodeBlocks(blocks: AnyBlock[]): AnyBlock[] {
  return blocks.map((block) => {
    if (block.type === 'mermaid') {
      return {
        id: block.id,
        type: 'codeBlock',
        props: { language: 'mermaid' },
        content: [{ type: 'text', text: (block.props as unknown as { code: string }).code, styles: {} }],
        children: block.children,
      } as unknown as AnyBlock
    }
    if (block.children?.length) {
      return { ...block, children: mermaidToCodeBlocks(block.children) }
    }
    return block
  })
}
