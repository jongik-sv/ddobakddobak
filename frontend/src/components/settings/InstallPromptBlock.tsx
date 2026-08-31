import { useState } from 'react'

/**
 * 설치 프롬프트 표시 블록 — 읽기 전용 코드체 텍스트 + "프롬프트 복사" 버튼.
 * 복사 성공 시 버튼 라벨이 잠시 "복사됨"으로 바뀐다.
 */
export function InstallPromptBlock({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(prompt)
    setCopied(true)
  }

  return (
    <div className="min-w-0">
      <pre className="whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2 text-xs font-mono">
        {prompt}
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        className="mt-2 px-3 py-2 rounded-md text-sm font-medium border border-border hover:bg-accent min-h-[44px]"
      >
        {copied ? '복사됨' : '프롬프트 복사'}
      </button>
    </div>
  )
}
