import ReactMarkdown, { type Components, defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CITATION_RE, FOLDER_CITATION_RE, markerTimeToMs } from '../../lib/citationMarkers'
import { TimestampBadge } from './TimestampBadge'
import { ChatMermaid } from './ChatMermaid'

// 마커 → 마크다운 링크 치환. FOLDER(m:) 먼저 치환해야 CITATION_RE 오매칭 방지.
function markersToSeekLinks(text: string): string {
  return text
    .replace(new RegExp(FOLDER_CITATION_RE.source, 'g'), (_m, mid, ms, sp) =>
      `[⏱](ddobak-seek-meeting:${mid}:${markerTimeToMs(ms)}:${encodeURIComponent(sp)})`)
    .replace(new RegExp(CITATION_RE.source, 'g'), (_m, ms, sp) =>
      `[⏱](ddobak-seek:${markerTimeToMs(ms)}:${encodeURIComponent(sp)})`)
}

// ddobak-seek: / ddobak-seek-meeting: 프로토콜은 내부 전용 — URL sanitizer에서 허용
function urlTransform(url: string): string {
  if (url.startsWith('ddobak-seek:') || url.startsWith('ddobak-seek-meeting:')) return url
  return defaultUrlTransform(url)
}

type HastNode = {
  tagName?: string
  properties?: { className?: unknown }
  children?: HastNode[]
  value?: string
}

// react-markdown이 넘기는 hast node에서 ```mermaid 코드 텍스트를 추출. 아니면 null.
export function mermaidCodeFromNode(node: HastNode | undefined): string | null {
  const codeEl = node?.children?.[0]
  if (!codeEl || codeEl.tagName !== 'code') return null
  const cls = codeEl.properties?.className
  const classes = Array.isArray(cls) ? cls : typeof cls === 'string' ? [cls] : []
  if (!classes.includes('language-mermaid')) return null
  const text = codeEl.children?.[0]?.value
  if (typeof text !== 'string') return null
  const trimmed = text.replace(/\n$/, '')
  return trimmed.trim() === '' ? null : trimmed
}

// Compact chat-bubble markdown styles. No @tailwindcss/typography is installed,
// so every element is styled explicitly via component overrides.
// react-markdown does NOT render raw HTML by default (no rehype-raw) — keep it safe.
const MAP: Components = {
  h1: ({ children }) => <h1 className="text-base font-semibold mt-2 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-semibold mt-2 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="my-1">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 my-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 my-1">{children}</ol>,
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className="bg-black/10 rounded px-1 py-0.5 text-xs font-mono">{children}</code>
  ),
  pre: ({ node, children }) => {
    const mermaidCode = mermaidCodeFromNode(node as HastNode | undefined)
    if (mermaidCode != null) return <ChatMermaid code={mermaidCode} />
    return (
      <pre className="bg-gray-800 text-gray-100 rounded p-2 overflow-x-auto text-xs my-1 [&_code]:bg-transparent [&_code]:p-0">
        {children}
      </pre>
    )
  },
  table: ({ children }) => (
    <table className="w-full text-xs border-collapse my-1">{children}</table>
  ),
  th: ({ children }) => (
    <th className="border border-border px-1.5 py-0.5 text-left">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-1.5 py-0.5 text-left">{children}</td>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-2 text-muted-foreground">{children}</blockquote>
  ),
  // Note: `a` is intentionally omitted from MAP — ChatMarkdown overrides it below
  // to handle the ddobak-seek: protocol. Defining it here would be dead code.
}

export function ChatMarkdown({
  content,
  onSeek,
  onSeekMeeting,
}: {
  content: string
  onSeek?: (ms: number) => void
  onSeekMeeting?: (meetingId: number, ms: number) => void
}) {
  const components: Components = {
    ...MAP,
    a: ({ children, href }) => {
      if (href && href.startsWith('ddobak-seek-meeting:')) {
        // href format: ddobak-seek-meeting:<meetingId>:<ms>:<encodedSpeaker>
        const withoutScheme = href.slice('ddobak-seek-meeting:'.length)
        const firstColon = withoutScheme.indexOf(':')
        if (firstColon === -1) return <>{children}</>
        const meetingId = Number(withoutScheme.slice(0, firstColon))
        const rest = withoutScheme.slice(firstColon + 1)
        const secondColon = rest.indexOf(':')
        if (secondColon === -1) return <>{children}</>
        const ms = Number(rest.slice(0, secondColon))
        const sp = decodeURIComponent(rest.slice(secondColon + 1))
        return (
          <TimestampBadge
            ms={ms}
            speaker={sp}
            onSeek={() => onSeekMeeting?.(meetingId, ms)}
            isAudioReady={!!onSeekMeeting}
          />
        )
      }
      if (href && href.startsWith('ddobak-seek:')) {
        // href format: ddobak-seek:<ms>:<encodedSpeaker>
        const withoutScheme = href.slice('ddobak-seek:'.length)
        const colonIdx = withoutScheme.indexOf(':')
        if (colonIdx === -1) return <>{children}</>
        const ms = Number(withoutScheme.slice(0, colonIdx))
        const sp = decodeURIComponent(withoutScheme.slice(colonIdx + 1))
        return (
          <TimestampBadge
            ms={ms}
            speaker={sp}
            onSeek={onSeek ?? (() => {})}
            isAudioReady={!!onSeek}
          />
        )
      }
      return (
        <a href={href} className="text-blue-600 underline" target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      )
    },
  }
  return (
    <div className="text-sm leading-relaxed break-words space-y-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>
        {markersToSeekLinks(content)}
      </ReactMarkdown>
    </div>
  )
}
